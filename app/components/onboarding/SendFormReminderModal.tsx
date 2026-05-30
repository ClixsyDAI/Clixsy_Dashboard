"use client";

// =============================================================
// SendFormReminderModal — spec §6.5
// =============================================================
//
// Phase 6 PR B step B2 per phase-6-plan.md §6.1, refactored in
// Phase 8 proper PR B per phase-8-proper-plan.md §5.
//
// Triggered from the action bar's "Send form reminder" button.
// Shows an email-preview pane and a Send button. Send POSTs to
// /api/onboarding/reminders, shows a 900ms "Reminder sent"
// pulse, then closes via onSent() so the parent can
// router.refresh() the reminder strip.
//
// Phase 8 proper change: the session token is no longer in the
// by-workbook-id payload (redacted to reduce credential surface).
// The modal now fetches the token from
// /api/onboarding/sessions/[id]/token on modal-open, builds the
// resume URL client-side, and renders the preview. Each modal-
// open writes one onboarding_audit_events row with source
// "send_reminder_modal" — even if the admin cancels without
// sending, the access is logged (the token left the database).
//
// The Send POST shape and the email rendering are unchanged from
// Phase 6.

import { useEffect, useState } from "react";
import { renderFormReminderEmail } from "../../lib/onboarding/email-templates";
import { buildOnboardingUrl } from "../../lib/onboarding/onboarding-url";
import EmailPreview from "./EmailPreview";
import Modal from "./Modal";
import { useAdminAuth } from "../../lib/use-admin-auth";

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
  };
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; resumeUrl: string }
  | { kind: "error"; message: string };

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
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "idle" });
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });

  // Fetch the token once per modal-open. The useEffect dep on
  // isOpen + sessionId means re-opens (close→open again) re-
  // fetch, which is correct — each open is an independent access
  // that should write its own audit row. We don't cache across
  // opens: the credential surface goal is "minimum lifetime in
  // browser", and re-fetching also gives the operator audit
  // visibility into every preview attempt.
  useEffect(() => {
    if (!isOpen) {
      // Reset state on close so the next open starts fresh.
      setFetchState({ kind: "idle" });
      setSendState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setFetchState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/onboarding/sessions/${sessionId}/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "send_reminder_modal" }),
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setFetchState({
            kind: "error",
            message:
              j.error ?? `Request failed: ${res.status} ${res.statusText}`,
          });
          return;
        }
        const { token } = (await res.json()) as { token: string };
        if (cancelled) return;
        setFetchState({
          kind: "ok",
          resumeUrl: buildOnboardingUrl(token),
        });
      } catch (err) {
        if (cancelled) return;
        setFetchState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Failed to fetch onboarding link",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId, fetchWithAuth]);

  const handleSend = async () => {
    if (fetchState.kind !== "ok") return;
    const { subject, body } = renderFormReminderEmail({
      first_name: contact.first_name,
      resume_url: fetchState.resumeUrl,
    });
    setSendState({ kind: "sending" });
    try {
      const res = await fetchWithAuth("/api/onboarding/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          kind: "form_reminder",
          subject,
          body,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSendState({
          kind: "error",
          message:
            j.error ?? `Request failed: ${res.status} ${res.statusText}`,
        });
        return;
      }
      // 900ms "Reminder sent" pulse, then notify parent.
      setSendState({ kind: "pulse" });
      window.setTimeout(() => {
        onSent();
        setSendState({ kind: "idle" });
      }, 900);
    } catch (err) {
      setSendState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const handleClose = () => {
    if (sendState.kind === "sending" || sendState.kind === "pulse") return;
    onClose();
  };

  const isBusy = sendState.kind === "sending" || sendState.kind === "pulse";
  const canSend =
    fetchState.kind === "ok" && Boolean(contact.email) && !isBusy;

  // Build preview content based on fetchState. The render-time
  // subject + body are only meaningful when we have a real URL —
  // before that, show a placeholder card so the modal layout
  // doesn't reflow when the fetch resolves.
  const previewContent = (() => {
    if (fetchState.kind === "loading" || fetchState.kind === "idle") {
      return (
        <div
          style={{
            padding: 16,
            background: "var(--surface-3)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-3)",
            fontSize: 12,
          }}
        >
          Loading email preview…
        </div>
      );
    }
    if (fetchState.kind === "error") {
      return (
        <div
          role="alert"
          style={{
            padding: 16,
            background: "var(--red-soft)",
            border: "1px solid var(--red)",
            borderRadius: "var(--radius-sm)",
            color: "var(--red)",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          Couldn't fetch the onboarding link. {fetchState.message}
        </div>
      );
    }
    const { subject, body } = renderFormReminderEmail({
      first_name: contact.first_name,
      resume_url: fetchState.resumeUrl,
    });
    return (
      <EmailPreview
        from={FROM_ADDRESS}
        to={contact.email || "(no email on file)"}
        subject={subject}
        body={body}
        ctaLabels={["Resume your form ->"]}
      />
    );
  })();

  return (
    <>
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
            disabled={!canSend}
          >
            {sendState.kind === "sending"
              ? "Sending…"
              : sendState.kind === "pulse"
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

      {previewContent}

      {sendState.kind === "error" && (
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
          {sendState.message}
        </div>
      )}
    </Modal>
    {signInPromptJsx}
    </>
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
