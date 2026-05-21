"use client";

// =============================================================
// FieldRow — one question + answer in the accordion body
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.5 (read-only baseline).
// Phase 7 PR B per phase-7-plan.md §6.4 — now hosts the inline
// edit affordance + the copy icon, both hover-revealed.
//
// Composition:
//   [label column 280px fixed]    [<EditableFieldValue/> + <FieldActions/>]
//
// State (Phase 7 additions):
//   editTrigger — incremented by FieldActions's pencil click;
//                 EditableFieldValue watches this prop to enter
//                 editing state. Counter pattern instead of a
//                 boolean so successive clicks (rare) still
//                 trigger re-entry.
//   isEditing   — set true by EditableFieldValue's onEditingChange
//                 while editing/saving. Used to hide FieldActions
//                 so the AM doesn't pencil-mash mid-edit.
//
// Hover-reveal of FieldActions is CSS-driven via the `.field-row`
// class — rules live in `app/styles/onboarding-tab.css` (extended
// in this commit). The component itself is hover-state-free.
//
// "use client" because FieldActions receives an onEdit function
// prop — same RSC boundary constraint Phase 5 + 6 hit.

import { useState } from "react";
import type { HumanizeResult } from "../../lib/onboarding/humanize";
import type { ProjectedField } from "../../lib/onboarding/project-sections";
import type { StepKey } from "../../lib/onboarding/step-keys";
import EditableFieldValue from "./EditableFieldValue";
import FieldActions from "./FieldActions";

interface FieldRowProps {
  field: ProjectedField;
  /** Threaded from OnboardingTabBody → Accordion → SectionRow →
   * SectionBody. Phase 7 PR B needs it for the field-edit POST. */
  sessionId: string;
  /** Threaded from SectionBody. The accordion section's step_key
   * — the JSONB row key the edit writes to. */
  stepKey: StepKey;
}

export default function FieldRow({ field, sessionId, stepKey }: FieldRowProps) {
  const [editTrigger, setEditTrigger] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const copyValue = computeCopyValue(field.value);

  return (
    <div
      className="field-row"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 24,
        padding: "10px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Label column — fixed 280px so values align across rows */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          fontSize: 12,
          color: "var(--text-3)",
          paddingTop: 2,
        }}
      >
        {field.label}
      </div>

      {/* Value column — flex-1, dispatches on humanized kind */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          color: "var(--text-2)",
          // Long values (legal disclaimers, business summaries)
          // can be 1000+ chars. Force wrap rather than overflow.
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditableFieldValue
            sessionId={sessionId}
            stepKey={stepKey}
            fieldKey={field.name}
            fieldType={field.type}
            display={field.value}
            rawValue={field.rawValue}
            editTrigger={editTrigger}
            onEditingChange={setIsEditing}
          />
        </div>
        <FieldActions
          onEdit={() => setEditTrigger((n) => n + 1)}
          copyValue={copyValue}
          suppressed={isEditing}
        />
      </div>
    </div>
  );
}

// =============================================================
// Copy-value derivation
// =============================================================

/**
 * Convert a HumanizeResult to the plain-text representation that
 * gets written to the clipboard. Per spec §4.4 line 478 the copy
 * is "the value's plain-text representation".
 *
 * Returns null for missing-pill fields — no real value to copy;
 * the FieldActions component suppresses the copy button entirely.
 */
function computeCopyValue(value: HumanizeResult): string | null {
  switch (value.kind) {
    case "text":
    case "url":
    case "email":
    case "tel":
      return value.display;
    case "chip_list":
      return value.chips.join(", ");
    case "missing_pill":
      return null;
  }
}
