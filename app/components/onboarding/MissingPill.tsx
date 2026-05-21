// =============================================================
// MissingPill — amber rounded pill for missing-like field values
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.6.
//
// Used by FieldRow when humanize() returns a `missing_pill` kind.
// Also reusable by SectionRow's header pill when the section has
// missing fields (though SectionRow's pill uses different copy —
// "{n} missing" rather than the per-field reason).
//
// Visual: amber-tinted background + amber border, rounded pill
// shape, small inline-block. Matches spec §4.4 "amber missing
// pill" treatment.
//
// Pure server component — no state, no client interactions.

interface MissingPillProps {
  /** Display text inside the pill (e.g. "Not provided",
   * "Not sure", "Will do later", "Needs help", "3 missing"). */
  children: React.ReactNode;
}

export default function MissingPill({ children }: MissingPillProps) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 10,
        background: "var(--amber-soft)",
        color: "var(--amber)",
        border: "1px solid rgba(240, 185, 92, 0.32)",
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
