"use client";

// =============================================================
// RequestMissingAccessModal — spec §6.6
// =============================================================
//
// Phase 6 PR B step B3 per phase-6-plan.md §6.2.
//
// Triggered from the action bar's "Request missing access"
// button. Same structural shape as SendFormReminderModal but
// the email body is dynamic: built from the assets in the
// access checklist whose status is `missing` or `needs_help`.
// `later` and `na` are intentionally NOT requested (deferred or
// not applicable).
//
// Empty-missing edge case (plan §6.2): when there's nothing to
// request, the modal still opens but shows an explanatory
// paragraph instead of the preview, and only Cancel renders in
// the footer. Avoids sending an empty-bulleted email.
//
// Phase 6 does NOT send email. The row is written to
// onboarding_reminders with kind='access_request'; outbound
// delivery is Phase 9+.

import { useMemo, useState } from "react";
import {
  ACCESS_ASSET_KEYS,
  type AccessAssetKey,
  type AccessChecklistView,
} from "../../lib/onboarding/access-checklist";
import { renderAccessRequestEmail } from "../../lib/onboarding/email-templates";
import EmailPreview from "./EmailPreview";
import Modal from "./Modal";
import { useAdminAuth } from "../../lib/use-admin-auth";

const FROM_ADDRESS = "Clixsy <onboarding@clixsy.com>";

// Short labels for the inline intro-line comma list. Matches the
// AccessTile labels (Phase 5 PR B). Kept private here rather than
// extracted to a shared module yet — small enough to live
// alongside the consumer.
const SHORT_ASSET_LABELS: Record<AccessAssetKey, string> = {
  wordpress: "WordPress",
  domain: "Domain",
  dns: "DNS",
  gsc: "Search Console",
  ga: "Analytics",
  gbp: "Business Profile",
  youtube: "YouTube",
};

interface RequestMissingAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSent: () => void;
  sessionId: string;
  contact: {
    first_name: string;
    email: string;
  };
  accessChecklist: AccessChecklistView;
}

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "pulse" }
  | { kind: "error"; message: string };

export default function RequestMissingAccessModal({
  isOpen,
  onClose,
  onSent,
  sessionId,
  contact,
  accessChecklist,
}: RequestMissingAccessModalProps) {
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();
  const [state, setState] = useState<SendState>({ kind: "idle" });

  // Missing-like assets: status === "missing" OR "needs_help".
  // ACCESS_ASSET_KEYS order is preserved so the bullet list and
  // CTA row match the spec asset ordering.
  const missingAssets = useMemo<AccessAssetKey[]>(
    () =>
      ACCESS_ASSET_KEYS.filter((k) => {
        const status = accessChecklist.byAsset[k];
        return status === "missing" || status === "needs_help";
      }),
    [accessChecklist],
  );

  const hasMissing = missingAssets.length > 0;

  const { subject, body } = useMemo(
    () =>
      renderAccessRequestEmail(
        { first_name: contact.first_name },
        missingAssets,
      ),
    [contact.first_name, missingAssets],
  );

  // CTA labels match what renderAccessRequestEmail emits in the
  // body — duplicated here so EmailPreview knows which tokens to
  // pill-style. Mirrored from email-templates.ts ASSET_DETAIL.
  const ctaLabels = useMemo(
    () =>
      missingAssets.map((k) => {
        switch (k) {
          case "wordpress":
            return "Grant WordPress access";
          case "domain":
            return "Grant Domain access";
          case "dns":
            return "Grant DNS access";
          case "gsc":
            return "Grant Search Console access";
          case "ga":
            return "Grant Analytics access";
          case "gbp":
            return "Grant Business Profile access";
          case "youtube":
            return "Grant YouTube access";
        }
      }),
    [missingAssets],
  );

  const handleSend = async () => {
    setState({ kind: "sending" });
    try {
      const res = await fetchWithAuth("/api/onboarding/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          kind: "access_request",
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

  // ── Empty-missing branch ────────────────────────────────────
  if (!hasMissing) {
    return (
      <>
        <Modal
          isOpen={isOpen}
          onClose={handleClose}
          title="Request missing access"
          subtitle="Nothing to request right now"
          footer={
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <FooterButton variant="ghost" onClick={handleClose}>
                Close
              </FooterButton>
            </div>
          }
        >
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.55,
            }}
          >
            All access items are either provided, deferred to later, or
            marked not applicable. There&apos;s nothing outstanding to
            request from{" "}
            <strong style={{ color: "var(--text-1)" }}>
              {contact.email || "the client"}
            </strong>{" "}
            right now.
          </p>
        </Modal>
        {signInPromptJsx}
      </>
    );
  }

  // ── Normal preview + send branch ────────────────────────────
  const introList = missingAssets
    .map((k) => SHORT_ASSET_LABELS[k])
    .join(", ");

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Request missing access"
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
                ? "Request sent ✓"
                : "Send request"}
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
        Send an email to{" "}
        <strong style={{ color: "var(--text-1)" }}>
          {contact.email || "(no email on file)"}
        </strong>{" "}
        outlining how to grant the missing technical access (
        <strong style={{ color: "var(--text-1)" }}>{introList}</strong>).
      </p>

      <EmailPreview
        from={FROM_ADDRESS}
        to={contact.email || "(no email on file)"}
        subject={subject}
        body={body}
        ctaLabels={ctaLabels}
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
    {signInPromptJsx}
    </>
  );
}

// =============================================================
// Footer button (mirrors SendFormReminderModal's helper)
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
