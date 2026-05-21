"use client";

// =============================================================
// SectionsCompletedModal — per-section progress list
// =============================================================
//
// Phase 5 PR B per phase-5-plan.md §6.4.
//
// Pipeline step 3 (In progress) modal. Renders all 12
// sections with state pills derived from the ProjectedSection
// payload (PR A added the `completed` field).
//
// Tile state rules (per phase-5-plan.md §5.2):
//   completed === true                          → "Complete" (green)
//   completed === false && answeredFields > 0   → "In progress · A/T" (amber)
//   completed === false && answeredFields === 0 → "Not started" (grey)
//   isInformational                             → no pill (review row)
//
// The denominator in the subtitle counts only actionable
// sections (currently 11 of 12; section 11 is informational).

import type { ProjectedSection } from "../../lib/onboarding/project-sections";
import Modal from "./Modal";

interface SectionsCompletedModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: ProjectedSection[];
}

export default function SectionsCompletedModal({
  isOpen,
  onClose,
  sections,
}: SectionsCompletedModalProps) {
  const actionableCount = sections.filter((s) => !s.isInformational).length;
  const completedCount = sections.filter(
    (s) => !s.isInformational && s.completed === true,
  ).length;
  const subtitle = `${completedCount} of ${actionableCount} sections complete`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Form progress"
      subtitle={subtitle}
    >
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {sections.map((section) => (
          <SectionProgressRow key={section.stepKey} section={section} />
        ))}
      </ul>
    </Modal>
  );
}

function SectionProgressRow({ section }: { section: ProjectedSection }) {
  const sectionNumber = String(section.number).padStart(2, "0");
  const updatedStamp = section.updatedAt
    ? formatUpdatedAt(section.updatedAt)
    : null;
  const pill = computePill(section);

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          color: "var(--text-3)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
          width: 22,
        }}
      >
        {sectionNumber}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {section.name}
        </div>
        {updatedStamp && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              marginTop: 2,
            }}
          >
            Updated {updatedStamp}
          </div>
        )}
      </div>
      {pill && <StatePill pill={pill} />}
    </li>
  );
}

interface PillSpec {
  label: string;
  fg: string;
  bg: string;
}

function computePill(section: ProjectedSection): PillSpec | null {
  if (section.isInformational) return null;
  if (section.completed === true) {
    return {
      label: "Complete",
      fg: "var(--green)",
      bg: "var(--green-soft)",
    };
  }
  const answered = section.fields.length - section.missingCount;
  if (answered > 0) {
    return {
      label: `In progress · ${answered}/${section.fields.length} answered`,
      fg: "var(--amber)",
      bg: "var(--amber-soft)",
    };
  }
  return {
    label: "Not started",
    fg: "var(--text-3)",
    bg: "var(--surface-3)",
  };
}

function StatePill({ pill }: { pill: PillSpec }) {
  return (
    <span
      style={{
        background: pill.bg,
        color: pill.fg,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {pill.label}
    </span>
  );
}

/**
 * Same shape as SectionRow's formatter — "May 19, 9:35 AM".
 * Kept inline rather than shared to avoid a lib-tier helper just
 * for two-call-site display formatting.
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
