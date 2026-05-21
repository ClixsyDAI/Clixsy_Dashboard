"use client";

// =============================================================
// FormCompleteModal — submit summary tiles
// =============================================================
//
// Phase 5 PR B per phase-5-plan.md §6.5.
//
// Pipeline step 4 (Complete) modal. Surfaces the four stat
// tiles described in the spec: submitted timestamp, account
// manager, vertical, feedback rating. All fields fall back
// gracefully when null (the in-progress sessions in the
// backfilled set haven't reached submit; the modal still
// opens and shows the structure with "Not yet submitted" /
// "Not assigned" / "Not rated" copy).

import type { OnboardingSessionRow } from "../../lib/onboarding/types";
import Modal from "./Modal";

interface FormCompleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: OnboardingSessionRow;
}

export default function FormCompleteModal({
  isOpen,
  onClose,
  session,
}: FormCompleteModalProps) {
  const submittedFmt = session.submitted_at
    ? formatSubmittedAt(session.submitted_at)
    : null;
  const subtitle = submittedFmt ?? "Not yet submitted";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Onboarding complete"
      subtitle={subtitle}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <StatTile
          label="Submitted on"
          value={submittedFmt ?? "—"}
          muted={!submittedFmt}
        />
        <StatTile
          label="Account manager"
          value={session.account_manager ?? "Not assigned"}
          muted={!session.account_manager}
        />
        <StatTile
          label="Vertical"
          value={humanizeVertical(session.vertical)}
          muted={false}
        />
        <StatTile
          label="Feedback rating"
          value={
            session.feedback_rating == null
              ? "Not rated"
              : `${session.feedback_rating}/5`
          }
          muted={session.feedback_rating == null}
        />
      </div>
    </Modal>
  );
}

function StatTile({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          color: "var(--text-3)",
          fontWeight: 600,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: muted ? "var(--text-3)" : "var(--text-1)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function humanizeVertical(vertical: OnboardingSessionRow["vertical"]): string {
  switch (vertical) {
    case "law_firm":
      return "Law firm";
    case "home_services":
      return "Home services";
  }
}

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(d)} at ${timeFmt.format(d)}`;
}
