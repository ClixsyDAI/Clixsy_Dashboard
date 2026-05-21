"use client";

// =============================================================
// ReminderHistoryModal — spec §6.8
// =============================================================
//
// Phase 6.5 PR B step B3 per phase-6.5-plan.md §6.2.
//
// Triggered from the reminder strip's "View reminder history →"
// button. Read-only modal listing every reminder sent for the
// session, newest first, capped at REMINDERS_MODAL_LIMIT
// (PR A's named constant).
//
// Per plan §4.5 / Path A: the modal renders a flat list of
// single-line rows. No expand/collapse, no body rendering, no
// EmailPreview reuse. Matches spec §6.8 and the mockup at
// Resources/onboarding-tab-mockup.html lines 935-957 exactly.

import type { ReminderHistoryRow } from "../../lib/onboarding/types";
import Modal from "./Modal";
import ReminderRow from "./ReminderRow";

interface ReminderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  reminders: ReminderHistoryRow[];
  totalCount: number;
}

export default function ReminderHistoryModal({
  isOpen,
  onClose,
  reminders,
  totalCount,
}: ReminderHistoryModalProps) {
  const isEmpty = reminders.length === 0;
  const isCapped = totalCount > reminders.length;

  const subtitle = isEmpty
    ? "No reminders sent yet"
    : isCapped
      ? `Showing latest ${reminders.length} of ${totalCount} reminders`
      : `${totalCount} reminder${totalCount === 1 ? "" : "s"} sent`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reminder history"
      subtitle={subtitle}
    >
      {isEmpty ? <EmptyState /> : <RowList reminders={reminders} />}
    </Modal>
  );
}

function RowList({ reminders }: { reminders: ReminderHistoryRow[] }) {
  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {reminders.map((reminder) => (
        <ReminderRow key={reminder.id} reminder={reminder} />
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "12px 0",
        color: "var(--text-2)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <p style={{ margin: "0 0 12px" }}>
        No reminders have been sent for this session yet.
      </p>
      <p style={{ margin: 0, color: "var(--text-3)", fontSize: 12 }}>
        Reminders appear here after you send them from the action bar —
        either a{" "}
        <strong style={{ color: "var(--text-2)" }}>form reminder</strong>{" "}
        to nudge the client through unanswered sections, or an{" "}
        <strong style={{ color: "var(--text-2)" }}>access request</strong>{" "}
        to ask for outstanding logins.
      </p>
    </div>
  );
}
