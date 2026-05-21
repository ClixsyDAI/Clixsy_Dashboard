// =============================================================
// SectionBody — collapsible body of one accordion section
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.4.
//
// Renders the field-rows for one section when its header is
// expanded. Wrapped by SectionRow's CSS-controlled show/hide
// (display: none ↔ block) so the body only animates in when the
// parent toggles `isOpen`.
//
// Empty-fields edge case: when fields[] is empty (section 11,
// the informational "Almost There!" step), renders a single
// muted paragraph rather than nothing. This way the expanded
// state has visual feedback that there's truly no content to
// show, rather than confusing the operator with a blank
// expansion.
//
// Pure server component — no state, no interactivity.

import type { ProjectedField } from "../../lib/onboarding/project-sections";
import FieldRow from "./FieldRow";

interface SectionBodyProps {
  /** The section's projected fields (empty for informational
   * sections like step 11 `review`). */
  fields: ProjectedField[];
  /** The DOM id this body is targeted by — set by the parent
   * SectionRow's `aria-controls` so screen readers can announce
   * the relationship. */
  id: string;
  /** Whether the parent header is currently in the open state.
   * Controls the body's `aria-hidden` and visibility. */
  isOpen: boolean;
}

export default function SectionBody({ fields, id, isOpen }: SectionBodyProps) {
  return (
    <div
      id={id}
      role="region"
      aria-hidden={!isOpen}
      hidden={!isOpen}
      style={{
        padding: "8px 16px 16px 16px",
        // Subtle inset so the body visually nests under the
        // header — matches the mockup's accordion body indent.
      }}
    >
      {fields.length === 0 ? (
        <p
          style={{
            margin: 0,
            padding: "12px 0",
            fontSize: 12,
            color: "var(--text-3)",
            fontStyle: "italic",
          }}
        >
          This section is informational — no questions to display.
        </p>
      ) : (
        <div>
          {fields.map((field) => (
            <FieldRow key={field.name} field={field} />
          ))}
        </div>
      )}
    </div>
  );
}
