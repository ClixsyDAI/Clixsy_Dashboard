"use client";

// =============================================================
// ActionBarLinkRow — spec §4.2 (link row only)
// =============================================================
//
// Phase 2 PR B per phase-2-plan.md §5.3, refactored in Phase 8
// proper PR B per phase-8-proper-plan.md §5.
//
// The bottom row of the action bar. Contains the onboarding URL
// preview, "Copy link", "View form", and "Regenerate PIN code".
//
// Phase 8 proper change: this component no longer receives the
// session token as a prop. The token is a credential redacted
// from the by-workbook-id payload (so it doesn't reach every
// workbook page load). Copy + View now fetch the token from
// /api/onboarding/sessions/[id]/token on click, with each access
// audited in onboarding_audit_events. The displayed URL is a
// placeholder until the user clicks.
//
// Why this is a CLIENT component: "Copy link" needs
// `navigator.clipboard.writeText`, which only exists in the
// browser. ActionBar (the parent) stays a server component and
// embeds this one.

import { useState } from "react";
import type { ActionBarModalKind } from "./ActionBarModals";
import { Copy, ExternalLink, RefreshCcw } from "./icons";
import { ONBOARDING_BASE_URL, buildOnboardingUrl } from "../../lib/onboarding/onboarding-url";
import { useAdminAuth } from "../../lib/use-admin-auth";

interface ActionBarLinkRowProps {
  /** Session id. The token is no longer threaded as a prop —
   * Copy/View fetch it on click from the dedicated endpoint. */
  sessionId: string;
  /** Phase 6 PR B: ActionBarModals (via ActionBar) passes this
   * so the "Regenerate PIN code" button opens its modal. */
  onAction: (kind: ActionBarModalKind) => void;
}

// Placeholder shown in the URL preview before any click. Bullets
// occupy roughly the same visual width a real token does, so the
// row doesn't reflow when the URL becomes real (Copy/View
// briefly puts the real URL in the box during the success pulse).
const TOKEN_PLACEHOLDER = "••••••••••••••••";

// Source-discriminator values for the audit log. Must match the
// VALID_SOURCES whitelist in
// /api/onboarding/sessions/[id]/token/route.ts.
const SOURCE_COPY = "copy_link";
const SOURCE_VIEW = "view_form";

export default function ActionBarLinkRow({
  sessionId,
  onAction,
}: ActionBarLinkRowProps) {
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();
  const placeholderUrl = `${ONBOARDING_BASE_URL}/onboarding/${TOKEN_PLACEHOLDER}`;
  const [displayUrl, setDisplayUrl] = useState<string>(placeholderUrl);
  const [copyState, setCopyState] = useState<ButtonState>({ kind: "idle" });
  const [viewState, setViewState] = useState<ButtonState>({ kind: "idle" });

  const showCopied =
    copyState.kind === "success" && Date.now() - copyState.at < 1400;

  // Fetch the token from the dedicated endpoint. Returns the URL
  // on success, throws on failure (with a server-provided message
  // when possible). Each call writes one audit row server-side.
  // 401 is handled by useAdminAuth — the sign-in modal pops and
  // the call retries after the user signs in.
  const fetchOnboardingUrl = async (source: string): Promise<string> => {
    const res = await fetchWithAuth(
      `/api/onboarding/sessions/${sessionId}/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      },
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(
        (j as { error?: string }).error ??
          `Request failed: ${res.status} ${res.statusText}`,
      );
    }
    const { token } = (await res.json()) as { token: string };
    return buildOnboardingUrl(token);
  };

  const handleCopy = async () => {
    setCopyState({ kind: "loading" });
    try {
      const url = await fetchOnboardingUrl(SOURCE_COPY);
      setDisplayUrl(url);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for browsers without Clipboard API. Workbook
        // is desktop-only Chrome/Edge per audit §7 so this is
        // belt-and-braces.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyState({ kind: "success", at: Date.now() });
      // Auto-clear the URL display + success pulse after 1.4s.
      window.setTimeout(() => {
        setCopyState({ kind: "idle" });
        setDisplayUrl(placeholderUrl);
      }, 1400);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Copy failed";
      setCopyState({ kind: "error", message });
      // Auto-clear errors after 4s so the user can retry.
      window.setTimeout(() => setCopyState({ kind: "idle" }), 4000);
    }
  };

  const handleView = async () => {
    setViewState({ kind: "loading" });
    try {
      const url = await fetchOnboardingUrl(SOURCE_VIEW);
      // window.open with noopener for safety. If the popup is
      // blocked this returns null — handle gracefully.
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        throw new Error("Popup blocked. Allow popups for this site to View form.");
      }
      setViewState({ kind: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "View failed";
      setViewState({ kind: "error", message });
      window.setTimeout(() => setViewState({ kind: "idle" }), 4000);
    }
  };

  const inlineError =
    copyState.kind === "error"
      ? copyState.message
      : viewState.kind === "error"
        ? viewState.message
        : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "nowrap",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-3)",
            minWidth: 120,
            flexShrink: 0,
            fontWeight: 600,
          }}
        >
          Onboarding link
        </span>

        <div
          title={displayUrl}
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: "var(--surface-3)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Roboto Mono", Consolas, monospace',
            fontSize: 12,
            color: "var(--text-2)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayUrl}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          disabled={copyState.kind === "loading"}
          style={linkButtonStyle("ghost")}
        >
          <Copy />
          {copyState.kind === "loading"
            ? "Fetching…"
            : showCopied
              ? "Copied"
              : "Copy link"}
        </button>

        <button
          type="button"
          onClick={handleView}
          disabled={viewState.kind === "loading"}
          style={linkButtonStyle("ghost")}
        >
          <ExternalLink />
          {viewState.kind === "loading" ? "Fetching…" : "View form"}
        </button>

        <button
          type="button"
          onClick={() => onAction("regenerate_pin")}
          style={linkButtonStyle("gold")}
        >
          <RefreshCcw />
          Regenerate PIN code
        </button>
      </div>

      {inlineError && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--red)",
            background: "var(--red-soft)",
            border: "1px solid var(--red)",
            borderRadius: "var(--radius-sm)",
            padding: "6px 10px",
            lineHeight: 1.4,
          }}
        >
          {inlineError}
        </div>
      )}
      {signInPromptJsx}
    </div>
  );
}

// =============================================================
// Local types + styles
// =============================================================

type ButtonState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; at: number }
  | { kind: "error"; message: string };

function linkButtonStyle(variant: "ghost" | "gold"): React.CSSProperties {
  const isGold = variant === "gold";
  return {
    background: isGold ? "var(--gold)" : "var(--surface-2)",
    color: isGold ? "#2a1f10" : "var(--text-1)",
    border: isGold ? "1px solid var(--gold)" : "1px solid var(--border-strong)",
    padding: "8px 12px",
    borderRadius: "var(--radius-sm)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}
