-- =============================================================
-- 010_app_users_and_access_requests
-- =============================================================
--
-- Phase 1 of the Google OAuth + role-based access work for the
-- workbook dashboard. Two new tables that live in the shared
-- Supabase project (lawwsutjxopiekjzupef) alongside the onboarding
-- repo's schema.
--
-- The workbook owns these tables — they back the workbook's auth
-- surface, not the onboarding form. Numbering continues from the
-- onboarding repo's 009_workbook_id_text_type.sql for a single
-- shared migration history.
--
-- =============================================================
-- app_users — who is allowed into the workbook + at what level
-- =============================================================
--
-- The three-tier role hierarchy: super_admin > admin > viewer.
--   - super_admin: can manage the user list, plus everything below
--   - admin: write access to all workbook data, no user management
--   - viewer: read-only access to /client/[id] dashboards
--
-- added_by is a self-reference so the audit trail captures "who
-- granted this access." Nullable for the seed super-admin and for
-- any row whose grantor has since been removed (ON DELETE SET
-- NULL preserves the row but loses the attribution — acceptable
-- tradeoff vs cascading deletes that would silently wipe the user
-- list when a super-admin is removed).
--
-- disabled_at is a soft-delete. Setting it to a timestamp revokes
-- access without removing the row, so the audit history (and the
-- added_by foreign key from any user this person granted) stays
-- intact. Re-enable by clearing the column back to NULL.

create table if not exists public.app_users (
  email text primary key,
  role text not null check (role in ('super_admin', 'admin', 'viewer')),
  added_by text references public.app_users(email) on delete set null,
  added_at timestamptz not null default now(),
  disabled_at timestamptz,
  notes text
);

comment on table public.app_users is
  'Workbook dashboard user list. Three-tier role hierarchy (super_admin > admin > viewer). disabled_at is a soft-delete; null means active.';

-- Seed the bootstrap super-admin. added_by is null because there
-- is no prior super-admin to attribute the grant to.
insert into public.app_users (email, role, added_by, notes)
values (
  'johan@clixsy.com',
  'super_admin',
  null,
  'Bootstrap super-admin seeded by migration 010 — Phase 1 of Google OAuth rollout.'
)
on conflict (email) do nothing;

-- =============================================================
-- app_access_requests — Google sign-ins from non-listed emails
-- =============================================================
--
-- Anyone in the clixsy.com Google Workspace can attempt to sign
-- in via OAuth (the hosted_domain restriction at the Supabase
-- Auth layer rejects non-@clixsy.com accounts before they reach
-- the app). If their email is NOT in app_users, the callback
-- inserts a row here and shows them /admin/access-pending.
--
-- A super-admin reviews pending requests in the Users tab and
-- either grants access (which also adds a row to app_users) or
-- denies. Resolved requests stay in the table for audit.
--
-- The email column intentionally has NO foreign key to app_users
-- — at request time the email isn't in app_users (that's the
-- whole point of the table). Granting access creates the
-- app_users row; resolving the request just updates the
-- resolution columns here.

create table if not exists public.app_access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  attempted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text references public.app_users(email) on delete set null,
  resolution text check (resolution in ('granted', 'denied'))
);

comment on table public.app_access_requests is
  'Pending + resolved access requests from Google sign-ins by emails not yet in app_users. Reviewed by super_admins in the Users tab.';

-- Index for the common "list pending" query in the Users tab.
create index if not exists app_access_requests_pending_idx
  on public.app_access_requests (attempted_at desc)
  where resolved_at is null;

-- =============================================================
-- Row Level Security — default-deny for anon + authenticated
-- =============================================================
--
-- The onboarding repo (client-onboarding-tool, same Supabase
-- project) ships NEXT_PUBLIC_SUPABASE_ANON_KEY to the browser
-- because its public onboarding form needs client-side Supabase
-- access. If RLS is off here, a client filling that form could
-- in principle use the anon key to read the workbook admin list.
-- That's not a thing we want.
--
-- The workbook accesses these two tables exclusively from
-- server-side code using SUPABASE_SERVICE_ROLE_KEY (verified:
-- workbook has no client-side Supabase usage, the anon key never
-- reaches its browser bundle). Service-role bypasses RLS by
-- design, so enabling RLS without any policies is the right
-- shape: anon + authenticated keys get default-deny, server-side
-- service-role works exactly as if RLS were off.
--
-- If a future phase needs client-side reads from these tables
-- (unlikely — auth state already flows through the app_session
-- cookie + /api/admin/auth/session endpoint), add specific
-- policies then rather than weakening this default.

alter table public.app_users enable row level security;
alter table public.app_access_requests enable row level security;
