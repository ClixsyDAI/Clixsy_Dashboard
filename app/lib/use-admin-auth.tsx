"use client";

// =============================================================
// useAdminAuth — inline admin-auth hook
// =============================================================
//
// Wraps the fetch-with-401-handling pattern so every admin-gated
// action in the dashboard shares one auth flow instead of nine
// reimplementations of the same client-side sessionStorage gate.
//
// What it does:
//
//   1. Silent re-auth on mount. If sessionStorage is empty, hit
//      GET /api/admin/auth/me which reads the httpOnly cookie and
//      echoes the token back if valid. Fixes the false-negative
//      where a fresh tab has a valid 7-day cookie but no
//      sessionStorage entry (the original dead-end Johan hit).
//
//   2. fetchWithAuth(url, options): sends the Bearer header from
//      sessionStorage when present (cookie auto-attaches for
//      same-origin requests anyway). On 401 it parks the call,
//      opens the inline SignInPrompt modal, and once the user
//      signs in (or cancels) resolves the original promise. The
//      caller treats it like a normal fetch — no auth scaffolding
//      per call site.
//
//   3. signInPromptJsx: render this once in the component tree to
//      surface the modal when an auth fail fires.
//
// Multiple concurrent 401s all queue behind the same modal and
// drain together on successful sign-in. On cancel, every queued
// retry rejects with "Sign-in cancelled".

import { useCallback, useEffect, useRef, useState } from "react";
import SignInPrompt from "../components/SignInPrompt";

const TOKEN_STORAGE_KEY = "admin_token";

type PendingRetry = {
  url: string;
  options: RequestInit;
  resolve: (res: Response) => void;
  reject: (err: unknown) => void;
};

function attachAuth(token: string | null, options: RequestInit): RequestInit {
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...options, headers, credentials: "same-origin" };
}

export function useAdminAuth() {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const pendingRef = useRef<PendingRetry[]>([]);

  // Silent re-auth on mount. Cookies are httpOnly so we can't read
  // them directly; the server-side endpoints read whichever cookie
  // is set and echo back a token if valid. Fires once per mount;
  // the modal is the fallback when both attempts return 401.
  //
  // Phase 1 PR B added two endpoints for two cookies:
  //
  //   - /api/admin/auth/session reads `app_session` (Google OAuth
  //     sign-in). Newer; tried FIRST because OAuth is the preferred
  //     sign-in path going forward.
  //   - /api/admin/auth/me reads `admin_token` (password sign-in).
  //     Existing path; tried second as the fallback.
  //
  // Both endpoints return the same { token } shape so the rest of
  // the hook's protocol is unchanged. The dual-cookie bridge in
  // PR B's callback guarantees both cookies are present after
  // OAuth — but we still try /session first because it's the more
  // authoritative source and the path that PR C will keep.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(TOKEN_STORAGE_KEY)) return;

    let cancelled = false;
    (async () => {
      try {
        const sessionRes = await fetch("/api/admin/auth/session", {
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (sessionRes.ok) {
          const data = (await sessionRes.json()) as { token?: string };
          if (!cancelled && data.token) {
            sessionStorage.setItem(TOKEN_STORAGE_KEY, data.token);
            return;
          }
        }
        const meRes = await fetch("/api/admin/auth/me", {
          credentials: "same-origin",
        });
        if (cancelled || !meRes.ok) return;
        const meData = (await meRes.json()) as { token?: string };
        if (cancelled || !meData.token) return;
        sessionStorage.setItem(TOKEN_STORAGE_KEY, meData.token);
      } catch {
        // Silent — modal will fire on first action that needs auth.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchWithAuth = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const tokenBefore = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      const firstAttempt = await fetch(url, attachAuth(tokenBefore, options));
      if (firstAttempt.status !== 401) {
        return firstAttempt;
      }

      // Auth failed. Queue the retry behind the modal and resolve
      // once the user signs in (or reject on cancel).
      return new Promise<Response>((resolve, reject) => {
        pendingRef.current.push({ url, options, resolve, reject });
        setIsPromptOpen(true);
      });
    },
    [],
  );

  const drainPendingWithToken = useCallback(async () => {
    const pending = pendingRef.current;
    pendingRef.current = [];
    const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    for (const p of pending) {
      try {
        const res = await fetch(p.url, attachAuth(token, p.options));
        p.resolve(res);
      } catch (err) {
        p.reject(err);
      }
    }
  }, []);

  const handleSignedIn = useCallback(() => {
    setIsPromptOpen(false);
    void drainPendingWithToken();
  }, [drainPendingWithToken]);

  const handleCancel = useCallback(() => {
    setIsPromptOpen(false);
    const pending = pendingRef.current;
    pendingRef.current = [];
    for (const p of pending) {
      p.reject(new Error("Sign-in cancelled"));
    }
  }, []);

  const signInPromptJsx = (
    <SignInPrompt
      isOpen={isPromptOpen}
      onSignedIn={handleSignedIn}
      onCancel={handleCancel}
    />
  );

  return { fetchWithAuth, signInPromptJsx };
}
