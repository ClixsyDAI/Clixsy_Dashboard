// =============================================================
// Onboarding-tab DB types — re-export shim over codegen
// =============================================================
//
// Phase 2 swap (from hand-typed to codegen, per phase-2-plan.md §3.2).
// Underlying generated types live in `./types.gen.ts` and are
// regenerated via `npm run gen:types`. Don't hand-edit that file.
//
// This shim does three things:
//   1. Re-exports the row types the workbook actually reads, so call
//      sites don't have to walk through `Database['public']['Tables']
//      […]['Row']` every time.
//   2. Re-narrows columns that codegen typed as plain `string` but are
//      CHECK-constrained in Postgres (`status`, `vertical`,
//      `flow_version`, `kind`). Codegen doesn't translate CHECK
//      constraints to TS union types, but on the wire the values are
//      always one of the constrained options.
//   3. Re-narrows columns codegen typed as nullable but that are
//      `NOT NULL` in the actual migration (`clients.agency_id`,
//      `onboarding_sessions.agency_id`). These look like a codegen bug;
//      the migrations (001) are explicit.
//
// Additions vs the Phase 1 hand-typed file:
//   - `OnboardingReminderSummary` — the shape returned by the
//     latest-reminder fetch in `get-by-workbook-id.ts`. Excludes
//     `email_body` (snapshots can be huge; only the history modal
//     loads the full row).
//   - `OnboardingByWorkbookIdPayload.latest_reminder` field.
//
// Phase 1 names kept stable so existing imports keep working:
//   ClientRow, OnboardingSessionRow, OnboardingAnswerRow,
//   OnboardingOpenEventRow, OnboardingReminderRow,
//   OnboardingFieldEditRow, ReminderKind, SessionStatus,
//   OnboardingByWorkbookIdPayload.

import type { Database, Json } from "./types.gen";
import type { AccessChecklistView } from "./access-checklist";
import type { PipelineState } from "./derive-state";
import type { ProjectedSection } from "./project-sections";

// =============================================================
// Narrowed primitive types (re-applied to row types below)
// =============================================================

/** `onboarding_sessions.status` CHECK constraint from 001_initial_schema.sql:37. */
export type SessionStatus = "draft" | "in_progress" | "submitted";

/** `onboarding_sessions.vertical` CHECK from 005_p1_p2_admin_session_fields.sql. */
export type SessionVertical = "law_firm" | "home_services";

/**
 * `onboarding_sessions.flow_version` — added in 002. No CHECK constraint
 * but only "v1" and "v2" are ever written (per onboarding repo audit §3).
 */
export type SessionFlowVersion = "v1" | "v2";

/** `onboarding_reminders.kind` CHECK from 008_workbook_tab_tables.sql. */
export type ReminderKind = "form_reminder" | "access_request";

// =============================================================
// Row types (codegen rows, re-narrowed where needed)
// =============================================================

/**
 * `clients` row. `agency_id` re-narrowed from `string | null` to `string` —
 * 001_initial_schema.sql:20-27 declares it `UUID NOT NULL REFERENCES ...`.
 * Treating the codegen nullability as a bug, not a constraint to honour.
 */
export type ClientRow = Omit<
  Database["public"]["Tables"]["clients"]["Row"],
  "agency_id"
> & {
  agency_id: string;
};

/**
 * `onboarding_sessions` row. Re-narrows:
 *   - agency_id: not null (001:30-42)
 *   - status: 3-value enum (001:37 CHECK)
 *   - vertical: 2-value enum (005 CHECK)
 *   - flow_version: 2-value union (002 + code usage)
 *
 * The session row carries six post-audit drift columns that hand-typing
 * in Phase 1 missed — `crm_status`, `crm_status_changed_at`,
 * `assigned_to`, `internal_notes`, `last_viewed_at`, `last_viewed_by`
 * (see phase-2-plan.md §3.1). They're present here automatically via
 * codegen. `crm_status` is typed as plain `string` because its full
 * state set is not yet documented; the only observed value to date is
 * "new".
 */
export type OnboardingSessionRow = Omit<
  Database["public"]["Tables"]["onboarding_sessions"]["Row"],
  "agency_id" | "status" | "vertical" | "flow_version"
> & {
  agency_id: string;
  status: SessionStatus;
  vertical: SessionVertical;
  flow_version: SessionFlowVersion;
};

/**
 * Phase 8 proper PR B: the variant that ships in the
 * `OnboardingByWorkbookIdPayload`. The `token` field is omitted
 * here because it's a credential (paired with the 6-digit PIN it
 * grants public access to the onboarding form). Consumers that
 * actually need the token call the dedicated endpoint at
 * `/api/onboarding/sessions/[id]/token` and accept an audit row
 * being written for each access. See phase-8-proper-plan.md §3.4
 * + §5.
 */
export type RedactedOnboardingSession = Omit<OnboardingSessionRow, "token">;

/** `onboarding_answers` row — codegen as-is. */
export type OnboardingAnswerRow =
  Database["public"]["Tables"]["onboarding_answers"]["Row"];

/** `onboarding_open_events` row — codegen as-is. */
export type OnboardingOpenEventRow =
  Database["public"]["Tables"]["onboarding_open_events"]["Row"];

/**
 * `onboarding_reminders` row. `kind` re-narrowed to the 2-value union
 * (008 CHECK constraint).
 */
export type OnboardingReminderRow = Omit<
  Database["public"]["Tables"]["onboarding_reminders"]["Row"],
  "kind"
> & {
  kind: ReminderKind;
};

/** `onboarding_field_edits` row — codegen as-is. */
export type OnboardingFieldEditRow =
  Database["public"]["Tables"]["onboarding_field_edits"]["Row"];

// =============================================================
// Composite shapes for `get-by-workbook-id.ts` / API route payload
// =============================================================

/**
 * Latest reminder shape for the reminder-strip block in the Onboarding
 * tab. Omits `email_body` — that field can be large (full email body
 * snapshot) and isn't needed for the strip's "Last reminder sent: …"
 * rendering. The History modal (later phase) fetches the full row by
 * id when opened.
 */
export type OnboardingReminderSummary = Omit<
  OnboardingReminderRow,
  "email_body"
>;

/**
 * Open-event summary for the Open History modal (spec §6.1, Phase 5
 * PR A). The modal lists onboarding_open_events for the session,
 * newest first, capped at OPEN_EVENTS_MODAL_LIMIT (see
 * get-by-workbook-id.ts). `ip_hash` is included in the projection
 * but the modal itself doesn't render it — kept on the wire so
 * later phases (audit log, abuse review) don't need a schema bump.
 */
export interface OpenEventSummary {
  id: string;
  opened_at: string;
  user_agent: string | null;
  ip_hash: string | null;
}

/**
 * Row shape for the Reminder History modal (spec §6.8, Phase 6.5
 * PR A). The modal lists onboarding_reminders for the session,
 * newest first, capped at REMINDERS_MODAL_LIMIT (see
 * get-by-workbook-id.ts).
 *
 * `email_body` is deliberately NOT included. Per phase-6.5-plan.md
 * §4.5 the modal renders only a flat list of single-line rows
 * (badge + subject + relative time + sent-by) matching spec §6.8
 * and the mockup exactly — no expand/collapse, no body rendering.
 * Pulling the body into the wire payload would just inflate
 * response size for nothing.
 *
 * If a future phase ever needs body-level access from the
 * workbook (audit drill-down, CSV export of full bodies, etc.),
 * the right move is a separate per-row fetch keyed by `id` —
 * not widening this list type.
 *
 * `kind` is re-narrowed from `string` to the `ReminderKind`
 * 2-value union (defined above) to match the migration 008 CHECK
 * constraint.
 */
export interface ReminderHistoryRow {
  id: string;
  session_id: string;
  kind: ReminderKind;
  sent_by_label: string | null;
  sent_at: string;
  email_subject: string;
  created_at: string;
}

/**
 * The payload returned by `getOnboardingByWorkbookId` and the
 * `/api/onboarding/by-workbook-id/[id]` route.
 *
 * Evolution:
 *   - Phase 1: client, session, answers.
 *   - Phase 2: + latest_reminder (reminder strip).
 *   - Phase 3: + open_events_count, access_checklist, pipeline_state
 *              (pipeline stepper).
 *   - Phase 4: + sections (client-information accordion).
 *   - Phase 5: + open_events (Open History modal, spec §6.1).
 *   - Phase 6.5: + reminders + reminders_count (Reminder History
 *     modal, spec §6.8).
 *
 * All additions are pre-computed server-side so PR B's UI
 * components don't have to derive state in the browser. Keeps
 * the client-component surface small and makes the data path
 * easy to test (pure functions, no Supabase dependency once the
 * fetcher has the raw rows).
 */
export interface OnboardingByWorkbookIdPayload {
  client: ClientRow;
  // Phase 8 proper PR B: token redacted from the default response
  // shape (it's a credential). Consumers needing the token call
  // /api/onboarding/sessions/[id]/token explicitly.
  session: RedactedOnboardingSession;
  answers: OnboardingAnswerRow[];
  latest_reminder: OnboardingReminderSummary | null;
  // Phase 3 additions:
  open_events_count: number;
  access_checklist: AccessChecklistView;
  pipeline_state: PipelineState;
  // Phase 4 addition:
  sections: ProjectedSection[];
  // Phase 5 addition: ordered by opened_at DESC, capped at
  // OPEN_EVENTS_MODAL_LIMIT (see get-by-workbook-id.ts). The
  // step-2 badge still uses `open_events_count` (true total);
  // this list may be a capped subset.
  open_events: OpenEventSummary[];
  // Phase 6.5 additions: ordered by sent_at DESC, capped at
  // REMINDERS_MODAL_LIMIT (see get-by-workbook-id.ts). The
  // reminder-strip's "Last reminder sent" line continues to
  // read from `latest_reminder` above; this list drives the
  // Reminder History modal. `reminders_count` is the true total
  // (uncapped) so the modal can show a "Latest N of M" caveat
  // when `count > list.length`.
  reminders: ReminderHistoryRow[];
  reminders_count: number;
}

// Re-export Json for callers that want to type JSONB blobs without
// reaching into the generated file.
export type { Json };
