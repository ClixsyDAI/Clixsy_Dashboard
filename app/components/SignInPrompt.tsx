"use client";

// =============================================================
// SignInPrompt — inline admin sign-in modal
// =============================================================
//
// The fallback UI when an admin-gated action fires without (or
// with stale) auth. Renders a small modal with a password field;
// on success it writes the admin_token to sessionStorage and
// invokes onSignedIn so the caller can retry the original action.
//
// Replaces the pre-fetch sessionStorage gate in 9 components that
// previously dead-ended on "Not signed in. Open /admin in this tab
// to sign in, then try again." See useAdminAuth() for the wiring
// pattern.
//
// Visual style mirrors the /admin LoginScreen at app/admin/page.tsx
// for cross-page consistency: dark background, gold submit button,
// "Admin Access" title, password placeholder.

import { useEffect, useRef, useState } from "react";
import Modal from "./onboarding/Modal";

interface SignInPromptProps {
  isOpen: boolean;
  onSignedIn: (token: string) => void;
  onCancel: () => void;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export default function SignInPrompt({
  isOpen,
  onSignedIn,
  onCancel,
}: SignInPromptProps) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on close so the next open starts fresh.
  useEffect(() => {
    if (!isOpen) {
      setPassword("");
      setState({ kind: "idle" });
    }
  }, [isOpen]);

  // Autofocus the password field when the modal opens — the
  // shared Modal's FocusTrap handles tab cycling within the
  // dialog but doesn't pick the password field by default.
  useEffect(() => {
    if (isOpen) {
      // Defer one tick so FocusTrap has finished its own focus
      // dance before we override.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [isOpen]);

  const submit = async () => {
    if (!password) return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setState({ kind: "error", message: "Incorrect password" });
        return;
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Sign-in failed: ${res.status} ${res.statusText}`,
        });
        return;
      }
      const { token } = (await res.json()) as { token: string };
      sessionStorage.setItem("admin_token", token);
      onSignedIn(token);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Admin sign-in required"
      subtitle="Your session expired or this tab is new. Sign in to continue."
      footer={
        <Footer
          state={state}
          canSubmit={password.length > 0 && state.kind !== "submitting"}
          onSubmit={submit}
          onCancel={onCancel}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Password"
          disabled={state.kind === "submitting"}
          autoComplete="current-password"
          aria-label="Admin password"
          className="w-full rounded-sm border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[#C8A882]"
          style={{
            backgroundColor: "#0a0a0a",
            borderColor: "#333",
            color: "#f0ede8",
          }}
        />
        {state.kind === "error" && (
          <p
            role="alert"
            className="text-xs"
            style={{ color: "#e06666", margin: 0 }}
          >
            {state.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Footer({
  state,
  canSubmit,
  onSubmit,
  onCancel,
}: {
  state: SubmitState;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={state.kind === "submitting"}
        className="rounded-sm px-4 py-2 text-xs font-semibold tracking-wide uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{
          backgroundColor: "transparent",
          color: "#888",
          border: "1px solid #333",
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="rounded-sm px-4 py-2 text-xs font-semibold tracking-wide uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
      >
        {state.kind === "submitting" ? "Signing in…" : "Sign In"}
      </button>
    </div>
  );
}
