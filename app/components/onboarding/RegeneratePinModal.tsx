"use client";

// =============================================================
// RegeneratePinModal — spec §6.7 (with plan §6.3 tweaks)
// =============================================================
//
// Phase 6 PR B step B4 per phase-6-plan.md §6.3.
//
// Triggered from the action-bar link row's "Regenerate PIN code"
// button. Two-step flow (deliberate divergence from spec §6.7's
// auto-generate-on-open — plan §4.4 + §9 risk #4 require explicit
// confirmation for destructive actions):
//
//   Step 1 (confirmation):
//     Warning copy + Cancel + "Generate new PIN" buttons.
//
//   Step 2 (PIN display, after success):
//     6 large gold digit tiles + "Generate new" + "Copy PIN" +
//     "Done" buttons. "Generate new" re-runs the call WITHOUT
//     re-confirming — the click itself is the confirmation
//     since the user is already past step 1 (plan §6.3 tweak).
//
//   Step 2 error state:
//     Red callout with the upstream status + "Retry" + "Done"
//     buttons. Replaces the previous "hung spinner" failure
//     mode (plan §6.3 tweak).
//
// State machine:
//   idle → loading → { showing_pin | showing_error }
//   showing_pin → loading (on Generate new)
//   showing_error → loading (on Retry)
//   any → idle (on close)
//
// The PIN string is held in component state only. Never logged,
// never written to localStorage, never sent anywhere except the
// clipboard (via Copy PIN).

import { useState } from "react";
import { Copy, RefreshCcw } from "./icons";
import Modal from "./Modal";

type PinState =
  | { kind: "confirm" }
  | { kind: "loading" }
  | { kind: "showing_pin"; pin: string }
  | { kind: "showing_error"; message: string; upstreamStatus?: number };

interface RegeneratePinModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  contact: {
    email: string;
  };
}

export default function RegeneratePinModal({
  isOpen,
  onClose,
  sessionId,
  contact,
}: RegeneratePinModalProps) {
  const [state, setState] = useState<PinState>({ kind: "confirm" });
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const showCopied =
    copiedAt !== null && Date.now() - copiedAt < 1400;

  const callRegenerate = async () => {
    setState({ kind: "loading" });
    try {
      const token = sessionStorage.getItem("admin_token");
      if (!token) {
        setState({
          kind: "showing_error",
          message:
            "Not signed in. Open /admin in this tab to sign in, then try again.",
        });
        return;
      }
      const res = await fetch("/api/onboarding/regenerate-pin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        pin?: string;
        error?: string;
        upstream_status?: number;
      };
      if (!res.ok || typeof json.pin !== "string") {
        setState({
          kind: "showing_error",
          message:
            json.error ??
            `Request failed: ${res.status} ${res.statusText}`,
          upstreamStatus: json.upstream_status,
        });
        return;
      }
      setState({ kind: "showing_pin", pin: json.pin });
    } catch (err) {
      setState({
        kind: "showing_error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const handleCopy = async () => {
    if (state.kind !== "showing_pin") return;
    try {
      await navigator.clipboard.writeText(state.pin);
      setCopiedAt(Date.now());
      window.setTimeout(() => setCopiedAt(null), 1400);
    } catch (err) {
      console.warn("[RegeneratePinModal] clipboard write failed:", err);
    }
  };

  const handleClose = () => {
    if (state.kind === "loading") return;
    setState({ kind: "confirm" });
    setCopiedAt(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Regenerate PIN code"
      subtitle={contact.email || "(no email on file)"}
      footer={<Footer state={state} onCancel={handleClose} onGenerate={callRegenerate} onCopy={handleCopy} onDone={handleClose} showCopied={showCopied} />}
    >
      <Body state={state} contact={contact} />
    </Modal>
  );
}

// =============================================================
// Body — switches by state.kind
// =============================================================

function Body({
  state,
  contact,
}: {
  state: PinState;
  contact: { email: string };
}) {
  switch (state.kind) {
    case "confirm":
      return (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text-2)",
            lineHeight: 1.55,
          }}
        >
          Generating a new PIN invalidates the current one. The client
          will need the new PIN to access the form. The previous PIN
          stops working immediately.
        </p>
      );

    case "loading":
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 0",
            color: "var(--text-3)",
            fontSize: 13,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <RefreshCcw size={14} stroke="currentColor" />
            Generating new PIN…
          </span>
        </div>
      );

    case "showing_pin":
      return (
        <>
          <p
            style={{
              margin: "0 0 14px",
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.55,
            }}
          >
            A new 6-digit PIN has been generated for{" "}
            <strong style={{ color: "var(--text-1)" }}>
              {contact.email || "the client"}
            </strong>
            . The previous PIN is no longer valid.
          </p>
          <PinTiles pin={state.pin} />
          <p
            style={{
              margin: "14px 0 0",
              fontSize: 11,
              color: "var(--text-3)",
              textAlign: "center",
            }}
          >
            Share it with the client securely.
          </p>
        </>
      );

    case "showing_error":
      return (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            background: "var(--red-soft)",
            border: "1px solid var(--red)",
            borderRadius: "var(--radius-sm)",
            color: "var(--red)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Couldn&apos;t generate a new PIN
          </div>
          <div style={{ color: "var(--text-2)", fontSize: 12 }}>
            {state.message}
            {state.upstreamStatus !== undefined && (
              <> (upstream status {state.upstreamStatus})</>
            )}
          </div>
        </div>
      );
  }
}

// =============================================================
// PinTiles — 6 large gold digit tiles
// =============================================================

function PinTiles({ pin }: { pin: string }) {
  // Pad to 6 just in case upstream returns a shorter string —
  // shouldn't happen given onboarding's generatePin() always
  // returns 6 digits, but render defensively.
  const digits = pin.padStart(6, " ").slice(0, 6).split("");
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        justifyContent: "center",
        padding: "8px 0",
      }}
    >
      {digits.map((d, i) => (
        <div
          key={i}
          style={{
            width: 54,
            height: 68,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-2)",
            border: "1.5px solid var(--gold)",
            borderRadius: "var(--radius-sm)",
            color: "var(--gold)",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Roboto Mono", Consolas, monospace',
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: 0,
          }}
        >
          {d}
        </div>
      ))}
    </div>
  );
}

// =============================================================
// Footer — switches button set by state.kind
// =============================================================

function Footer({
  state,
  onCancel,
  onGenerate,
  onCopy,
  onDone,
  showCopied,
}: {
  state: PinState;
  onCancel: () => void;
  onGenerate: () => void;
  onCopy: () => void;
  onDone: () => void;
  showCopied: boolean;
}) {
  switch (state.kind) {
    case "confirm":
      return (
        <Row>
          <FooterButton variant="ghost" onClick={onCancel}>
            Cancel
          </FooterButton>
          <FooterButton variant="gold" onClick={onGenerate}>
            Generate new PIN
          </FooterButton>
        </Row>
      );

    case "loading":
      return (
        <Row>
          <FooterButton variant="ghost" onClick={() => {}} disabled>
            Cancel
          </FooterButton>
          <FooterButton variant="gold" onClick={() => {}} disabled>
            Generating…
          </FooterButton>
        </Row>
      );

    case "showing_pin":
      return (
        <Row>
          <FooterButton variant="ghost" onClick={onGenerate}>
            Generate new
          </FooterButton>
          <FooterButton variant="ghost" onClick={onCopy}>
            <Copy size={12} stroke="currentColor" />
            {showCopied ? "Copied ✓" : "Copy PIN"}
          </FooterButton>
          <FooterButton variant="gold" onClick={onDone}>
            Done
          </FooterButton>
        </Row>
      );

    case "showing_error":
      return (
        <Row>
          <FooterButton variant="ghost" onClick={onDone}>
            Done
          </FooterButton>
          <FooterButton variant="gold" onClick={onGenerate}>
            Retry
          </FooterButton>
        </Row>
      );
  }
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 10,
        alignItems: "center",
      }}
    >
      {children}
    </div>
  );
}

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
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}
