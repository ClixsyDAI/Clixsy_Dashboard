// =============================================================
// Access checklist — JSONB projection
// =============================================================
//
// Phase 3 PR A per phase-3-plan.md §4.1.
//
// The onboarding form's step 9 (`access_checklist`) writes a flat
// JSONB object on `onboarding_answers.answers`. This module
// projects that wire shape into a typed `AccessChecklistView`
// with one slot per spec asset (7 total) plus aggregate counts.
//
// The wire shape was confirmed against the onboarding tool's
// schema at `src/lib/onboarding/steps-v2.ts:709-813` on 2026-05-20.
// See the PR description for the field-by-field mapping.
//
// =============================================================
// Field-naming summary (wire → projection)
// =============================================================
//
//   5 unconditional access_status fields:
//     wordpress_access_status, domain_access_status,
//     dns_access_status, gsc_access_status, gbp_access_status
//
//   2 gated access_status fields:
//     ga_access_status   — only written when has_google_analytics === 'yes'
//     youtube_access_status — only written when has_youtube === 'yes'
//
//   2 gate fields:
//     has_google_analytics → 'yes' | 'no' | 'not_sure'
//     has_youtube → 'yes' | 'no'
//
// =============================================================
// Value mapping (wire → AccessStatus, per spec §6.4 tile colors)
// =============================================================
//
//   wire 'done'           → AccessStatus 'provided'  (green)
//   wire 'need_help'      → 'needs_help'             (blue)
//   wire 'later'          → 'later'                  (amber)
//   wire 'not_applicable' → 'na'                     (grey)
//   key absent            → 'missing'                (red)
//   gate has_*: 'no'      → 'na'                     (grey)
//   has_google_analytics: 'not_sure' → 'needs_help' (blue)
//
// Operator-decided defaults (per phase-3-plan.md §4.1 Q1/Q2):
//   - has_*: 'no' → na  (asset doesn't apply to this client)
//   - gated but unanswered (has_*: 'yes' but no _access_status) → missing
//   - has_google_analytics: 'not_sure' → needs_help (user can't grant
//     access because they don't know; we need to help figure it out)
//
// =============================================================

import type { OnboardingAnswerRow } from "./types";

export type AccessAssetKey =
  | "wordpress"
  | "domain"
  | "dns"
  | "gsc"
  | "ga"
  | "gbp"
  | "youtube";

export type AccessStatus =
  | "provided"
  | "missing"
  | "needs_help"
  | "later"
  | "na";

export const ACCESS_ASSET_KEYS: readonly AccessAssetKey[] = [
  "wordpress",
  "domain",
  "dns",
  "gsc",
  "ga",
  "gbp",
  "youtube",
] as const;

export interface AccessChecklistView {
  /** Per-asset status, exhaustive across all 7 assets. */
  byAsset: Record<AccessAssetKey, AccessStatus>;

  /** Counts derived from byAsset. */
  counts: {
    provided: number;
    missing: number;
    needsHelp: number;
    later: number;
    na: number;
  };

  /**
   * Count of assets considered "no longer needed" by the workbook —
   * either provided by the client or marked N/A. Matches the spec's
   * "{x} of 7 received" sub-label for the Access Pending step.
   */
  effectivelyComplete: number;

  /**
   * True when every asset is `provided` or `na`. Drives the
   * pipeline state's transition from `access_pending` to
   * `kickoff_ready` (see derive-state.ts).
   *
   * Per phase-3-plan.md §8 risk #2: `later` is NOT counted as
   * complete. A deferred item still blocks kickoff. One-line
   * change here if the operator later disagrees.
   */
  isAllComplete: boolean;
}

// =============================================================
// Projection
// =============================================================

/**
 * Project the `access_checklist` step's JSONB into a typed view.
 *
 * Returns a default-`missing`/all-`missing` view when no
 * access_checklist row exists for the session (early-draft sessions
 * haven't reached step 9 yet). The 7-tile grid still renders; tiles
 * just show red until the client fills the step in.
 */
export function projectAccessChecklist(
  answers: OnboardingAnswerRow[],
): AccessChecklistView {
  const row = answers.find((a) => a.step_key === "access_checklist");
  const data = (row?.answers ?? {}) as Record<string, unknown>;

  const byAsset: Record<AccessAssetKey, AccessStatus> = {
    wordpress: resolveUnconditional(data, "wordpress_access_status"),
    domain: resolveUnconditional(data, "domain_access_status"),
    dns: resolveUnconditional(data, "dns_access_status"),
    gsc: resolveUnconditional(data, "gsc_access_status"),
    gbp: resolveUnconditional(data, "gbp_access_status"),
    ga: resolveGated(data, "has_google_analytics", "ga_access_status"),
    youtube: resolveGated(data, "has_youtube", "youtube_access_status"),
  };

  const counts = {
    provided: 0,
    missing: 0,
    needsHelp: 0,
    later: 0,
    na: 0,
  };
  for (const status of Object.values(byAsset)) {
    switch (status) {
      case "provided":
        counts.provided += 1;
        break;
      case "missing":
        counts.missing += 1;
        break;
      case "needs_help":
        counts.needsHelp += 1;
        break;
      case "later":
        counts.later += 1;
        break;
      case "na":
        counts.na += 1;
        break;
    }
  }

  const effectivelyComplete = counts.provided + counts.na;
  const isAllComplete = effectivelyComplete === ACCESS_ASSET_KEYS.length;

  return { byAsset, counts, effectivelyComplete, isAllComplete };
}

// =============================================================
// Internals
// =============================================================

/**
 * Translate the wire status value to a normalised `AccessStatus`.
 * Returns `null` for unknown / missing / unrecognised values; the
 * caller decides what default to apply (missing for unconditional
 * assets, etc.).
 */
function translateWireStatus(value: unknown): AccessStatus | null {
  if (typeof value !== "string") return null;
  switch (value) {
    case "done":
      return "provided";
    case "need_help":
      return "needs_help";
    case "later":
      return "later";
    case "not_applicable":
      return "na";
    default:
      return null;
  }
}

/**
 * Resolve an unconditional `{asset}_access_status` field. The form
 * always asks for these 5 assets regardless of any gate. A missing
 * key means the user hasn't filled in step 9 yet — treat as
 * `missing` so the visual block surfaces it as needing action.
 */
function resolveUnconditional(
  data: Record<string, unknown>,
  fieldName: string,
): AccessStatus {
  const translated = translateWireStatus(data[fieldName]);
  return translated ?? "missing";
}

/**
 * Resolve a gated asset (ga, youtube). The gate field tells us
 * whether the user has the asset at all:
 *   - 'yes' → look at the _access_status; default to missing if
 *     absent (form question answered but follow-up not answered yet)
 *   - 'no' → na (asset doesn't apply to this client)
 *   - 'not_sure' (GA only) → needs_help (we need to help figure it out)
 *   - any other value or absent → missing (user hasn't reached the
 *     question yet)
 */
function resolveGated(
  data: Record<string, unknown>,
  gateField: string,
  statusField: string,
): AccessStatus {
  const gate = data[gateField];
  if (gate === "no") return "na";
  if (gate === "not_sure") return "needs_help";
  if (gate === "yes") {
    const translated = translateWireStatus(data[statusField]);
    return translated ?? "missing";
  }
  return "missing";
}
