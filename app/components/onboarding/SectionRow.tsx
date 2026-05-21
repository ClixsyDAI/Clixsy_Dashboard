"use client";

// =============================================================
// SectionRow — one section's collapsible header + body wrapper
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.3.
//
// Renders one of the 12 accordion sections. The header is a
// proper `<button>` element with `aria-expanded` and
// `aria-controls` so keyboard activation (Space / Enter) works
// for free and screen readers announce the open/closed state.
//
// Layout per spec §4.4:
//   [icon] 0X  [Section name] [optional "{n} missing" pill]
//                                      [Updated stamp]  [chevron]
//   (expanded body below)
//
// State lives in the parent ClientInformationAccordion (client
// component). This component receives `isOpen` and `onToggle`
// as props.
//
// The "missing" pill is rendered inline at this level (NOT
// stored on the projected section per phase-4-plan.md §5.3).
// Suppressed for `isInformational` sections regardless of
// missingCount.

import type { ProjectedSection } from "../../lib/onboarding/project-sections";
import { ChevronDown, iconFor } from "./icons";
import MissingPill from "./MissingPill";
import SectionBody from "./SectionBody";

interface SectionRowProps {
  section: ProjectedSection;
  isOpen: boolean;
  onToggle: () => void;
  /** Phase 7 PR B: threaded down to SectionBody → FieldRow →
   * EditableFieldValue for the field-edit POST. */
  sessionId: string;
}

export default function SectionRow({
  section,
  isOpen,
  onToggle,
  sessionId,
}: SectionRowProps) {
  const SectionIcon = iconFor(section.iconKey);
  const bodyId = `onboarding-section-body-${section.stepKey}`;
  const sectionNumber = String(section.number).padStart(2, "0");
  const shouldShowPill = !section.isInformational && section.missingCount > 0;
  const updatedStamp = section.updatedAt ? formatUpdatedAt(section.updatedAt) : null;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {/* Header — full-row <button> for accessibility */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        style={{
          // Reset button defaults so it looks like a row, not a button.
          all: "unset",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 14,
          width: "100%",
          padding: "14px 16px",
          cursor: "pointer",
          // Keyboard focus needs a visible ring (button's default
          // focus is suppressed by `all: unset`).
          outline: "none",
        }}
        onFocus={(e) => {
          e.currentTarget.style.boxShadow = "inset 0 0 0 1px var(--gold)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {/* Section icon */}
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            color: "var(--gold)",
            flexShrink: 0,
          }}
        >
          <SectionIcon size={18} stroke="currentColor" />
        </span>

        {/* Section number, e.g. "01" — uppercase, dim */}
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            color: "var(--text-3)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {sectionNumber}
        </span>

        {/* Section name + optional missing pill */}
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {section.name}
          </span>
          {shouldShowPill && (
            <MissingPill>{section.missingCount} missing</MissingPill>
          )}
        </span>

        {/* Updated timestamp */}
        {updatedStamp && (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Updated {updatedStamp}
          </span>
        )}

        {/* Chevron — rotates 180° when open */}
        <span
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-3)",
            flexShrink: 0,
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms ease",
          }}
        >
          <ChevronDown size={16} stroke="currentColor" />
        </span>
      </button>

      <SectionBody
        fields={section.fields}
        id={bodyId}
        isOpen={isOpen}
        sessionId={sessionId}
        stepKey={section.stepKey}
      />
    </div>
  );
}

// =============================================================
// Helpers
// =============================================================

/**
 * Format an ISO timestamp like "May 19, 9:35 AM" (matches the
 * mockup's accordion `Updated` stamp format).
 */
function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}
