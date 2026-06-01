-- =============================================================
-- 011_auth_audit_events
-- =============================================================
--
-- Phase 1 PR B of the Google OAuth + role-based access work.
-- Adds a dedicated audit table for events that originate on the
-- workbook's auth surface (sign-in attempts, access requests,
-- session-related actions) rather than inside an onboarding
-- session.
--
-- Why a new table instead of reusing onboarding_audit_events
-- ----------------------------------------------------------
-- onboarding_audit_events has session_id NOT NULL and a FK to
-- onboarding_sessions. Auth-layer events have no session — the
-- whole point of "Google sign-in attempted by email X" is that
-- X is not yet associated with anything in the workbook. Making
-- session_id nullable on the existing table would also blur
-- "what is this row about" for downstream consumers.
--
-- Separate table = separate lifecycle, separate access patterns,
-- separate (eventual) RLS once policies are defined per role.
-- The two tables share NOTHING in their schema beyond the trio
-- of (id, payload, created_at), which is convergence by accident
-- rather than design.
--
-- =============================================================
-- auth_audit_events — sign-in attempts, access requests, etc.
-- =============================================================
--
-- actor_email is nullable because not every event has a known
-- actor at write time. The Google OAuth callback writes a row
-- BEFORE checking app_users — at that point we have a verified
-- email from Google's id_token, so actor_email is set. But a
-- "request to /admin/auth/callback with no code param" event
-- has no actor yet; that row would have actor_email = null.
--
-- event_type is freeform text rather than a CHECK-constrained
-- enum. The set of event types will grow during Phase 1 (PR C
-- adds role-change events, PR D adds user-management events);
-- adding a CHECK now creates migration churn for each new
-- event. The convention is documented here and enforced at the
-- write call site (app/lib/auth-audit.ts).
--
-- Established event types (extend this list when adding):
--   - google_oauth_sign_in_succeeded
--       payload: { email, role, return_path }
--   - google_oauth_sign_in_rejected_not_in_app_users
--       payload: { email, access_request_id }
--   - google_oauth_sign_in_rejected_disabled
--       payload: { email }
--   - google_oauth_sign_in_rejected_non_clixsy_domain
--       payload: { email, reason }
--   - google_oauth_sign_in_rejected_email_not_verified
--       payload: { email }
--   - google_oauth_callback_error
--       payload: { stage, error_message }
--   - access_request_created
--       payload: { email, request_id }

create table if not exists public.auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_email text,
  payload jsonb,
  created_at timestamptz not null default now()
);

comment on table public.auth_audit_events is
  'Workbook auth-surface audit events (Google OAuth sign-in attempts, access requests, role changes). See migration 011 header for the established event_type values and payload shape per type.';

-- Index for the common "recent events" query in the upcoming
-- super-admin Users tab (Phase 1 PR D). Descending so the
-- newest rows are at the start of the scan.
create index if not exists auth_audit_events_created_at_idx
  on public.auth_audit_events (created_at desc);

-- =============================================================
-- Row Level Security — default-deny for anon + authenticated
-- =============================================================
--
-- Same shape as migration 010. The onboarding repo ships the
-- Supabase anon key to the browser; without RLS, a client could
-- in principle read this audit log via the anon key. RLS off
-- → that's a sign-in-attempt log accessible to anyone with the
-- anon key. Not a thing we want.
--
-- The workbook writes to this table exclusively from server-
-- side code using SUPABASE_SERVICE_ROLE_KEY (the callback
-- handler and the audit helper). Service-role bypasses RLS by
-- design, so enabling RLS without any policies is the right
-- shape: anon + authenticated keys get default-deny.

alter table public.auth_audit_events enable row level security;
