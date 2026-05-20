// =============================================================
// Project sections — answers JSONB → ProjectedSection[]
// =============================================================
//
// Phase 4 PR A per phase-4-plan.md §5.3.
//
// Pure function: takes the raw `onboarding_answers` rows and
// projects them into a typed `ProjectedSection[]` the accordion
// can render directly. No Supabase dependency; no IO.
//
// PR B's <ClientInformationAccordion> renders what this produces.
// The pill-text computation lives in the renderer, not on the
// projection — see §5.3 of phase-4-plan.md.

import { SECTION_CONFIGS, type SectionConfig, type SectionIconKey, type SectionNumber } from "./field-config";
import { humanize, type HumanizeResult } from "./humanize";
import type { OnboardingAnswerRow } from "./types";
import type { StepKey } from "./step-keys";

// =============================================================
// Result types
// =============================================================

export interface ProjectedField {
  name: string;
  label: string;
  value: HumanizeResult;
  isMissingLike: boolean;
}

export interface ProjectedSection {
  number: SectionNumber;
  stepKey: StepKey;
  name: string;
  iconKey: SectionIconKey;
  fields: ProjectedField[];
  /** ISO timestamp from `onboarding_answers.updated_at`; null
   * when the section's answers row doesn't exist yet OR the
   * section is informational. */
  updatedAt: string | null;
  /** Number of fields where `isMissingLike` is true. Drives the
   * "{n} missing" header pill text — pill rendering itself is
   * computed inline by SectionRow, not stored here. */
  missingCount: number;
  /** True for sections with no real fields (only section 11 in
   * the current form schema — `review` step is informational).
   * SectionRow suppresses the header pill when true. */
  isInformational: boolean;
}

// =============================================================
// Display-name overrides
// =============================================================
//
// Two sections override the onboarding form's `title` for the
// accordion header. The form titles `Almost There!` and `Ready to
// Submit` ARE the spec display names, so this map is a no-op for
// most sections; it's here so future overrides have a single
// source. The mapping uses step keys (code names, not spec
// section names — see discovery-notes.md §5 Q15).

const SECTION_DISPLAY_NAMES: Partial<Record<StepKey, string>> = {
  // Currently no overrides — SECTION_CONFIGS already carries the
  // display names. This map is reserved for future renaming
  // without re-touching field-config.ts.
};

// =============================================================
// Projection
// =============================================================

/**
 * Project `onboarding_answers` rows into the 12 ordered
 * `ProjectedSection`s the accordion renders. Always returns
 * exactly 12 entries; sections with no answers row produce a
 * section with empty fields + null updatedAt + missingCount = 0.
 */
export function projectSections(
  answers: OnboardingAnswerRow[],
): ProjectedSection[] {
  // Index answers by step_key for O(1) lookup per section.
  const answersByStep = new Map<string, OnboardingAnswerRow>();
  for (const row of answers) {
    answersByStep.set(row.step_key, row);
  }

  return SECTION_CONFIGS.map((sectionConfig): ProjectedSection => {
    const answersRow = answersByStep.get(sectionConfig.stepKey);
    const data = (answersRow?.answers ?? {}) as Record<string, unknown>;

    const isInformational = sectionConfig.fields.length === 0;

    const fields: ProjectedField[] = sectionConfig.fields.map((fieldConfig) => {
      const rawValue = data[fieldConfig.name];
      const value = humanize(rawValue, { type: fieldConfig.type });
      return {
        name: fieldConfig.name,
        label: fieldConfig.label,
        value,
        isMissingLike: value.kind === "missing_pill",
      };
    });

    const missingCount = fields.filter((f) => f.isMissingLike).length;

    const displayName = SECTION_DISPLAY_NAMES[sectionConfig.stepKey] ?? sectionConfig.name;

    return {
      number: sectionConfig.number,
      stepKey: sectionConfig.stepKey,
      name: displayName,
      iconKey: sectionConfig.iconKey,
      fields,
      updatedAt: isInformational ? null : (answersRow?.updated_at ?? null),
      missingCount,
      isInformational,
    };
  });
}
