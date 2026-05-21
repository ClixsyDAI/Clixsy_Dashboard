// =============================================================
// ReminderKindBadge — small pill for reminder kind labels
// =============================================================
//
// Phase 6.5 PR B step B2 per phase-6.5-plan.md §6.4.
//
// Two-variant pill component:
//   - form_reminder  → ghost grey
//   - access_request → amber
//
// Server-renderable — no state, no handlers. Used inside
// <ReminderRow> (Phase 6.5 PR B B3) and referenced (by name only)
// in the empty-state copy of <ReminderHistoryModal>.
//
// Visual matches the MissingPill / state-pill shape established
// in Phase 4: small pill, ~11px font, 3px x 10px padding,
// 999px radius (fully-rounded). Variant colors come from the
// scoped CSS tokens (see app/styles/onboarding-tab.css).
//
// Risk #4 carry-over from phase-6.5-plan.md §9: the label text
// here must match the empty-state copy in
// <ReminderHistoryModal>. If either side renames, audit both.

import type { ReminderKind } from "../../lib/onboarding/types";

interface ReminderKindBadgeProps {
  kind: ReminderKind;
}

interface BadgeVisual {
  label: string;
  fg: string;
  bg: string;
}

const VISUAL_BY_KIND: Record<ReminderKind, BadgeVisual> = {
  form_reminder: {
    label: "Form reminder",
    fg: "var(--text-2)",
    bg: "var(--surface-3)",
  },
  access_request: {
    label: "Access request",
    fg: "var(--amber)",
    bg: "var(--amber-soft)",
  },
};

export default function ReminderKindBadge({ kind }: ReminderKindBadgeProps) {
  const visual = VISUAL_BY_KIND[kind];
  return (
    <span
      style={{
        background: visual.bg,
        color: visual.fg,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {visual.label}
    </span>
  );
}
