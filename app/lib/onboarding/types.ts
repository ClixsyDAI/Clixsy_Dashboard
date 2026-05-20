// =============================================================
// Onboarding-tab DB types (hand-typed, narrow read shape)
// =============================================================
//
// Phase 1 hand-types the rows the workbook reads from the shared
// Supabase project. These mirror the actual DB columns (NOT the
// onboarding tool's internal TS interface, which is known to drift
// — see onboarding audit §10.B.5).
//
// Phase 2 will replace these with codegen:
//
//     npx supabase gen types typescript \
//       --project-id lawwsutjxopiekjzupef \
//       > app/lib/onboarding/types.gen.ts
//
// We're hand-typing for Phase 1 because (a) the read shape is
// narrow, (b) we want the file to be human-reviewable during
// initial wiring, and (c) codegen pulls the entire schema which
// is more than we need this round.
//
// Columns are taken from:
//   - 001_initial_schema.sql  (clients, onboarding_sessions, onboarding_answers)
//   - 003_site_intelligence.sql (clients.website_url, sessions.site_intelligence_id + snapshots)
//   - 005_p1_p2_admin_session_fields.sql (account_manager, vertical, pin_*)
//   - 006_welcome_wizard_seen.sql (welcome_wizard_seen)
//   - 007_feedback_fields.sql (feedback_rating, feedback_submitted_at)
//   - 008_workbook_tab_tables.sql (clients.workbook_id, three new audit-ish tables)

// =============================================================
// Read shape used by the by-workbook-id route
// =============================================================

export interface ClientRow {
  id: string;                          // UUID
  agency_id: string;                   // UUID
  client_name: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  website_url: string | null;          // from 003
  workbook_id: number | null;          // from 008 — BIGINT, joins to projects.json[].id
  created_at: string;                  // ISO timestamp
}

export type SessionStatus = "draft" | "in_progress" | "submitted";

export interface OnboardingSessionRow {
  id: string;                          // UUID
  agency_id: string;
  client_id: string;
  token: string;                       // 64-hex public form token
  status: SessionStatus;               // CHECK constraint, 3 values
  current_step: number;                // 0..12
  last_saved_at: string | null;
  submitted_at: string | null;
  logo_path: string | null;
  logo_url: string | null;
  created_at: string;
  flow_version: "v1" | "v2";

  // Stage 005 — account manager + vertical
  account_manager: string | null;
  vertical: "law_firm" | "home_services";

  // Stage 005 — PIN gate state
  pin_hash: string | null;             // scrypt$N$r$p$saltHex$derivedHex
  pin_attempts: number;
  pin_lockout_until: string | null;
  pin_locked_at: string | null;

  // Stage 006 — first-login welcome wizard
  welcome_wizard_seen: boolean;

  // Stage 007 — post-submit feedback
  feedback_rating: number | null;      // 1..5
  feedback_submitted_at: string | null;

  // Stage 003 — site intelligence linkage + snapshots
  site_intelligence_id: string | null; // UUID
  si_prefill_snapshot: unknown | null;
  si_overrides_snapshot: unknown | null;
  si_branding_snapshot: unknown | null;
  si_insights_snapshot: unknown | null;
}

export interface OnboardingAnswerRow {
  id: string;
  session_id: string;
  step_key: string;                    // one of the 12 keys; see step-keys.ts
  answers: Record<string, unknown>;    // JSONB; shape varies per step
  completed: boolean;
  updated_at: string;
}

// =============================================================
// Tables created in migration 008 — empty in Phase 1, included
// here for completeness so later phases don't have to re-type
// =============================================================

export type ReminderKind = "form_reminder" | "access_request";

export interface OnboardingOpenEventRow {
  id: string;
  session_id: string;
  opened_at: string;
  user_agent: string | null;
  ip_hash: string | null;              // sha256(ip || HMAC secret)
  created_at: string;
}

export interface OnboardingReminderRow {
  id: string;
  session_id: string;
  kind: ReminderKind;
  sent_by_label: string | null;
  sent_at: string;
  email_subject: string;
  email_body: string;
  created_at: string;
}

export interface OnboardingFieldEditRow {
  id: string;
  session_id: string;
  step_key: string;
  field_key: string;
  old_value: unknown | null;           // JSONB
  new_value: unknown | null;           // JSONB
  edited_by_label: string | null;
  edited_at: string;
  created_at: string;
}

// =============================================================
// Combined payload shape returned by the by-workbook-id route
// =============================================================

export interface OnboardingByWorkbookIdPayload {
  client: ClientRow;
  session: OnboardingSessionRow;
  answers: OnboardingAnswerRow[];
}
