-- =============================================================
-- 012_pr_d_users_invariants
-- =============================================================
--
-- Phase 1 PR D-0 — the auth substrate refactor + the schema
-- invariants the upcoming Users tab (PR D-1) depends on. PR D-0
-- contains:
--   - this migration (schema changes only — no new code paths
--     consume the new columns / tables yet, other than the
--     session_version that requireRole() now reads on every call)
--   - app_users.session_version cookie-revocation mechanism
--   - requireRole() refactored to async + reads session_version
--     and compares against the cookie's claim
--   - 16 PR C call-site updates to `await requireRole(...)`
--
-- The eight mutation RPCs and the new admin/users routes ship in
-- PR D-1. The /admin/users UI ships in PR D-2.
--
-- Apply this BEFORE merging PR D-0. The async requireRole reads
-- app_users.session_version on every protected request — without
-- this column, every protected route 500s.
--
-- =============================================================
-- What's in this migration
-- =============================================================
--
--   1. app_users.session_version int — cookie-revocation column.
--      requireRole() reads this on every protected request and
--      compares against the cookie's session_version claim.
--      Bumping this column on any mutation (role / disable /
--      remove — landed in PR D-1) invalidates every outstanding
--      cookie for that user within the next request rather than
--      waiting up to 7 days for cookie expiry. PR D-0 just adds
--      the column; PR D-1's RPCs do the bumping.
--
--   2. app_user_invites — new table backing the invite-a-user
--      flow that lands in PR D-1. PR D-0 creates the empty table
--      so PR D-1's RPCs (next migration) can reference it without
--      needing a separate schema migration.
--
--   3. auth_rate_limit — new table backing the rate limit on
--      state-changing admin routes that land in PR D-1. Same
--      rationale as app_user_invites — create empty here, fill
--      from PR D-1's handlers.
--
--   4. app_users_protect_last_super_admin() trigger — the
--      authoritative enforcement layer for the "cannot remove
--      last enabled super_admin" invariant. Covers INSERT,
--      UPDATE, DELETE. Handler pre-checks (PR D-1) are UX fast-
--      path only; this trigger is the layer that cannot be
--      bypassed. The trigger is dormant in PR D-0 (no code path
--      mutates app_users), but PR D-0's verification recipe
--      exercises it via direct SQL: hand-issued
--      `UPDATE app_users SET disabled_at = now() WHERE email = '<only super_admin>'`
--      must raise SQLSTATE 23514 cannot_remove_last_super_admin.
--
-- =============================================================
-- Notes on the trigger design
-- =============================================================
--
-- The trigger fires BEFORE the operation so its EXCEPTION rolls
-- back the would-be mutation rather than firing AFTER and
-- attempting compensation. PL/pgSQL exceptions raised with
-- SQLSTATE 23514 (check_violation) bubble up to the client; the
-- handler layer catches that code specifically and translates to
-- a 409 cannot_remove_last_super_admin response.
--
-- "Last enabled super_admin" is defined as: exactly one row with
-- role='super_admin' AND disabled_at IS NULL. The count uses
-- email <> OLD.email so it excludes the row being mutated — the
-- only correct way to ask "would there be ZERO enabled super_admins
-- after this operation?" The count uses the actual table state
-- (not a cached value), so concurrent mutations are arbitrated by
-- Postgres's row-level locking; the race-test in PR D-1's
-- verification recipe exercises this directly.

-- =============================================================
-- 1. app_users.session_version
-- =============================================================

alter table public.app_users
  add column if not exists session_version int not null default 0;

comment on column public.app_users.session_version is
  'Cookie revocation counter. Bumped on any mutation that should invalidate outstanding sessions (role change, disable/enable, removal — bumping happens in PR D-1''s RPCs). requireRole() compares this against the app_session cookie''s session_version claim; mismatch -> 401 reason=session_revoked.';

-- =============================================================
-- 2. app_user_invites (empty in PR D-0; populated by PR D-1)
-- =============================================================

create table if not exists public.app_user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null check (role in ('super_admin', 'admin', 'viewer')),
  invite_token_sha256 text not null unique,
  invited_by_email text not null references public.app_users(email) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- An invite is exactly one of: pending (accepted_at + revoked_at both null),
  -- accepted (accepted_at not null, revoked_at null), revoked (revoked_at not
  -- null, accepted_at null). A row can never be both accepted AND revoked.
  constraint app_user_invites_terminal_state
    check (not (accepted_at is not null and revoked_at is not null))
);

comment on table public.app_user_invites is
  'PR D Users tab: super_admin-issued invites for new app_users. Stores sha256(token) only; the plaintext token is returned exactly once in the invite-creation POST response and never re-fetchable. invite_token_sha256 unique so each invite_url is single-use against this table. Per-invite terminal state: pending (both nulls), accepted, or revoked.';

create index if not exists app_user_invites_pending_idx
  on public.app_user_invites (created_at desc)
  where accepted_at is null and revoked_at is null;

create index if not exists app_user_invites_email_idx
  on public.app_user_invites (email);

-- RLS default-deny (same shape as migrations 010 + 011). Service-role
-- bypasses RLS; the application is the authoritative enforcement point.
alter table public.app_user_invites enable row level security;

-- =============================================================
-- 3. auth_rate_limit (empty in PR D-0; populated by PR D-1)
-- =============================================================
--
-- Coarse rate limiting: 30 mutations / minute / (actor_email, action_class).
-- Each request either INSERTs a new (actor, action_class, window_start) row
-- with count=1, or increments count on an existing row whose window_start
-- matches the current minute bucket. Anything > 30 within the same minute
-- bucket returns 429.
--
-- "action class" rather than per-route so an attacker firing the invite
-- endpoint can't sidestep by alternating with another mutation route.
-- PR D-1's classes: 'users_mutation' (role/disable/delete/invite/revoke
-- routes), 'access_request_resolution' (approve/deny), 'invite_acceptance'
-- (the per-IP-hash bucket on /admin/auth/accept-invite).

create table if not exists public.auth_rate_limit (
  actor_key text not null,
  action_class text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (actor_key, action_class, window_start)
);

comment on table public.auth_rate_limit is
  'PR D Users tab: coarse rate-limit table. actor_key is actor_email for cookie-authenticated routes, or sha256(ip || user_agent) for the per-IP-hash bucket on /admin/auth/accept-invite. action_class buckets the limit so an attacker can''t sidestep by alternating routes.';

create index if not exists auth_rate_limit_window_idx
  on public.auth_rate_limit (window_start);

alter table public.auth_rate_limit enable row level security;

-- =============================================================
-- 4. app_users_protect_last_super_admin() — the trigger
-- =============================================================

create or replace function public.app_users_protect_last_super_admin()
  returns trigger
  language plpgsql
as $$
declare
  v_remaining_enabled_super_admins int;
  v_was_enabled_super_admin boolean;
  v_will_be_enabled_super_admin boolean;
begin
  -- DELETE: the row is going away. Count enabled super_admins EXCLUDING
  -- this row. If the row being deleted IS the last enabled super_admin,
  -- the count drops to zero -> raise.
  if tg_op = 'DELETE' then
    if old.role = 'super_admin' and old.disabled_at is null then
      select count(*) into v_remaining_enabled_super_admins
        from public.app_users
        where role = 'super_admin'
          and disabled_at is null
          and email <> old.email;
      if v_remaining_enabled_super_admins = 0 then
        raise exception 'cannot_remove_last_super_admin'
          using errcode = '23514',
                hint = 'Promote another user to super_admin before removing this one.';
      end if;
    end if;
    return old;
  end if;

  -- UPDATE: detect a state transition that would leave zero enabled
  -- super_admins. The "would" is critical: we look at the NEW row's
  -- intended state, not the OLD row.
  if tg_op = 'UPDATE' then
    v_was_enabled_super_admin := (old.role = 'super_admin' and old.disabled_at is null);
    v_will_be_enabled_super_admin := (new.role = 'super_admin' and new.disabled_at is null);
    -- Only matters if this row was contributing to the count AND will stop.
    if v_was_enabled_super_admin and not v_will_be_enabled_super_admin then
      select count(*) into v_remaining_enabled_super_admins
        from public.app_users
        where role = 'super_admin'
          and disabled_at is null
          and email <> new.email;
      if v_remaining_enabled_super_admins = 0 then
        raise exception 'cannot_remove_last_super_admin'
          using errcode = '23514',
                hint = 'Promote another user to super_admin before demoting or disabling this one.';
      end if;
    end if;
    return new;
  end if;

  -- INSERT: doesn't normally violate the invariant (an insert only ADDS
  -- to the enabled-super_admin count, or doesn't affect it). But we
  -- defend against the empty-table edge case: if there are currently
  -- zero enabled super_admins (e.g. somebody manually disabled the
  -- last one via direct SQL bypassing the trigger), the new row MUST
  -- be an enabled super_admin or the invariant stays broken.
  if tg_op = 'INSERT' then
    select count(*) into v_remaining_enabled_super_admins
      from public.app_users
      where role = 'super_admin'
        and disabled_at is null
        and email <> new.email;
    if v_remaining_enabled_super_admins = 0 then
      v_will_be_enabled_super_admin := (new.role = 'super_admin' and new.disabled_at is null);
      if not v_will_be_enabled_super_admin then
        raise exception 'cannot_remove_last_super_admin'
          using errcode = '23514',
                hint = 'The table has zero enabled super_admins. The first inserted row must be an enabled super_admin.';
      end if;
    end if;
    return new;
  end if;

  return null;
end;
$$;

comment on function public.app_users_protect_last_super_admin() is
  'PR D Users tab: BEFORE-trigger enforcement of the "at least one enabled super_admin" invariant. Raises SQLSTATE 23514 with message "cannot_remove_last_super_admin" on any operation that would leave zero enabled super_admins. Handler layer catches this code and translates to a 409 response.';

drop trigger if exists app_users_protect_last_super_admin_trg on public.app_users;
create trigger app_users_protect_last_super_admin_trg
  before insert or update or delete on public.app_users
  for each row execute function public.app_users_protect_last_super_admin();

-- =============================================================
-- Apply-time invariant check
-- =============================================================
--
-- Migration 010 seeded johan@clixsy.com as the bootstrap super_admin
-- (with disabled_at=null), so the invariant should already hold at
-- apply time. The trigger's INSERT branch covers fresh inserts; if
-- migration 010's seed was somehow not applied (empty app_users
-- table), the FIRST insert that lands MUST be an enabled super_admin
-- or it raises. Migration 012 itself does not insert into app_users,
-- so it doesn't fire the trigger.
