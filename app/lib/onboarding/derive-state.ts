// =============================================================
// Pipeline state derivation
// =============================================================
//
// Phase 3 PR A per phase-3-plan.md §4.2.
//
// The Onboarding tab's pipeline stepper shows 6 steps with 5
// possible effective states (`created` / `in_progress` / `submitted`
// / `access_pending` / `kickoff_ready`). The DB only stores 3 of
// these on `onboarding_sessions.status` (`draft | in_progress |
// submitted`). The other two are **derived client-side** from the
// access-checklist completeness — see Phase 1 discovery resolution.
//
// This module is the single source of truth for that derivation.
// PR B's UI components don't compute state themselves; they render
// what `derivePipelineState` produces.

import type {
  OnboardingAnswerRow,
  OnboardingSessionRow,
} from "./types";
import type { AccessChecklistView } from "./access-checklist";

// =============================================================
// Types
// =============================================================

export type EffectiveSessionState =
  | "created"        // session.status === 'draft'
  | "in_progress"    // session.status === 'in_progress'
  | "access_pending" // session.status === 'submitted', some access incomplete
  | "kickoff_ready"; // session.status === 'submitted', all access complete

export type PipelineStepIndex = 1 | 2 | 3 | 4 | 5 | 6;

export type PipelineStepStateName = "done" | "current" | "pending";

export interface PipelineStepState {
  /** 1-indexed step number, 1..6. */
  index: PipelineStepIndex;
  state: PipelineStepStateName;
  /** For Step 2 (Opened): open events count. Omitted on other steps. */
  metaCount?: number;
  /**
   * For Step 3 (In progress): "{numerator}/{denominator}" fraction
   * badge. denominator is the total step count of the onboarding
   * form (12). numerator is the session's `current_step`.
   */
  metaFraction?: { numerator: number; denominator: number };
  /**
   * For Step 5 (Access pending): "{provided} of 7 received".
   * `received` here means provided + na (per access-checklist.ts
   * `effectivelyComplete`). Total is hardcoded 7 — the spec's asset
   * count is fixed by the access checklist's asset roster.
   */
  metaAccess?: { received: number; total: 7 };
  /**
   * Sub-label timestamp shown beneath the label. ISO string when
   * present; the renderer formats it. Omitted when no timestamp
   * applies for this step in this state.
   */
  subLabelTimestamp?: string;
  /**
   * Whether the circle is visually clickable. Phase 3 renders the
   * affordance (cursor pointer, hover state) but the click handler
   * is inert — modals land in later phases.
   *
   * Per spec §4.3: only steps 2, 3, 4, 5 are ever clickable. Steps
   * 1 and 6 are static.
   */
  clickable: boolean;
}

export interface PipelineState {
  effective: EffectiveSessionState;
  /** Title-Case header label per spec §4.3 (e.g. "In Progress"). */
  headerLabel: string;
  /** Always 6 entries, ordered by `index` ascending. */
  steps: PipelineStepState[];
}

// =============================================================
// Total form step count (used for Step 3's x/12 badge)
// =============================================================
//
// 12 v2 steps per `app/lib/onboarding/step-keys.ts`. Hard-coded
// rather than imported to keep this module pure / IO-free (the
// step-keys module exports a const array that's tree-shake-friendly
// but importing it would mean derive-state.ts couldn't be reasoned
// about without also loading step-keys.ts). If the count ever shifts
// — unlikely — change here and in step-keys.ts together.

const TOTAL_FORM_STEPS = 12;

// =============================================================
// Derivation
// =============================================================

export function derivePipelineState(args: {
  session: OnboardingSessionRow;
  answers: OnboardingAnswerRow[];
  accessChecklist: AccessChecklistView;
  openEventsCount: number;
}): PipelineState {
  const { session, answers, accessChecklist, openEventsCount } = args;

  const effective = deriveEffective(session.status, accessChecklist);
  const headerLabel = headerLabelFor(effective);

  // Step 3 sub-label: first-section-saved timestamp = earliest
  // updated_at across all `onboarding_answers` rows for this session.
  // Computed here (vs in PR A's fetcher) so the derivation stays a
  // pure function — easier to test, no Supabase dependency.
  const firstSavedAt = pickFirstSavedAt(answers);

  const steps: PipelineStepState[] = [
    buildStep1(session, effective),
    buildStep2(effective, openEventsCount),
    buildStep3(effective, session.current_step, firstSavedAt),
    buildStep4(session, effective),
    buildStep5(effective, accessChecklist),
    buildStep6(effective),
  ];

  return { effective, headerLabel, steps };
}

// =============================================================
// Effective-state derivation
// =============================================================

function deriveEffective(
  status: OnboardingSessionRow["status"],
  accessChecklist: AccessChecklistView,
): EffectiveSessionState {
  switch (status) {
    case "draft":
      return "created";
    case "in_progress":
      return "in_progress";
    case "submitted":
      // Per phase-3-plan.md §8 risk #6: we collapse the spec's
      // literal "Submitted" header into `access_pending` whenever
      // the session is past `submitted`. `kickoff_ready` is the
      // only way to leave `access_pending` — all 7 assets
      // provided or N/A.
      return accessChecklist.isAllComplete ? "kickoff_ready" : "access_pending";
  }
}

function headerLabelFor(effective: EffectiveSessionState): string {
  switch (effective) {
    case "created":
      return "Form Created";
    case "in_progress":
      return "In Progress";
    case "access_pending":
      return "Access Pending";
    case "kickoff_ready":
      return "Kickoff Ready";
  }
}

// =============================================================
// Per-step builders
// =============================================================
//
// Each step's state depends on `effective`. Reading the state
// transitions per spec §4.3 status-mapping table:
//
//   created        : 1=done, 2..6=pending
//   in_progress    : 1..2=done, 3=current, 4..6=pending
//   access_pending : 1..4=done, 5=current, 6=pending
//   kickoff_ready  : 1..5=done, 6=current
//
// Step 1 (Form created) is always `done` once the session exists.
// Step 2 (Opened) is `done` when openEventsCount > 0 OR the session
// has progressed past the very first step. For simplicity Phase 3
// treats step 2 as done whenever effective state is at or past
// `in_progress` (the user has interacted with the form). The exact
// open-count display is a separate concern from the done/current
// status.

function buildStep1(
  session: OnboardingSessionRow,
  _effective: EffectiveSessionState,
): PipelineStepState {
  return {
    index: 1,
    state: "done", // The session row exists → step 1 done.
    subLabelTimestamp: session.created_at,
    clickable: false,
  };
}

function buildStep2(
  effective: EffectiveSessionState,
  openEventsCount: number,
): PipelineStepState {
  // Step 2 is `done` whenever the session has moved past the
  // initial creation. The open-events count is a separate display
  // detail — the badge shows the count regardless of done/pending.
  const state: PipelineStepStateName =
    effective === "created" ? "pending" : "done";
  return {
    index: 2,
    state,
    metaCount: openEventsCount,
    clickable: true,
  };
}

function buildStep3(
  effective: EffectiveSessionState,
  currentStep: number,
  firstSavedAt: string | undefined,
): PipelineStepState {
  // `in_progress` is the only effective state where step 3 is
  // `current`. After `submitted` it's `done`. Before
  // `in_progress` it's `pending`.
  const state: PipelineStepStateName =
    effective === "created"
      ? "pending"
      : effective === "in_progress"
        ? "current"
        : "done";
  return {
    index: 3,
    state,
    metaFraction:
      effective === "in_progress"
        ? { numerator: currentStep, denominator: TOTAL_FORM_STEPS }
        : undefined,
    subLabelTimestamp: firstSavedAt,
    clickable: true,
  };
}

function buildStep4(
  session: OnboardingSessionRow,
  effective: EffectiveSessionState,
): PipelineStepState {
  // Step 4 is `done` once the session is submitted. Before that
  // it's `pending`. There's no `current` state for step 4 in
  // Phase 3's collapsed effective-state mapping — submission is
  // an atomic event, not a step the user lingers on.
  const state: PipelineStepStateName =
    effective === "access_pending" || effective === "kickoff_ready"
      ? "done"
      : "pending";
  return {
    index: 4,
    state,
    subLabelTimestamp: session.submitted_at ?? undefined,
    clickable: true,
  };
}

function buildStep5(
  effective: EffectiveSessionState,
  accessChecklist: AccessChecklistView,
): PipelineStepState {
  const state: PipelineStepStateName =
    effective === "kickoff_ready"
      ? "done"
      : effective === "access_pending"
        ? "current"
        : "pending";
  return {
    index: 5,
    state,
    metaAccess: { received: accessChecklist.effectivelyComplete, total: 7 },
    clickable: true,
  };
}

function buildStep6(effective: EffectiveSessionState): PipelineStepState {
  // Step 6 is `current` only when effective is `kickoff_ready`,
  // otherwise `pending`. It's never `done` in Phase 3 — there's
  // no DB-side signal that the kickoff has happened (no
  // `kickoff_at` column), so the stepper can't render step 6 as
  // a completed event. Per phase-3-plan.md §8 risk #3.
  const state: PipelineStepStateName =
    effective === "kickoff_ready" ? "current" : "pending";
  return {
    index: 6,
    state,
    clickable: false,
  };
}

// =============================================================
// Helpers
// =============================================================

function pickFirstSavedAt(answers: OnboardingAnswerRow[]): string | undefined {
  if (answers.length === 0) return undefined;
  // updated_at is set when the row is first inserted via the form's
  // save-step endpoint, and updated each subsequent save. The
  // earliest value across all rows for the session approximates
  // "when the user first put data into the form" — close enough
  // for the sub-label.
  let earliest = answers[0].updated_at;
  for (const row of answers) {
    if (row.updated_at < earliest) earliest = row.updated_at;
  }
  return earliest;
}
