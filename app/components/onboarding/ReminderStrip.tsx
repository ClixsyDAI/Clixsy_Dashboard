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
import type { OnboardingReminderSummary } from "../../lib/onboarding/types";

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
      <ClockIcon />
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

// =============================================================
// Helpers
// =============================================================

/**
 * Format a past date relative to `now` using `Intl.RelativeTimeFormat`.
 * Picks the largest natural unit (second → minute → hour → day → month →
 * year). With `numeric: 'auto'`, single-unit cases get phrasings like
 * "yesterday" / "last month" instead of "1 day ago" / "1 month ago".
 *
 * Inputs MUST be in the past (caller wraps via `formatRelative(sent, new
 * Date())`). The negative sign is applied here.
 */
function formatRelative(date: Date, now: Date): string {
  const ms = now.getTime() - date.getTime();
  const seconds = Math.round(ms / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const months = Math.round(days / 30);
  const years = Math.round(days / 365);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (hours < 24) return rtf.format(-hours, "hour");
  if (days < 30) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-months, "month");
  return rtf.format(-years, "year");
}

/**
 * Format an absolute timestamp to match the spec's example:
 *   "May 17, 2026 at 11:30 AM"
 *
 * Built from two DateTimeFormat instances rather than one so the
 * spec's literal " at " separator is preserved (Intl doesn't offer
 * a "long-date + time joined by 'at'" preset).
 */
function formatAbsolute(date: Date): string {
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(date)} at ${timeFmt.format(date)}`;
}

/**
 * Mockup icon sprite — inline SVG so a missing CDN can't strand
 * the page with empty rectangles (cf. spec Appendix D anti-pattern
 * #1, "Webfont-loaded icons").
 */
function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--gold)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
