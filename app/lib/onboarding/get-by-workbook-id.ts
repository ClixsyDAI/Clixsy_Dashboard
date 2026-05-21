// =============================================================
// Onboarding tab — joined-payload fetcher
// =============================================================
//
// Phase 2 extraction (per phase-2-plan.md §6): the Phase 1 route at
// app/api/onboarding/by-workbook-id/[id]/route.ts inlined the query
// chain (clients → onboarding_sessions → onboarding_answers). Phase 2
// extracts that chain into this module so:
//
//   1. The API route can stay thin (validates input, maps result to
//      HTTP response).
//   2. The /client/[id] page can call the same code path directly,
//      avoiding a redundant HTTP round-trip from the page to its own
//      API route. (Phase 2 PR B will wire this up; PR A is just the
//      extraction.)
//   3. Phase 2 also adds the `latest_reminder` fetch needed by the
//      ReminderStrip block (spec §4.1).
//
// The function returns a discriminated union so the route handler
// can map { kind: 'not_found' } → 404, { kind: 'error' } → 500, and
// { kind: 'ok' } → 200 + payload, without duplicating that logic
// across multiple call sites.

import { getSupabaseServerClient } from "../supabase-server";
import type {
  ClientRow,
  OnboardingAnswerRow,
  OnboardingByWorkbookIdPayload,
  OnboardingReminderRow,
  OnboardingReminderSummary,
  OnboardingSessionRow,
  OpenEventSummary,
} from "./types";
import { projectAccessChecklist } from "./access-checklist";
import { derivePipelineState } from "./derive-state";
import { projectSections } from "./project-sections";

/**
 * Cap on rows returned for the Open History modal (spec §6.1).
 * Named constant — not inlined — so future consumers (Phase 8 CSV
 * export) can pick their own limit without re-tracing where this
 * value lives. If 50 turns out to be too low for power users who
 * open clients' forms frequently, this is a one-line bump.
 */
export const OPEN_EVENTS_MODAL_LIMIT = 50;

// =============================================================
// Result type — discriminated union the caller branches on
// =============================================================

export type GetByWorkbookIdResult =
  | { kind: "ok"; payload: OnboardingByWorkbookIdPayload }
  | { kind: "invalid_id"; message: string }
  | { kind: "not_found"; reason: "no_client" | "no_session" }
  | { kind: "error"; stage: Stage; message: string };

type Stage =
  | "supabase_init"
  | "clients_lookup"
  | "sessions_lookup"
  | "answers_lookup"
  | "latest_reminder_lookup"
  | "open_events_count_lookup"
  | "open_events_list_lookup";

// =============================================================
// Fetcher
// =============================================================

/**
 * Resolve a workbook integer id (the Basecamp project id from
 * app/data/projects.json) to the joined onboarding payload.
 *
 *     workbook_id (integer)
 *        → clients (UUID, by clients.workbook_id)
 *          → onboarding_sessions (most recent first)
 *            → onboarding_answers (all step rows, if present)
 *            → onboarding_reminders (latest one, if any)
 *
 * Returns a discriminated union — the caller decides whether each
 * `kind` maps to a 404, a 500, or a success.
 *
 * Server-side only. The Supabase client is constructed via
 * `getSupabaseServerClient()` which uses the service-role key.
 */
export async function getOnboardingByWorkbookId(
  workbookIdRaw: number | string,
): Promise<GetByWorkbookIdResult> {
  // Accept either pre-parsed number or raw URL-segment string; validate
  // either way. Centralising this here means the route doesn't need to
  // duplicate the validation when the page also calls the function.
  const workbookId =
    typeof workbookIdRaw === "number"
      ? workbookIdRaw
      : Number.parseInt(workbookIdRaw, 10);
  if (!Number.isFinite(workbookId) || workbookId <= 0) {
    return {
      kind: "invalid_id",
      message: "workbook id must be a positive integer",
    };
  }

  // ── 0. Supabase client ──────────────────────────────────────
  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    console.error(
      "[get-by-workbook-id] supabase client init failed:",
      err,
    );
    return {
      kind: "error",
      stage: "supabase_init",
      message: err instanceof Error ? err.message : "unknown",
    };
  }

  // ── 1. Resolve workbook_id → clients row ────────────────────
  const clientRes = await supabase
    .from("clients")
    .select(
      "id, agency_id, client_name, primary_contact_name, primary_contact_email, website_url, workbook_id, created_at",
    )
    .eq("workbook_id", workbookId)
    .maybeSingle<ClientRow>();

  if (clientRes.error) {
    console.error(
      `[get-by-workbook-id] clients lookup failed for workbook_id=${workbookId}:`,
      clientRes.error,
    );
    return {
      kind: "error",
      stage: "clients_lookup",
      message: clientRes.error.message,
    };
  }
  if (!clientRes.data) {
    return { kind: "not_found", reason: "no_client" };
  }
  const client = clientRes.data;

  // ── 2. Latest onboarding_sessions row for this client ───────
  const sessionRes = await supabase
    .from("onboarding_sessions")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<OnboardingSessionRow>();

  if (sessionRes.error) {
    console.error(
      `[get-by-workbook-id] sessions lookup failed for client_id=${client.id}:`,
      sessionRes.error,
    );
    return {
      kind: "error",
      stage: "sessions_lookup",
      message: sessionRes.error.message,
    };
  }
  if (!sessionRes.data) {
    return { kind: "not_found", reason: "no_session" };
  }
  const session = sessionRes.data;

  // ── 3. All onboarding_answers rows for that session ─────────
  const answersRes = await supabase
    .from("onboarding_answers")
    .select("id, session_id, step_key, answers, completed, updated_at")
    .eq("session_id", session.id)
    .order("updated_at", { ascending: true });

  if (answersRes.error) {
    console.error(
      `[get-by-workbook-id] answers lookup failed for session_id=${session.id}:`,
      answersRes.error,
    );
    return {
      kind: "error",
      stage: "answers_lookup",
      message: answersRes.error.message,
    };
  }
  const answers = (answersRes.data ?? []) as OnboardingAnswerRow[];

  // ── 4. Latest reminder row for that session (Phase 2 §4.1) ──
  // Phase 2: drives the ReminderStrip block. NULL on empty table
  // (which is the current state for every session — no reminders
  // have been sent yet). The strip renders "Never sent" in that case.
  //
  // email_body deliberately omitted — it can be large and the strip
  // only needs subject + timestamps. The History modal (later phase)
  // fetches the full row by id when opened.
  const reminderRes = await supabase
    .from("onboarding_reminders")
    .select("id, session_id, kind, sent_by_label, sent_at, email_subject, created_at")
    .eq("session_id", session.id)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle<Omit<OnboardingReminderRow, "email_body">>();

  if (reminderRes.error) {
    console.error(
      `[get-by-workbook-id] latest-reminder lookup failed for session_id=${session.id}:`,
      reminderRes.error,
    );
    return {
      kind: "error",
      stage: "latest_reminder_lookup",
      message: reminderRes.error.message,
    };
  }

  const latestReminder: OnboardingReminderSummary | null =
    reminderRes.data ?? null;

  // ── 5. Open events count for this session (Phase 3 §4.3) ────
  // Drives the pipeline stepper's Step 2 ("Opened {n}x") badge.
  // Uses PostgREST's exact-count head request so no row data is
  // returned over the wire — just the count header.
  const openEventsRes = await supabase
    .from("onboarding_open_events")
    .select("*", { count: "exact", head: true })
    .eq("session_id", session.id);

  if (openEventsRes.error) {
    console.error(
      `[get-by-workbook-id] open events count failed for session_id=${session.id}:`,
      openEventsRes.error,
    );
    return {
      kind: "error",
      stage: "open_events_count_lookup",
      message: openEventsRes.error.message,
    };
  }
  // `count: 'exact', head: true` populates the .count field even
  // when no rows are returned. Defaults to 0 if null (shouldn't
  // happen given the exact request, but guard the type system).
  const openEventsCount = openEventsRes.count ?? 0;

  // ── 5b. Open events list for Open History modal (Phase 5) ───
  // Separate query from the head-count above: the count drives the
  // step 2 badge ("Opened {n}x") and is the true total, while this
  // list is what the modal renders — capped at
  // OPEN_EVENTS_MODAL_LIMIT so a session with thousands of opens
  // doesn't pay for unbounded transfer. When the count exceeds the
  // limit, the modal renders a "Latest N events" caveat (PR B
  // concern; PR A just ships the data).
  const openEventsListRes = await supabase
    .from("onboarding_open_events")
    .select("id, opened_at, user_agent, ip_hash")
    .eq("session_id", session.id)
    .order("opened_at", { ascending: false })
    .limit(OPEN_EVENTS_MODAL_LIMIT);

  if (openEventsListRes.error) {
    console.error(
      `[get-by-workbook-id] open events list failed for session_id=${session.id}:`,
      openEventsListRes.error,
    );
    return {
      kind: "error",
      stage: "open_events_list_lookup",
      message: openEventsListRes.error.message,
    };
  }
  const openEvents = (openEventsListRes.data ?? []) as OpenEventSummary[];

  // ── 6. Pure-function derivations (Phase 3 §4.1 + §4.2) ──────
  // No more network round-trips. These compute the projected
  // access-checklist view and the 6-step pipeline state from
  // already-fetched rows, so PR B's UI just renders what the
  // payload says.
  const accessChecklist = projectAccessChecklist(answers);
  const pipelineState = derivePipelineState({
    session,
    answers,
    accessChecklist,
    openEventsCount,
  });
  // Phase 4: project the 12-section accordion view from the same
  // answers rows. Pure function — no extra round-trip.
  const sections = projectSections(answers);

  const payload: OnboardingByWorkbookIdPayload = {
    client,
    session,
    answers,
    latest_reminder: latestReminder,
    open_events_count: openEventsCount,
    access_checklist: accessChecklist,
    pipeline_state: pipelineState,
    sections,
    open_events: openEvents,
  };
  return { kind: "ok", payload };
}
