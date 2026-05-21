// =============================================================
// FieldValue — read-only render of a HumanizeResult
// =============================================================
//
// Extracted from FieldRow.tsx during Phase 7 PR B step B3 so the
// new EditableFieldValue editor can render the same idle-state
// display without duplicating the dispatch logic.
//
// Pure server component. No state, no handlers. Dispatches on
// the HumanizeResult's `kind` to produce the right visual:
//
//   text         → plain span in --text-2
//   chip_list    → <ChipList /> (blue-tinted chips, multi-select)
//   missing_pill → <MissingPill /> (amber, missing-like values)
//   url          → <a> in --gold, target=_blank
//   email        → <a href="mailto:…"> in --text-2
//   tel          → <a href="tel:…"> in --text-2
//
// Behaviour is unchanged from the Phase 4 inline implementation
// (same styles, same dispatch). This is a refactor with one new
// consumer; no visual regression.

import type { HumanizeResult } from "../../lib/onboarding/humanize";
import ChipList from "./ChipList";
import MissingPill from "./MissingPill";

interface FieldValueProps {
  value: HumanizeResult;
}

export default function FieldValue({ value }: FieldValueProps) {
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
