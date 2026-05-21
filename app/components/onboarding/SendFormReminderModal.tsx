"use client";

// =============================================================
// SendFormReminderModal — spec §6.5
// =============================================================
//
// Phase 6 PR B step B2 per phase-6-plan.md §6.1.
//
// Triggered from the action bar's "Send form reminder" button.
// Shows an email-preview pane built from
// lib/onboarding/email-templates.ts (PR A) and a Send button.
// Send POSTs to /api/onboarding/reminders (PR A), shows a 900ms
// "Reminder sent" pulse, then closes via onSent() so the parent
// can router.refresh() the reminder strip.
//
// Phase 6 does NOT send an email. The DB row is written with
// the email subject + body; outbound delivery is Phase 9+.

import { useState } from "react";
import { renderFormReminderEmail } from "../../lib/onboarding/email-templates";
import EmailPreview from "./EmailPreview";
import Modal from "./Modal";

const FROM_ADDRESS = "Clixsy <onboarding@clixsy.com>";

interface SendFormReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fires after a successful send (after the 900ms pulse).
   * Parent uses this to router.refresh() the reminder strip
   * and close the modal. */
  onSent: () => void;
  sessionId: string;
  contact: {
    first_name: string;
    email: string;
    resume_url: string;
  };
}

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "pulse" }
  | { kind: "error"; message: string };

export default function SendFormReminderModal({
  isOpen,
  onClose,
  onSent,
  sessionId,
  contact,
}: SendFormReminderModalProps) {
  const [state, setState] = useState<SendState>({ kind: "idle" });

  const { subject, body } = renderFormReminderEmail({
    first_name: contact.first_name,
    resume_url: contact.resume_url,
  });

  const handleSend = async () => {
    setState({ kind: "sending" });
    try {
      const token = sessionStorage.getItem("admin_token");
      if (!token) {
        setState({
          kind: "error",
          message:
            "Not signed in. Open /admin in this tab to sign in, then try again.",
        });
        return;
      }
      const res = await fetch("/api/onboarding/reminders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
          kind: "form_reminder",
          subject,
          body,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message:
            j.error ??
            `Request failed: ${res.status} ${res.statusText}`,
        });
        return;
      }
      // 900ms "Reminder sent" pulse, then notify parent.
      setState({ kind: "pulse" });
      window.setTimeout(() => {
        onSent();
        setState({ kind: "idle" });
      }, 900);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const handleClose = () => {
    if (state.kind === "sending" || state.kind === "pulse") return;
    setState({ kind: "idle" });
    onClose();
  };

  const isBusy = state.kind === "sending" || state.kind === "pulse";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Send form reminder"
      subtitle={`Send to ${contact.email || "(no email on file)"}`}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <FooterButton
            variant="ghost"
            onClick={handleClose}
            disabled={isBusy}
          >
            Cancel
          </FooterButton>
          <FooterButton
            variant="gold"
            onClick={handleSend}
            disabled={isBusy || !contact.email}
          >
            {state.kind === "sending"
              ? "Sending…"
              : state.kind === "pulse"
                ? "Reminder sent ✓"
                : "Send reminder"}
          </FooterButton>
        </div>
      }
    >
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 13,
          color: "var(--text-2)",
          lineHeight: 1.55,
        }}
      >
        Send a reminder to{" "}
        <strong style={{ color: "var(--text-1)" }}>
          {contact.email || "(no email on file)"}
        </strong>
        ? This will nudge them gently to complete the missing sections of
        the form.
      </p>

      <EmailPreview
        from={FROM_ADDRESS}
        to={contact.email || "(no email on file)"}
        subject={subject}
        body={body}
        ctaLabels={["Resume your form ->"]}
      />

      {state.kind === "error" && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "var(--red-soft)",
            border: "1px solid var(--red)",
            borderRadius: "var(--radius-sm)",
            color: "var(--red)",
            fontSize: 12,
          }}
        >
          {state.message}
        </div>
      )}
    </Modal>
  );
}

// =============================================================
// Footer button helper
// =============================================================

function FooterButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant: "ghost" | "gold";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const isGold = variant === "gold";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: isGold ? "var(--gold)" : "var(--surface-2)",
        color: isGold ? "#2a1f10" : "var(--text-1)",
        border: isGold
          ? "1px solid var(--gold)"
          : "1px solid var(--border-strong)",
        padding: "8px 14px",
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}
