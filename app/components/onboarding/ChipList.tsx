// =============================================================
// ChipList — horizontal blue-tinted chips for array answers
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.6.
//
// Used by FieldRow when humanize() returns a `chip_list` kind.
// One chip per array element. Wraps onto multiple lines if the
// chip count overflows the row's right column.
//
// Visual: blue-tinted (matches the mockup's chip treatment for
// multi-select answers like languages, important_metrics,
// service_trades).
//
// Pure server component.

interface ChipListProps {
  chips: string[];
}

export default function ChipList({ chips }: ChipListProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
      }}
    >
      {chips.map((chip, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 10,
            background: "var(--blue-soft)",
            color: "var(--blue)",
            border: "1px solid rgba(106, 168, 224, 0.32)",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
          }}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}
