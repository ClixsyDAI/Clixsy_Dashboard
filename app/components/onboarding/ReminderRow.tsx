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
// Layout (mockup-exact, post-operator B3 follow-up):
//   [Badge] {relative timestamp (absolute on hover via title)} · sent by {label}
//
// email_subject is on the wire (PR A pulls it) but NOT rendered
// here. Kept available on the row data so a future hover
// tooltip or expanded view can use it without re-plumbing the
// payload.
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
        alignItems: "center",
        gap: 10,
        minWidth: 0,
      }}
    >
      <ReminderKindBadge kind={reminder.kind} />
      <span
        style={{
          fontSize: 12,
          color: "var(--text-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        <span title={absolute} style={{ color: "var(--text-1)" }}>
          {relative}
        </span>
        {reminder.sent_by_label && (
          <> &middot; sent by {reminder.sent_by_label}</>
        )}
      </span>
    </li>
  );
}
