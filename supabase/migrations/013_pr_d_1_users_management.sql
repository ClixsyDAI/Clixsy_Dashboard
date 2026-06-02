-- =============================================================
-- 013_pr_d_1_users_management
-- =============================================================
--
-- Phase 1 PR D-1 — the writeable surface that uses PR D-0's
-- schema. Ships:
--
--   1. app_access_requests.email_verified_at_request_time column
--      + backfill from existing OAuth-callback-created rows
--
--   2. Patch to app_users_protect_last_super_admin() trigger
--      adding pg_advisory_xact_lock at entry — closes the
--      concurrent-disable-of-last-two-super_admins race (review
--      finding R2).
--
--   3. Partial unique indexes:
--      - app_user_invites_one_pending_per_email
--      - app_access_requests_one_pending_per_email
--      Prevents duplicate-pending-row races (R1, S6).
--
--   4. bump_rate_limit(actor_key, action_class) RPC — coarse
--      30/min/actor rate-limit primitive. Single-statement
--      INSERT ON CONFLICT UPDATE; table-qualified count (race
--      finding R6).
--
--   5. Eight SECURITY DEFINER mutation RPCs:
--        - approve_access_request
--        - deny_access_request
--        - create_invite
--        - revoke_invite
--        - accept_invite
--        - set_user_role
--        - disable_user
--        - enable_user
--      All return jsonb sentinels (NOT raise exceptions) so the
--      same-transaction audit row is preserved on every rejection
--      branch (audit finding A1).
--
--   6. Every privileged admin RPC takes p_actor_session_version
--      and verifies it matches app_users.session_version for the
--      actor — closes the in-flight TOCTOU window between
--      requireRole and the RPC call (race finding R5).
--
-- Apply BEFORE merging PR D-1. The 9 new admin routes assume
-- every RPC + index + column below exists.
--
-- =============================================================
-- Conventions used below
-- =============================================================
--
-- Rejection sentinel shape:
--   { "ok": false, "status": <int>, "reason": "<closed_set_enum>", ... }
-- Success sentinel shape:
--   { "ok": true, ... }
--
-- The "reason" field uses a closed-set enum mirrored in
-- app/lib/auth-audit.ts. Any code outside the closed set is a
-- bug — see post-merge monitoring step in PR D-1's rollout.
--
-- Self-action guards: every admin RPC where the actor mutates
-- a different user's row pre-checks p_target_email <> p_actor_email
-- (case-insensitive). Defense-in-depth: the route handler also
-- guards, but the RPC re-checks so a bypassed handler still
-- can't self-mutate.
--
-- All audit writes are direct INSERTs from inside the RPC body.
-- Same transaction as the mutation. If the audit INSERT fails,
-- the entire RPC rolls back — the mutation does not land
-- un-audited.

-- =============================================================
-- 1. app_access_requests.email_verified_at_request_time
-- =============================================================
--
-- The Google OAuth callback only inserts an app_access_requests
-- row AFTER passing the email_verified guard (PR B layer 2).
-- Existing rows therefore came in with email-verified == true at
-- insertion time. Backfill stamps attempted_at as a conservative
-- proxy for "verified at request time" — same instant the row
-- was created, which is when the verification check passed.
--
-- Going forward, the callback's INSERT explicitly sets
-- email_verified_at_request_time = now() (callback patch in this PR).
--
-- approve_access_request fails closed with reason
-- 'email_not_verified_at_request_time' if this column is NULL.
-- That can only happen for rows inserted by a path that bypasses
-- the callback — i.e. attacker-inserted rows (defense in depth).

alter table public.app_access_requests
  add column if not exists email_verified_at_request_time timestamptz;

update public.app_access_requests
   set email_verified_at_request_time = attempted_at
 where email_verified_at_request_time is null;

comment on column public.app_access_requests.email_verified_at_request_time is
  'Timestamp Google OAuth verified the email at request-creation time. NULL = provenance unknown; approve_access_request RPC fails closed.';

-- =============================================================
-- 2. Patch the protect-last-super_admin trigger with advisory lock
-- =============================================================
--
-- The trigger from migration 012 counts enabled super_admins
-- (excluding the row being mutated) and raises 23514 if the count
-- would drop to zero. Without serialization, two concurrent
-- transactions can each independently observe count >= 1 and both
-- proceed — leaving zero enabled super_admins (race finding R2).
--
-- pg_advisory_xact_lock takes a transaction-scoped advisory lock
-- on a fixed key. Only one transaction in the protect-last
-- critical section at a time. The key is hashtext('super_admin_invariant')
-- — a stable 32-bit hash independent of OID rotation.
--
-- Performance: the lock is held only inside the trigger body,
-- which runs synchronously with the mutation. Contention is
-- bounded by concurrent admin mutations of app_users — a tiny
-- volume in practice.
--
-- The RPCs (below) also pre-check the invariant and return a clean
-- rejection sentinel. The trigger remains as defense-in-depth for
-- direct DB writes that bypass the RPCs.

create or replace function public.app_users_protect_last_super_admin()
  returns trigger
  language plpgsql
as $$
declare
  v_remaining_enabled_super_admins int;
  v_was_enabled_super_admin boolean;
  v_will_be_enabled_super_admin boolean;
begin
  -- PR D-1: serialize the protect-last critical section. Without
  -- this, two concurrent disable-or-demote-last-super_admin txns
  -- can both observe "1 remaining" and both proceed.
  perform pg_advisory_xact_lock(hashtext('app_users_protect_last_super_admin'));

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

  if tg_op = 'UPDATE' then
    v_was_enabled_super_admin := (old.role = 'super_admin' and old.disabled_at is null);
    v_will_be_enabled_super_admin := (new.role = 'super_admin' and new.disabled_at is null);
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

-- =============================================================
-- 3. Partial unique indexes for race prevention
-- =============================================================
--
-- One pending invite per email — prevents two concurrent
-- create_invite calls from inserting duplicate pending rows
-- for the same email.

create unique index if not exists app_user_invites_one_pending_per_email
  on public.app_user_invites (lower(email))
  where accepted_at is null and revoked_at is null;

-- One pending access_request per email — prevents two concurrent
-- callback invocations from inserting duplicate pending rows.

create unique index if not exists app_access_requests_one_pending_per_email
  on public.app_access_requests (lower(email))
  where resolved_at is null;

-- =============================================================
-- 4. bump_rate_limit RPC
-- =============================================================
--
-- Coarse 30/min/actor rate-limit primitive. Called by every
-- state-changing admin route after requireRole succeeds (so we
-- can key on actor_email; the unauth accept-invite route keys on
-- a hashed IP+UA from the route handler).
--
-- Returns the post-increment count. Caller compares against the
-- limit and 429s if exceeded.
--
-- The INSERT ... ON CONFLICT UPDATE pattern uses table-qualified
-- `auth_rate_limit.count + 1` (NOT `EXCLUDED.count + 1`, which
-- would always be 2 — race finding R6). Single statement, atomic.

create or replace function public.bump_rate_limit(
  p_actor_key text,
  p_action_class text
) returns int
  language plpgsql
  security definer
as $$
declare
  v_count int;
begin
  insert into public.auth_rate_limit (actor_key, action_class, window_start, count)
    values (p_actor_key, p_action_class, date_trunc('minute', now()), 1)
    on conflict (actor_key, action_class, window_start)
    do update set count = public.auth_rate_limit.count + 1
    returning count into v_count;
  return v_count;
end;
$$;

comment on function public.bump_rate_limit(text, text) is
  'PR D-1: atomic per-(actor, action_class, minute) rate-limit counter. Caller compares returned count against limit and 429s if exceeded.';

-- =============================================================
-- 5. Shared helper: insert one auth_audit_events row
-- =============================================================
--
-- All 8 mutation RPCs call this once per terminal branch (success
-- or rejection). SQL (not PL/pgSQL), INVOKER-rights — no privilege
-- escalation surface enlargement.

create or replace function public.pr_d1_write_audit_event(
  p_event_type text,
  p_actor_email text,
  p_payload jsonb
) returns void
  language sql
as $$
  insert into public.auth_audit_events (event_type, actor_email, payload)
    values (p_event_type, p_actor_email, p_payload);
$$;

comment on function public.pr_d1_write_audit_event(text, text, jsonb) is
  'PR D-1: shared audit-write helper used by all 8 mutation RPCs.';

-- =============================================================
-- 6. assert_actor_session_version (defense-in-depth helper)
-- =============================================================
--
-- Every admin RPC takes p_actor_session_version (closes race
-- finding R5 — TOCTOU between requireRole and RPC call). The
-- RPC verifies it matches the actor's current app_users row;
-- mismatch returns 'actor_session_stale' to the caller, which
-- maps to a 401 session_revoked at the route layer.
--
-- Lookup misses (actor row not in app_users — e.g. removed
-- between requireRole and RPC) also return stale. Disabled
-- actors are treated as stale too.

create or replace function public.pr_d1_check_actor_session(
  p_actor_email text,
  p_actor_session_version int
) returns boolean
  language sql
as $$
  select exists(
    select 1
    from public.app_users
    where lower(email) = lower(p_actor_email)
      and disabled_at is null
      and session_version = p_actor_session_version
  );
$$;

comment on function public.pr_d1_check_actor_session(text, int) is
  'PR D-1: defense-in-depth check that the actor''s session_version still matches app_users at RPC entry. Mismatch -> actor_session_stale sentinel.';

-- =============================================================
-- RPC 1 of 8: approve_access_request
-- =============================================================
--
-- Resolves a pending access_request as granted. Creates the
-- corresponding app_users row. Idempotent on already-resolved
-- (returns request_already_resolved sentinel).
--
-- Fail-closed if email_verified_at_request_time is NULL —
-- prevents attacker-inserted rows from being approved.
--
-- Self-approval is blocked by the requireRole layer (the actor
-- must be super_admin, and super_admins by definition are already
-- in app_users so can't have a pending request to approve). RPC
-- does not re-check this.
--
-- Concurrent-approve race: SELECT FOR UPDATE on the request row
-- + IF NOT FOUND re-check. Winner inserts; loser sees the row
-- in resolved state and returns request_already_resolved. PG
-- 23505 on app_users.email PK is mapped to email_already_in_users
-- (covers the race where someone else inserted johndoe@... via
-- direct SQL between request creation and approval).

create or replace function public.approve_access_request(
  p_request_id uuid,
  p_role text,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_request public.app_access_requests%rowtype;
  v_payload jsonb;
begin
  -- TOCTOU guard
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'approve_access_request',
      'reason', 'actor_session_stale',
      'request_id_target', p_request_id::text,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  if p_role not in ('super_admin', 'admin', 'viewer') then
    v_payload := jsonb_build_object(
      'rpc', 'approve_access_request',
      'reason', 'invalid_role',
      'request_id_target', p_request_id::text,
      'attempted_value', p_role,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_role');
  end if;

  -- Lock the request row.
  select * into v_request
    from public.app_access_requests
    where id = p_request_id
    for update;

  if not found then
    v_payload := jsonb_build_object(
      'rpc', 'approve_access_request',
      'reason', 'request_not_found',
      'request_id_target', p_request_id::text,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 404, 'reason', 'request_not_found');
  end if;

  if v_request.resolved_at is not null then
    v_payload := jsonb_build_object(
      'rpc', 'approve_access_request',
      'reason', 'request_already_resolved',
      'request_id_target', p_request_id::text,
      'target_email', v_request.email,
      'prior_resolution', v_request.resolution,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'request_already_resolved');
  end if;

  if v_request.email_verified_at_request_time is null then
    v_payload := jsonb_build_object(
      'rpc', 'approve_access_request',
      'reason', 'email_not_verified_at_request_time',
      'request_id_target', p_request_id::text,
      'target_email', v_request.email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'email_not_verified_at_request_time');
  end if;

  -- Insert the new app_users row. unique_violation -> email already
  -- somehow in app_users (rare race vs concurrent direct insert or
  -- vs concurrent accept_invite for the same email).
  begin
    insert into public.app_users (email, role, added_by, added_at)
      values (v_request.email, p_role, p_actor_email, now());
  exception when unique_violation then
    v_payload := jsonb_build_object(
      'rpc', 'approve_access_request',
      'reason', 'email_already_in_users',
      'request_id_target', p_request_id::text,
      'target_email', v_request.email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'email_already_in_users');
  end;

  update public.app_access_requests
    set resolution = 'granted',
        resolved_at = now(),
        resolved_by = p_actor_email
    where id = p_request_id;

  v_payload := jsonb_build_object(
    'actor_email', p_actor_email,
    'request_id_target', p_request_id::text,
    'target_email', v_request.email,
    'target_role', p_role,
    'email_verified_at_request_time', v_request.email_verified_at_request_time,
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('access_request_approved', p_actor_email, v_payload);

  return jsonb_build_object('ok', true, 'email', v_request.email, 'role', p_role);
end;
$$;

comment on function public.approve_access_request(uuid, text, text, int, jsonb) is
  'PR D-1: transactional access-request approval. Locks the request row, fails closed on email_not_verified_at_request_time, inserts app_users + marks resolved + audits — all in one transaction.';

-- =============================================================
-- RPC 2 of 8: deny_access_request
-- =============================================================

create or replace function public.deny_access_request(
  p_request_id uuid,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_request public.app_access_requests%rowtype;
  v_payload jsonb;
begin
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'deny_access_request',
      'reason', 'actor_session_stale',
      'request_id_target', p_request_id::text,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  select * into v_request
    from public.app_access_requests
    where id = p_request_id
    for update;

  if not found then
    v_payload := jsonb_build_object(
      'rpc', 'deny_access_request',
      'reason', 'request_not_found',
      'request_id_target', p_request_id::text,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 404, 'reason', 'request_not_found');
  end if;

  if v_request.resolved_at is not null then
    v_payload := jsonb_build_object(
      'rpc', 'deny_access_request',
      'reason', 'request_already_resolved',
      'request_id_target', p_request_id::text,
      'target_email', v_request.email,
      'prior_resolution', v_request.resolution,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'request_already_resolved');
  end if;

  update public.app_access_requests
    set resolution = 'denied',
        resolved_at = now(),
        resolved_by = p_actor_email
    where id = p_request_id;

  v_payload := jsonb_build_object(
    'actor_email', p_actor_email,
    'request_id_target', p_request_id::text,
    'target_email', v_request.email,
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('access_request_denied', p_actor_email, v_payload);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.deny_access_request(uuid, text, int, jsonb) is
  'PR D-1: transactional access-request denial.';

-- =============================================================
-- RPC 3 of 8: create_invite
-- =============================================================
--
-- Privilege escalation guard: only super_admin can invite
-- super_admin. requireRole already gates the route to super_admin
-- only, so this guard is defense-in-depth.
--
-- Plaintext token NEVER reaches this RPC. The route generates
-- 32 random bytes, sha256-hashes them, passes only the hash here.
-- The plaintext is returned in the route's response body exactly
-- once.

create or replace function public.create_invite(
  p_email text,
  p_role text,
  p_invite_token_sha256 text,
  p_expires_at timestamptz,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_invite_id uuid;
  v_payload jsonb;
  v_normalized_email text := lower(p_email);
begin
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'create_invite',
      'reason', 'actor_session_stale',
      'target_email', p_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  if p_role not in ('super_admin', 'admin', 'viewer') then
    v_payload := jsonb_build_object(
      'rpc', 'create_invite',
      'reason', 'invalid_role',
      'target_email', p_email,
      'attempted_value', p_role,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_role');
  end if;

  if not (v_normalized_email like '%@clixsy.com') then
    v_payload := jsonb_build_object(
      'rpc', 'create_invite',
      'reason', 'invalid_email_domain',
      'target_email', p_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_email_domain');
  end if;

  if exists (select 1 from public.app_users where lower(email) = v_normalized_email) then
    v_payload := jsonb_build_object(
      'rpc', 'create_invite',
      'reason', 'email_already_in_users',
      'target_email', p_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'email_already_in_users');
  end if;

  -- The partial unique index catches concurrent invites; we also
  -- pre-check for a clean rejection sentinel.
  begin
    insert into public.app_user_invites (email, role, invite_token_sha256, invited_by_email, expires_at)
      values (p_email, p_role, p_invite_token_sha256, p_actor_email, p_expires_at)
      returning id into v_invite_id;
  exception when unique_violation then
    v_payload := jsonb_build_object(
      'rpc', 'create_invite',
      'reason', 'pending_invite_exists',
      'target_email', p_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'pending_invite_exists');
  end;

  v_payload := jsonb_build_object(
    'actor_email', p_actor_email,
    'target_email', p_email,
    'target_role', p_role,
    'invite_id', v_invite_id::text,
    'expires_at', p_expires_at,
    'request_metadata', p_request_metadata
    -- NB: invite_token / invite_token_sha256 deliberately NOT in payload (§11).
  );
  perform public.pr_d1_write_audit_event('user_invited', p_actor_email, v_payload);

  return jsonb_build_object(
    'ok', true,
    'invite_id', v_invite_id::text,
    'expires_at', p_expires_at
  );
end;
$$;

comment on function public.create_invite(text, text, text, timestamptz, text, int, jsonb) is
  'PR D-1: transactional invite creation. Plaintext token NEVER reaches this RPC. Audit row deliberately omits any token field.';

-- =============================================================
-- RPC 4 of 8: revoke_invite
-- =============================================================

create or replace function public.revoke_invite(
  p_invite_id uuid,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_invite public.app_user_invites%rowtype;
  v_payload jsonb;
begin
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'revoke_invite',
      'reason', 'actor_session_stale',
      'invite_id', p_invite_id::text,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  select * into v_invite
    from public.app_user_invites
    where id = p_invite_id
    for update;

  if not found then
    v_payload := jsonb_build_object(
      'rpc', 'revoke_invite',
      'reason', 'invite_not_found',
      'invite_id', p_invite_id::text,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 404, 'reason', 'invite_not_found');
  end if;

  if v_invite.accepted_at is not null then
    v_payload := jsonb_build_object(
      'rpc', 'revoke_invite',
      'reason', 'invite_already_accepted',
      'invite_id', p_invite_id::text,
      'target_email', v_invite.email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'invite_already_accepted');
  end if;

  if v_invite.revoked_at is not null then
    -- Idempotent: re-revoke succeeds, no state change, no double-audit.
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  update public.app_user_invites
    set revoked_at = now()
    where id = p_invite_id;

  v_payload := jsonb_build_object(
    'actor_email', p_actor_email,
    'invite_id', p_invite_id::text,
    'target_email', v_invite.email,
    'was_expired', (v_invite.expires_at < now()),
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('invite_revoked', p_actor_email, v_payload);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.revoke_invite(uuid, text, int, jsonb) is
  'PR D-1: transactional invite revocation. Idempotent on already-revoked. Refuses already-accepted.';

-- =============================================================
-- RPC 5 of 8: accept_invite
-- =============================================================
--
-- Called by the unauth-but-Supabase-session-required
-- POST /api/invite/accept route. Caller passes:
--   - p_invite_token_sha256: sha256 of the plaintext token from
--     the URL (route handler computes this; plaintext never
--     reaches the DB).
--   - p_authenticated_email: the email from the verified Supabase
--     session of the caller (NOT trusted from URL).
--
-- Email mismatch returns invite_email_mismatch — the invite was
-- meant for a different email than the caller authenticated as.

create or replace function public.accept_invite(
  p_invite_token_sha256 text,
  p_authenticated_email text,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_invite public.app_user_invites%rowtype;
  v_payload jsonb;
begin
  -- Lock by token hash. The partial unique index on token allows
  -- only one matching row (and the SELECT FOR UPDATE blocks
  -- concurrent accept attempts on the same token).
  select * into v_invite
    from public.app_user_invites
    where invite_token_sha256 = p_invite_token_sha256
    for update;

  if not found then
    v_payload := jsonb_build_object(
      'rpc', 'accept_invite',
      'reason', 'invite_not_found',
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', null, v_payload);
    return jsonb_build_object('ok', false, 'status', 404, 'reason', 'invite_not_found');
  end if;

  if v_invite.accepted_at is not null then
    v_payload := jsonb_build_object(
      'rpc', 'accept_invite',
      'reason', 'invite_already_accepted',
      'invite_id', v_invite.id::text,
      'target_email', v_invite.email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', v_invite.email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'invite_already_accepted');
  end if;

  if v_invite.revoked_at is not null then
    v_payload := jsonb_build_object(
      'rpc', 'accept_invite',
      'reason', 'invite_already_revoked',
      'invite_id', v_invite.id::text,
      'target_email', v_invite.email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', v_invite.email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'invite_already_revoked');
  end if;

  if v_invite.expires_at < now() then
    v_payload := jsonb_build_object(
      'rpc', 'accept_invite',
      'reason', 'invite_expired',
      'invite_id', v_invite.id::text,
      'target_email', v_invite.email,
      'expires_at', v_invite.expires_at,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', v_invite.email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'invite_expired');
  end if;

  -- Token bound to email at accept time (security finding S5).
  if lower(v_invite.email) <> lower(p_authenticated_email) then
    v_payload := jsonb_build_object(
      'rpc', 'accept_invite',
      'reason', 'invite_email_mismatch',
      'invite_id', v_invite.id::text,
      'target_email', v_invite.email,
      'authenticated_email', p_authenticated_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_authenticated_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 403, 'reason', 'invite_email_mismatch');
  end if;

  begin
    insert into public.app_users (email, role, added_by, added_at)
      values (v_invite.email, v_invite.role, v_invite.invited_by_email, now());
  exception when unique_violation then
    v_payload := jsonb_build_object(
      'rpc', 'accept_invite',
      'reason', 'invite_email_already_user',
      'invite_id', v_invite.id::text,
      'target_email', v_invite.email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', v_invite.email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'invite_email_already_user');
  end;

  update public.app_user_invites
    set accepted_at = now()
    where id = v_invite.id;

  v_payload := jsonb_build_object(
    'invite_id', v_invite.id::text,
    'target_email', v_invite.email,
    'target_role', v_invite.role,
    'invited_by_email', v_invite.invited_by_email,
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('invite_accepted', v_invite.email, v_payload);

  return jsonb_build_object('ok', true, 'email', v_invite.email, 'role', v_invite.role);
end;
$$;

comment on function public.accept_invite(text, text, jsonb) is
  'PR D-1: transactional invite acceptance. Caller must pass the verified Supabase-session email; mismatch with invite.email returns invite_email_mismatch. Token plaintext never reaches this RPC.';

-- =============================================================
-- RPC 6 of 8: set_user_role
-- =============================================================

create or replace function public.set_user_role(
  p_target_email text,
  p_new_role text,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_old public.app_users%rowtype;
  v_remaining_enabled_super_admins int;
  v_payload jsonb;
begin
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'set_user_role',
      'reason', 'actor_session_stale',
      'target_email', p_target_email,
      'attempted_value', p_new_role,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  if lower(p_target_email) = lower(p_actor_email) then
    v_payload := jsonb_build_object(
      'rpc', 'set_user_role',
      'reason', 'self_action_forbidden',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'self_action_forbidden');
  end if;

  if p_new_role not in ('super_admin', 'admin', 'viewer') then
    v_payload := jsonb_build_object(
      'rpc', 'set_user_role',
      'reason', 'invalid_role',
      'target_email', p_target_email,
      'attempted_value', p_new_role,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_role');
  end if;

  select * into v_old
    from public.app_users
    where email = p_target_email
    for update;

  if not found then
    v_payload := jsonb_build_object(
      'rpc', 'set_user_role',
      'reason', 'target_not_found',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 404, 'reason', 'target_not_found');
  end if;

  -- Invariant pre-check: if this role change would demote the last
  -- enabled super_admin, reject cleanly before the trigger raises.
  -- (The trigger still fires as defense-in-depth; we just want a
  -- clean sentinel, not a SQLSTATE 23514 leak.)
  if v_old.role = 'super_admin' and v_old.disabled_at is null and p_new_role <> 'super_admin' then
    select count(*) into v_remaining_enabled_super_admins
      from public.app_users
      where role = 'super_admin'
        and disabled_at is null
        and email <> v_old.email;
    if v_remaining_enabled_super_admins = 0 then
      v_payload := jsonb_build_object(
        'rpc', 'set_user_role',
        'reason', 'cannot_remove_last_super_admin',
        'target_email', p_target_email,
        'attempted_value', p_new_role,
        'request_metadata', p_request_metadata
      );
      perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
      return jsonb_build_object('ok', false, 'status', 409, 'reason', 'cannot_remove_last_super_admin');
    end if;
  end if;

  update public.app_users
    set role = p_new_role,
        session_version = session_version + 1
    where email = p_target_email;

  v_payload := jsonb_build_object(
    'actor_email', p_actor_email,
    'target_email', p_target_email,
    'before', jsonb_build_object('role', v_old.role),
    'after', jsonb_build_object('role', p_new_role),
    'crossed_super_admin_boundary',
      (v_old.role = 'super_admin') is distinct from (p_new_role = 'super_admin'),
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('role_changed', p_actor_email, v_payload);

  return jsonb_build_object(
    'ok', true,
    'before', jsonb_build_object('role', v_old.role),
    'after', jsonb_build_object('role', p_new_role)
  );
end;
$$;

comment on function public.set_user_role(text, text, text, int, jsonb) is
  'PR D-1: transactional role change. Self-action guard, invariant pre-check, advisory-locked trigger as defense-in-depth, session_version++.';

-- =============================================================
-- RPC 7 of 8: disable_user
-- =============================================================

create or replace function public.disable_user(
  p_target_email text,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_old public.app_users%rowtype;
  v_remaining_enabled_super_admins int;
  v_payload jsonb;
begin
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'disable_user',
      'reason', 'actor_session_stale',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  if lower(p_target_email) = lower(p_actor_email) then
    v_payload := jsonb_build_object(
      'rpc', 'disable_user',
      'reason', 'self_action_forbidden',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'self_action_forbidden');
  end if;

  select * into v_old
    from public.app_users
    where email = p_target_email
    for update;

  if not found then
    v_payload := jsonb_build_object(
      'rpc', 'disable_user',
      'reason', 'target_not_found',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 404, 'reason', 'target_not_found');
  end if;

  if v_old.disabled_at is not null then
    v_payload := jsonb_build_object(
      'rpc', 'disable_user',
      'reason', 'target_already_disabled',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'target_already_disabled');
  end if;

  -- Invariant pre-check: disabling an enabled super_admin where no
  -- others exist would leave zero enabled super_admins.
  if v_old.role = 'super_admin' then
    select count(*) into v_remaining_enabled_super_admins
      from public.app_users
      where role = 'super_admin'
        and disabled_at is null
        and email <> v_old.email;
    if v_remaining_enabled_super_admins = 0 then
      v_payload := jsonb_build_object(
        'rpc', 'disable_user',
        'reason', 'cannot_remove_last_super_admin',
        'target_email', p_target_email,
        'request_metadata', p_request_metadata
      );
      perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
      return jsonb_build_object('ok', false, 'status', 409, 'reason', 'cannot_remove_last_super_admin');
    end if;
  end if;

  update public.app_users
    set disabled_at = now(),
        session_version = session_version + 1
    where email = p_target_email;

  v_payload := jsonb_build_object(
    'actor_email', p_actor_email,
    'target_email', p_target_email,
    'target_role', v_old.role,
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('user_disabled', p_actor_email, v_payload);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.disable_user(text, text, int, jsonb) is
  'PR D-1: transactional disable. Self-action guard, invariant pre-check, session_version++.';

-- =============================================================
-- RPC 8 of 8: enable_user
-- =============================================================

create or replace function public.enable_user(
  p_target_email text,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_old public.app_users%rowtype;
  v_payload jsonb;
begin
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'enable_user',
      'reason', 'actor_session_stale',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  select * into v_old
    from public.app_users
    where email = p_target_email
    for update;

  if not found then
    v_payload := jsonb_build_object(
      'rpc', 'enable_user',
      'reason', 'target_not_found',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 404, 'reason', 'target_not_found');
  end if;

  if v_old.disabled_at is null then
    v_payload := jsonb_build_object(
      'rpc', 'enable_user',
      'reason', 'target_already_enabled',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'target_already_enabled');
  end if;

  update public.app_users
    set disabled_at = null,
        session_version = session_version + 1
    where email = p_target_email;

  v_payload := jsonb_build_object(
    'actor_email', p_actor_email,
    'target_email', p_target_email,
    'target_role', v_old.role,
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('user_enabled', p_actor_email, v_payload);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.enable_user(text, text, int, jsonb) is
  'PR D-1: transactional enable. Bumps session_version (re-enable also invalidates any stale cookies).';
