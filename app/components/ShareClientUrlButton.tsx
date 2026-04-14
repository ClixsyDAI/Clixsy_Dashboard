"use client";

import { useState } from "react";

interface Props {
  shareUrl: string;
}

/**
 * Button that reveals the client-safe share URL and copies it to the clipboard.
 * The token is generated server-side (in app/client/[id]/page.tsx) and passed
 * down here, so we don't need an API round-trip.
 */
export default function ShareClientUrlButton({ shareUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setRevealed(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — show the URL inline so the user can copy manually.
      setRevealed(true);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={copyToClipboard}
        className="inline-flex items-center gap-2 rounded-sm px-4 py-2 text-xs font-semibold tracking-widest uppercase transition-opacity hover:opacity-80"
        style={{
          backgroundColor: "#1a1a1a",
          color: "#c8a882",
          border: "1px solid #c8a882",
        }}
        title="Generate a shareable URL for the client"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        <span>{copied ? "Copied!" : "Copy Client Share URL"}</span>
      </button>

      {revealed && (
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-[400px] truncate rounded-sm px-2 py-1 text-[10px] underline"
          style={{ color: "#888", backgroundColor: "#111" }}
          title={shareUrl}
        >
          {shareUrl}
        </a>
      )}
    </div>
  );
}
