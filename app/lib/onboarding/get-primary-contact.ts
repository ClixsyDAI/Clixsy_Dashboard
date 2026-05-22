// =============================================================
// get-primary-contact — pure primary-contact derivation
// =============================================================
//
// Phase 6.5 PR B step B6 per phase-6.5-plan.md §6.8.
//
// Canonical derivation of the primary contact from the
// onboarding answers + client row. The workbook had two divergent
// derivations before this PR (ActionBar's `pullPrimaryContact`,
// ActionBarModals's `pullContact`) plus the email-templates'
// implicit shape contract. Extract before a fourth surfaces and
// drifts.
//
// Phase 8 proper PR B: this helper no longer constructs
// `resume_url`. The session token is no longer in the by-workbook-
// id payload (redacted per phase-8-proper-plan.md §3.4) so the
// URL can't be built here. Consumers that need the URL fetch the
// token from /api/onboarding/sessions/[id]/token on user intent
// and build the URL themselves. The `ONBOARDING_BASE_URL` constant
// is the single source of truth for the public-form domain — it
// now lives in get-onboarding-url.ts (sibling), exported as a
// helper plus a constant for reuse.
//
// Three consumers adopt this in the same commit (post-PR-B):
//   1. ActionBar — for `name` + `email`. phone + title stay
//      inline (they're not in this helper since no other consumer
//      needs them).
//   2. ActionBarModals — for `first_name` + `email`. The
//      `resume_url` field is no longer here; SendFormReminderModal
//      fetches the token on modal-open and builds the URL itself.
//   3. The email-template consumers (SendFormReminderModal,
//      RequestMissingAccessModal) — they receive the `resume_url`
//      from the modal that fetched it, not from this helper.
//
// OnboardingTabBody is intentionally NOT a consumer per Option B
// of the phase-6.5 plan. The Reminder History modal doesn't
// render contact data anywhere. If a future per-reminder
// drilldown needs it, the consumer comes back as a one-line
// import here.
//
// =============================================================
// Shape decision
// =============================================================
//
// The helper returns a non-null object whose fields are empty
// strings when no real value can be derived. The `hasEmail` flag
// distinguishes "real email present" from "fallback empty string"
// so call sites can decide whether to render the modal's Send
// button enabled, the identity row's "Form created for —"
// fallback, etc.
//
// Slight deviation from the plan's "returns null when neither
// answers row nor client column yields an email" wording —
// returning a usable object with a flag is cleaner for all three
// consumers than null-checking everywhere. ActionBar still needs
// to render name + phone + title even when email is missing;
// null-return would force a second local extraction path. The
// flag carries the same information without the dual path.

import type { ClientRow, OnboardingAnswerRow } from "./types";

export interface PrimaryContact {
  /** Full name as extracted from main_contact_name. Empty string
   * when missing. */
  name: string;
  /** First whitespace-split word of `name`, used for email
   * greetings. Empty string when `name` is empty. */
  first_name: string;
  /** Email with client.primary_contact_email fallback. Empty
   * string when neither source yields a value. */
  email: string;
  /** True when email was derived from a real source (either the
   * answers row or the client column). False when fallback empty
   * string. Call sites use this to gate Send buttons or pick
   * fallback display copy. */
  hasEmail: boolean;
}

export function getPrimaryContact(
  answers: OnboardingAnswerRow[],
  client: ClientRow,
): PrimaryContact {
  const row = answers.find((a) => a.step_key === "primary_contact");
  const data = (row?.answers ?? {}) as Record<string, unknown>;

  const name = asString(data.main_contact_name);
  const first_name = name.split(/\s+/).filter(Boolean)[0] ?? "";
  const answerEmail = asString(data.main_contact_email);
  const clientEmail = client.primary_contact_email ?? "";
  const email = answerEmail || clientEmail;

  return {
    name,
    first_name,
    email,
    hasEmail: email !== "",
  };
}

function asString(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}
