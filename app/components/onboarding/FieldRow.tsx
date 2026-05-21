// =============================================================
// FieldRow — one question + answer in the accordion body
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.5.
//
// Renders a single accordion field-row. Dispatches on the
// HumanizeResult's `kind` to produce the right visual:
//
//   text         → plain span in --text-2
//   chip_list    → <ChipList /> (blue-tinted chips, multi-select)
//   missing_pill → <MissingPill /> (amber, missing-like values)
//   url          → <a> in --gold, target=_blank
//   email        → <a href="mailto:…"> in --text-2
//   tel          → <a href="tel:…"> in --text-2
//
// Layout per spec §4.4:
//   [label column 280px fixed]    [value column flex-1]
//
// Pure server component — no client-side state. Phase 7+ adds
// the hover-reveal copy icon and edit pencil on the value side;
// Phase 4 is read-only so we don't render those slots at all.

import type { ProjectedField } from "../../lib/onboarding/project-sections";
import MissingPill from "./MissingPill";
import ChipList from "./ChipList";

interface FieldRowProps {
  field: ProjectedField;
}

export default function FieldRow({ field }: FieldRowProps) {
  return (
    <div
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
        }}
      >
        <FieldValue value={field.value} />
      </div>
    </div>
  );
}

// =============================================================
// Value dispatch
// =============================================================

function FieldValue({ value }: { value: ProjectedField["value"] }) {
  switch (value.kind) {
    case "text":
      return <span>{value.display}</span>;

    case "chip_list":
      return <ChipList chips={value.chips} />;

    case "missing_pill":
      return <MissingPill>{value.display}</MissingPill>;

    case "url":
      return (
        <a
          href={value.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--gold)",
            textDecoration: "none",
            wordBreak: "break-all",
          }}
        >
          {value.display}
        </a>
      );

    case "email":
      return (
        <a
          href={value.href}
          style={{
            color: "var(--text-2)",
            textDecoration: "underline",
            textDecorationColor: "var(--border-strong)",
            textUnderlineOffset: 2,
          }}
        >
          {value.display}
        </a>
      );

    case "tel":
      return (
        <a
          href={value.href}
          style={{
            color: "var(--text-2)",
            textDecoration: "underline",
            textDecorationColor: "var(--border-strong)",
            textUnderlineOffset: 2,
          }}
        >
          {value.display}
        </a>
      );
  }
}
