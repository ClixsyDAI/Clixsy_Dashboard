"use client";

// =============================================================
// ReminderRow — single-line row inside ReminderHistoryModal
// =============================================================
//
// Phase 6.5 PR B step B3 per phase-6.5-plan.md §6.3.
//
// One row of the Reminder History modal. NOT interactive — no
// click handler, no expand affordance, no aria-expanded. The
// modal is read-only and flat per spec §6.8 + mockup.
//
// Layout:
//   [Badge] [email_subject ............................. truncated]
//           {relative timestamp}{absolute on hover via title} · sent by {label}
//
// Client component only because formatRelative depends on the
// current clock — running it during SSR would freeze the
// "5 seconds ago" text at server-render time and look stale by
// the time the page hydrates.

import {
  formatAbsolute,
  formatRelative,
} from "../../lib/onboarding/format-reminder-date";
import type { ReminderHistoryRow } from "../../lib/onboarding/types";
import ReminderKindBadge from "./ReminderKindBadge";

interface ReminderRowProps {
  reminder: ReminderHistoryRow;
}

export default function ReminderRow({ reminder }: ReminderRowProps) {
  const sentDate = new Date(reminder.sent_at);
  const dateOk = !Number.isNaN(sentDate.getTime());
  const relative = dateOk ? formatRelative(sentDate, new Date()) : reminder.sent_at;
  const absolute = dateOk ? formatAbsolute(sentDate) : reminder.sent_at;

  return (
    <li
      style={{
        listStyle: "none",
        padding: "10px 14px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {/* Top line: badge + subject (truncated) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
        }}
      >
        <ReminderKindBadge kind={reminder.kind} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
          title={reminder.email_subject}
        >
          {reminder.email_subject}
        </span>
      </div>

      {/* Sub-line: relative timestamp (absolute on hover) + sent-by */}
      <div
        style={{
          fontSize: 11,
          color: "var(--text-3)",
        }}
      >
        <span title={absolute}>{relative}</span>
        {reminder.sent_by_label && (
          <> &middot; sent by {reminder.sent_by_label}</>
        )}
      </div>
    </li>
  );
}
