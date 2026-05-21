"use client";

// =============================================================
// ReminderStrip — spec §4.1
// =============================================================
//
// Phase 2 PR B per phase-2-plan.md §4.2.
// Phase 6.5 PR B per phase-6.5-plan.md §6.7 — the "View reminder
// history →" link is no longer inert. ReminderStripModals (the
// new composition manager) passes an onViewHistory callback that
// opens the Reminder History modal (spec §6.8).
//
// The thin status bar at the very top of the Onboarding tab.
//   - Empty `onboarding_reminders` table → "Never sent" + history
//     button hidden (operator resolution; the alternative "hide
//     entire strip" was rejected so the tab keeps a stable height
//     across states).
//   - Non-empty → "Last reminder sent: {relative}, {absolute}"
//     with a right-aligned "View reminder history →" button.
//
// Client component because:
//   - Relative time depends on the current clock and we want it
//     to be fresh on every render. Server-rendered "2 days ago"
//     would be stale by the time the page hydrates.
//   - Receives an onViewHistory function prop, which can't cross
//     the RSC server-to-client boundary.

import { useMemo } from "react";
import {
  formatAbsolute,
  formatRelative,
} from "../../lib/onboarding/format-reminder-date";
import type { OnboardingReminderSummary } from "../../lib/onboarding/types";
import { Clock } from "./icons";

interface ReminderStripProps {
  latestReminder: OnboardingReminderSummary | null;
  /** Phase 6.5 PR B: ReminderStripModals wires this to open the
   * Reminder History modal. The strip's history button only
   * renders when latestReminder is non-null AND this prop is
   * provided. */
  onViewHistory?: () => void;
}

export default function ReminderStrip({
  latestReminder,
  onViewHistory,
}: ReminderStripProps) {
  // Compute display strings once per render. The absolute timestamp
  // anchors the user — even if the relative phrasing is slightly off
  // by the time the page hydrates, the absolute date is unambiguous.
  const sentDisplay = useMemo(() => {
    if (!latestReminder) return null;
    const sent = new Date(latestReminder.sent_at);
    if (Number.isNaN(sent.getTime())) return null;
    return {
      relative: formatRelative(sent, new Date()),
      absolute: formatAbsolute(sent),
    };
  }, [latestReminder]);

  return (
    <div
      style={{
        backgroundColor: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "9px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 36,
      }}
    >
      <Clock stroke="var(--gold)" />
      <span style={{ color: "var(--text-3)", fontSize: 12 }}>
        Last reminder sent:
      </span>
      <span
        style={{
          color: "var(--text-1)",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {sentDisplay
          ? `${sentDisplay.relative}, ${sentDisplay.absolute}`
          : "Never sent"}
      </span>
      {sentDisplay && onViewHistory && (
        <button
          type="button"
          onClick={onViewHistory}
          style={{
            // Match the original `<a>` chrome — reset native button
            // defaults so the gold-link visual is preserved.
            all: "unset",
            marginLeft: "auto",
            color: "var(--gold)",
            fontSize: 11.5,
            cursor: "pointer",
            // Make focus visible for keyboard users — the all: unset
            // strips the browser default ring.
            borderRadius: 2,
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = "2px solid var(--gold)";
            e.currentTarget.style.outlineOffset = "2px";
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = "none";
            e.currentTarget.style.outlineOffset = "0";
          }}
        >
          View reminder history &rarr;
        </button>
      )}
    </div>
  );
}


