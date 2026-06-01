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
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

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

  // Phase 1 PR B: Google sign-in alternative. Initiates the OAuth
  // handshake from inside the prompt; on completion the browser
  // is redirected back through /admin/auth/callback and the
  // session minted there auto-applies on the next render. The
  // pending action that opened this prompt will retry via
  // useAdminAuth's queue after sessionStorage is populated by the
  // silent re-auth on the next mount.
  //
  // Caveat: kicking off OAuth navigates the whole page away — the
  // user's in-flight action queue gets dropped. Acceptable
  // tradeoff vs the alternative of a popup OAuth flow with extra
  // moving parts. Documented for future iteration.
  const handleGoogleSignIn = async () => {
    setState({ kind: "submitting" });
    try {
      const supabase = getSupabaseBrowserClient();
      const origin = window.location.origin;
      const returnPath = window.location.pathname;
      const callbackUrl = `${origin}/admin/auth/callback?return=${encodeURIComponent(returnPath)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
          queryParams: { hd: "clixsy.com" },
        },
      });
      if (error) {
        setState({
          kind: "error",
          message: `Google sign-in failed: ${error.message}`,
        });
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
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
        <div
          className="my-1 flex items-center gap-3 text-[0.65rem] uppercase tracking-wider"
          style={{ color: "#555" }}
        >
          <div style={{ flex: 1, height: 1, backgroundColor: "#222" }} />
          <span>or</span>
          <div style={{ flex: 1, height: 1, backgroundColor: "#222" }} />
        </div>
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={state.kind === "submitting"}
          className="flex w-full items-center justify-center gap-2 rounded-sm py-2.5 text-sm font-semibold tracking-wide uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{
            backgroundColor: "#0a0a0a",
            color: "#f0ede8",
            border: "1px solid #333",
          }}
        >
          <GoogleGlyph />
          Sign in with Google
        </button>
      </div>
    </Modal>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
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
