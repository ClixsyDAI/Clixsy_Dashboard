"use client";

// =============================================================
// ActionBarLinkRow — spec §4.2 (link row only)
// =============================================================
//
// Phase 2 PR B per phase-2-plan.md §5.3.
//
// The bottom row of the action bar. Contains the onboarding URL,
// "Copy link" (real), "View form" (real), and "Regenerate PIN
// code" (inert in Phase 2 — modal lands in spec §6.7 / build
// order step 11.12).
//
// Why this is a CLIENT component: "Copy link" needs
// `navigator.clipboard.writeText`, which only exists in the
// browser. ActionBar (the parent) stays a server component and
// embeds this one.
//
// **Safety note on `session.token` reaching the browser.**
// The token IS normally a credential — it grants form access
// when paired with a valid PIN cookie. But the URL this row
// constructs is *itself intended-public*: it's the exact same
// URL that gets emailed to the client, pasted in Slack, etc.
// Combined with the workbook being internal-only per audit §7
// (any request that can reach /client/[id] already sees this
// token), sending it to this client component introduces no
// new exposure. If a future phase ever exposes the workbook to
// non-internal users, this comment + the spec's auth posture
// need a fresh review.

import { useState } from "react";
import { Copy, ExternalLink, RefreshCcw } from "./icons";

interface ActionBarLinkRowProps {
  /** The session token. Combined with the onboarding tool's
   * base URL to form the public form URL. */
  token: string;
}

/** Base URL for the onboarding tool's public form. Hardcoded for
 * Phase 2 — the alternative is a `NEXT_PUBLIC_ONBOARDING_BASE_URL`
 * env var, which adds Vercel-config friction. Phase 3+ can hoist
 * if a different domain is ever used. */
const ONBOARDING_BASE_URL = "https://client-onboarding-tool.vercel.app";

export default function ActionBarLinkRow({ token }: ActionBarLinkRowProps) {
  const url = `${ONBOARDING_BASE_URL}/onboarding/${token}`;
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const showCopied = copiedAt !== null && Date.now() - copiedAt < 1400;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopiedAt(Date.now());
        // Auto-clear the "Copied" pulse after 1.4s.
        window.setTimeout(() => setCopiedAt(null), 1400);
        return;
      }
      // Fallback for browsers without Clipboard API (Safari
      // pre-13.1, Firefox non-secure contexts). The workbook is
      // desktop-only Chrome/Edge in practice per wb audit §7,
      // so this is belt-and-braces — not expected to fire.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedAt(Date.now());
      window.setTimeout(() => setCopiedAt(null), 1400);
    } catch (err) {
      // Don't spam the console with permission errors — surface
      // a brief visual on the button instead. Phase 3+ can add a
      // toast if proliferation warrants.
      console.warn("[ActionBarLinkRow] copy failed:", err);
    }
  };

  return (
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
        title={url}
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
        {url}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        style={linkButtonStyle("ghost")}
      >
        <Copy />
        {showCopied ? "Copied" : "Copy link"}
      </button>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...linkButtonStyle("ghost"), textDecoration: "none" }}
      >
        <ExternalLink />
        View form
      </a>

      {/* Regenerate PIN — inert in Phase 2 (modal lands later) */}
      <button
        type="button"
        disabled
        title="Coming in a later phase"
        style={{
          ...linkButtonStyle("gold"),
          cursor: "not-allowed",
          opacity: 0.85,
        }}
      >
        <RefreshCcw />
        Regenerate PIN code
      </button>
    </div>
  );
}

// =============================================================
// Styling helpers
// =============================================================

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

