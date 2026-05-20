// =============================================================
// The 12 onboarding step keys, in form order
// =============================================================
//
// Source of truth: onboarding repo, `src/lib/onboarding/steps-v2.ts`.
// Verified against that file at 2026-05-20 — codify here in the
// SAME ORDER they appear in steps-v2's exported step array. Display
// order in the workbook's Onboarding tab follows this order.
//
// **Naming note** (discovery-notes.md §5 Q15): the spec used
// `legal_content_communication` and `transition_wrap_up`, but the
// onboarding code's keys are `legal_content_comms` and
// `transition_wrapup` (no underscore). Operator resolution: code
// names win. These constants reflect what the DB actually stores
// in `onboarding_answers.step_key`.
//
// If the onboarding repo ever adds, removes, or renames a step,
// update this file in the same PR.

export const STEP_KEYS = [
  "primary_contact",
  "other_contacts",
  "business_overview",
  "goals_strategy",
  "brand_design",
  "technical_setup",
  "seo_targeting",
  "legal_content_comms",
  "access_checklist",
  "transition_wrapup",
  "review",
  "submit",
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

/**
 * 1-based index of a step in the form order, or `null` if the
 * key doesn't correspond to a known step. Used by future export
 * code that needs a numeric `section_number` per spec.
 */
export function stepNumber(key: string): number | null {
  const idx = STEP_KEYS.indexOf(key as StepKey);
  return idx === -1 ? null : idx + 1;
}

/**
 * Type guard for narrowing arbitrary strings to StepKey.
 */
export function isStepKey(s: string): s is StepKey {
  return (STEP_KEYS as readonly string[]).includes(s);
}
