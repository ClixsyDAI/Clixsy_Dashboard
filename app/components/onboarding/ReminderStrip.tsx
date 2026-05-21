"use client";

// =============================================================
// ReminderStrip — spec §4.1
// =============================================================
//
// Phase 2 PR B per phase-2-plan.md §4.2.
//
// The thin status bar at the very top of the Onboarding tab.
//   - Empty `onboarding_reminders` table → "Never sent" + history
//     link hidden (operator resolution; the alternative "hide
//     entire strip" was rejected so the tab keeps a stable height
//     across states).
//   - Non-empty → "Last reminder sent: {relative}, {absolute}"
//     with a right-aligned "View reminder history →" link.
//
// Client component because:
//   - Relative time depends on the current clock and we want it
//     to be fresh on every render. Server-rendered "2 days ago"
//     would be stale by the time the page hydrates.
//
// Inert in Phase 2:
//   - The "View reminder history →" link renders but doesn't open
//     anything yet. The Reminder History modal lands in a later
//     phase (spec §6.8). The link is left present-but-inert so the
//     visual block matches the mockup; users clicking it during
//     Phase 2 see nothing happen, which is documented in the PR.

import { useMemo } from "react";
import {
  formatAbsolute,
  formatRelative,
} from "../../lib/onboarding/format-reminder-date";
import type { OnboardingReminderSummary } from "../../lib/onboarding/types";
import { Clock } from "./icons";

interface ReminderStripProps {
  latestReminder: OnboardingReminderSummary | null;
}

export default function ReminderStrip({ latestReminder }: ReminderStripProps) {
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
      {sentDisplay && (
        <a
          // Inert in Phase 2 — the Reminder History modal lands in a
          // later phase. No href so the browser doesn't navigate.
          role="button"
          aria-disabled="true"
          style={{
            marginLeft: "auto",
            color: "var(--gold)",
            fontSize: 11.5,
            cursor: "pointer",
            textDecoration: "none",
          }}
          onClick={(e) => e.preventDefault()}
        >
          View reminder history &rarr;
        </a>
      )}
    </div>
  );
}


