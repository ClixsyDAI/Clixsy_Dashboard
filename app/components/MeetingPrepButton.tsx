"use client";

/**
 * Meeting Prep — one-click AI briefing button + modal.
 *
 * INTERNAL ONLY. Renders in the internal per-client dashboard header.
 * Must NOT be used on the share (client-facing) page. On click:
 *   1. Opens a centered modal with a backdrop
 *   2. POSTs to /api/meeting-prep and streams the response body
 *   3. Renders the 5 fixed markdown sections progressively as tokens arrive
 *
 * The briefing is INTENTIONALLY regenerated on every open — the whole
 * point is that the AM clicks 10 minutes before the meeting and gets the
 * state as of now, not a stale cache.
 */

import { useState, useCallback, useEffect, useRef } from "react";

interface MeetingPrepButtonProps {
  projectId: string;
  projectName: string;
  /**
   * "prominent" (default) — full-size pulsing CTA for the client-detail header.
   * "compact"              — smaller, non-animated, fits inside a client-grid card.
   */
  variant?: "prominent" | "compact";
}

export default function MeetingPrepButton({
  projectId,
  projectName,
  variant = "prominent",
}: MeetingPrepButtonProps) {
  const isCompact = variant === "compact";
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    // Cancel any in-flight stream before starting a new one.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setContent("");
    try {
      const res = await fetch("/api/meeting-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `Request failed with status ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setContent((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Open → kick off generation. Re-open → regenerate (fresh state).
  useEffect(() => {
    if (open) generate();
    return () => {
      // When the modal closes, abort any in-flight stream to save tokens.
      if (!open) abortRef.current?.abort();
    };
  }, [open, generate]);

  // Escape closes, body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Cards wrap us in a <Link>/<div> — stop propagation so a click
          // on the button doesn't also trigger a card-level navigation.
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          isCompact
            ? "meeting-prep-cta-compact inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[10px] font-bold tracking-widest uppercase transition-all hover:opacity-90"
            : "meeting-prep-cta inline-flex items-center gap-2.5 rounded-sm px-5 py-3 text-sm font-bold tracking-widest uppercase transition-all hover:-translate-y-0.5 hover:opacity-95"
        }
        style={{
          backgroundColor: "#C8A882",
          color: "#0a0a0a",
          boxShadow: isCompact
            ? "0 0 0 1px rgba(200, 168, 130, 0.45)"
            : "0 0 0 1px rgba(200, 168, 130, 0.6), 0 4px 18px rgba(200, 168, 130, 0.45)",
        }}
        title="Generate an AI briefing for your next meeting with this client"
      >
        <MeetingIcon compact={isCompact} />
        <span>{isCompact ? "Meeting Prep" : "Meeting Prep"}</span>
        <span
          aria-hidden="true"
          className={
            isCompact
              ? "ml-0.5 rounded-[2px] px-1 py-0.5 text-[8px] font-black tracking-wider"
              : "ml-1 rounded-[2px] px-1.5 py-0.5 text-[9px] font-black tracking-widest"
          }
          style={{ backgroundColor: "#0a0a0a", color: "#C8A882" }}
        >
          AI
        </span>
      </button>
      {/* The pulse animation only targets `.meeting-prep-cta` (the prominent
          variant). Compact buttons use `.meeting-prep-cta-compact` and stay
          still — so always rendering this style block is safe, and it sits
          outside the conditional so styled-jsx picks it up reliably. */}
      <style jsx>{`
        @keyframes meetingPrepPulse {
          0%, 100% {
            box-shadow: 0 0 0 1px rgba(200, 168, 130, 0.6),
              0 4px 18px rgba(200, 168, 130, 0.45);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(200, 168, 130, 0.9),
              0 6px 24px rgba(200, 168, 130, 0.7);
          }
        }
        .meeting-prep-cta {
          animation: meetingPrepPulse 2.4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .meeting-prep-cta {
            animation: none;
          }
        }
      `}</style>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Meeting prep briefing for ${projectName}`}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8 md:py-16"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(4px)" }}
          onClick={(e) => {
            // Click on the backdrop (not the card) closes.
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-3xl rounded-sm border"
            style={{
              backgroundColor: "#0f0f0f",
              borderColor: "#1a1a1a",
              boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-start justify-between gap-4 border-b px-6 py-4"
              style={{ borderColor: "#1a1a1a" }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-semibold tracking-widest uppercase"
                    style={{ color: "#C8A882" }}
                  >
                    Meeting Prep
                  </span>
                  <span
                    className="h-3 w-[1px]"
                    style={{ backgroundColor: "#333" }}
                  />
                  <span
                    className="text-[10px] tracking-widest uppercase"
                    style={{ color: "#666" }}
                  >
                    Internal · {new Date().toLocaleDateString()}
                  </span>
                </div>
                <h2
                  className="mt-1 truncate text-xl font-bold tracking-wide uppercase"
                  style={{ color: "#ffffff" }}
                >
                  {projectName}
                </h2>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  className="rounded-sm border px-3 py-1 text-[10px] tracking-widest uppercase transition-all hover:opacity-80 disabled:opacity-40"
                  style={{
                    borderColor: "#2a2a2a",
                    color: "#C8A882",
                    backgroundColor: "transparent",
                  }}
                  title="Regenerate briefing"
                >
                  {loading ? "Generating…" : "Regenerate"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close briefing"
                  className="flex h-8 w-8 items-center justify-center rounded-sm transition-colors hover:bg-[#1a1a1a]"
                  style={{ color: "#888888" }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M3 3 L13 13 M13 3 L3 13" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5" style={{ color: "#f0ede8" }}>
              {error && (
                <div
                  className="mb-4 rounded-sm border px-4 py-3 text-sm"
                  style={{
                    borderColor: "#4a1f1f",
                    backgroundColor: "rgba(231, 76, 60, 0.1)",
                    color: "#f0a8a0",
                  }}
                >
                  <p className="font-semibold">Briefing failed to generate</p>
                  <p className="mt-1 text-xs opacity-80">{error}</p>
                  <button
                    type="button"
                    onClick={generate}
                    className="mt-2 text-xs underline hover:opacity-80"
                    style={{ color: "#C8A882" }}
                  >
                    Try again
                  </button>
                </div>
              )}

              {loading && content.length === 0 && <LoadingSkeleton />}

              {content.length > 0 && <BriefingMarkdown text={content} />}

              {!loading && content.length === 0 && !error && (
                <p className="py-8 text-center text-sm" style={{ color: "#666" }}>
                  Nothing to show yet.
                </p>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 text-[10px] tracking-wide uppercase"
              style={{ borderColor: "#1a1a1a", color: "#666" }}
            >
              <span>
                Generated by Claude · last 30d + next 14d · anchored to latest data
              </span>
              <span>Do not share outside Clixsy</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Sub-components ────────────────────────────────────────────── */

function MeetingIcon({ compact = false }: { compact?: boolean } = {}) {
  const size = compact ? 11 : 14;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4 h10 a1 1 0 0 1 1 1 v8 a1 1 0 0 1 -1 1 h-10 a1 1 0 0 1 -1 -1 v-8 a1 1 0 0 1 1 -1 z" />
      <path d="M5 2 v2 M11 2 v2 M2 7 h12" />
    </svg>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-5 w-40 rounded-sm" style={{ backgroundColor: "#1a1a1a" }} />
      <div className="space-y-2">
        <div className="h-3 w-full rounded-sm" style={{ backgroundColor: "#161616" }} />
        <div className="h-3 w-[85%] rounded-sm" style={{ backgroundColor: "#161616" }} />
        <div className="h-3 w-[65%] rounded-sm" style={{ backgroundColor: "#161616" }} />
      </div>
      <div className="h-5 w-32 rounded-sm" style={{ backgroundColor: "#1a1a1a" }} />
      <div className="space-y-2">
        <div className="h-3 w-full rounded-sm" style={{ backgroundColor: "#161616" }} />
        <div className="h-3 w-[75%] rounded-sm" style={{ backgroundColor: "#161616" }} />
      </div>
      <p className="mt-4 text-xs" style={{ color: "#666" }}>
        Reading tasks, analysing GSC/GA4 trends, checking the content pipeline…
      </p>
    </div>
  );
}

/**
 * Minimal markdown renderer for the 5-section briefing. The prompt
 * constrains output to `## heading`, `- bullet`, `**bold**`, blank
 * lines — so a tiny parser keeps us dependency-free and safe on
 * partial/streaming input (we rerender every token).
 *
 * Each known section heading gets a themed left border so the good/bad
 * split reads at a glance.
 */
const SECTION_THEMES: Record<string, { accent: string; bg: string }> = {
  "The Good":        { accent: "#2d6a4f", bg: "rgba(45, 106, 79, 0.08)" },
  "The Bad":         { accent: "#e74c3c", bg: "rgba(231, 76, 60, 0.06)" },
  "What to Focus On":{ accent: "#C8A882", bg: "rgba(200, 168, 130, 0.06)" },
  "Coming Up":       { accent: "#6c9cc9", bg: "rgba(108, 156, 201, 0.06)" },
  "Behind":          { accent: "#b08d57", bg: "rgba(176, 141, 87, 0.08)" },
};

function BriefingMarkdown({ text }: { text: string }) {
  // Split text into sections keyed by `## Heading`. Everything before the
  // first heading is dropped (shouldn't happen given the prompt, but we
  // guard against a preamble slipping through during streaming).
  const sections: Array<{ heading: string; body: string }> = [];
  const lines = text.split("\n");
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: buffer.join("\n").trim() });
      }
      currentHeading = headingMatch[1].trim();
      buffer = [];
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: buffer.join("\n").trim() });
  }

  if (sections.length === 0) {
    // Stream hasn't produced a heading yet — just dump what we have.
    return (
      <pre
        className="whitespace-pre-wrap text-sm leading-relaxed"
        style={{ color: "#d8d2c5", fontFamily: "inherit" }}
      >
        {text}
      </pre>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((s, i) => {
        const theme = SECTION_THEMES[s.heading] || {
          accent: "#333",
          bg: "transparent",
        };
        return (
          <section
            key={`${s.heading}-${i}`}
            className="rounded-sm border-l-[3px] px-4 py-3"
            style={{ borderColor: theme.accent, backgroundColor: theme.bg }}
          >
            <h3
              className="mb-2 text-xs font-bold tracking-widest uppercase"
              style={{ color: theme.accent }}
            >
              {s.heading}
            </h3>
            <BriefingBody body={s.body} />
          </section>
        );
      })}
    </div>
  );
}

function BriefingBody({ body }: { body: string }) {
  // Walk lines; group consecutive `- ` bullets into a <ul>, render plain
  // lines as <p>, skip blank lines.
  const lines = body.split("\n");
  const blocks: Array<{ kind: "p"; text: string } | { kind: "ul"; items: string[] }> = [];
  let ulItems: string[] = [];
  const flushUl = () => {
    if (ulItems.length > 0) {
      blocks.push({ kind: "ul", items: ulItems });
      ulItems = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushUl();
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      ulItems.push(bulletMatch[1]);
    } else {
      flushUl();
      blocks.push({ kind: "p", text: line });
    }
  }
  flushUl();

  return (
    <div className="space-y-2 text-sm leading-relaxed" style={{ color: "#d8d2c5" }}>
      {blocks.map((b, i) =>
        b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <InlineMarkdown text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <InlineMarkdown text={b.text} />
          </p>
        )
      )}
    </div>
  );
}

/**
 * Renders **bold** segments and `code` segments in a line, leaving
 * everything else as plain text. Keeps things dependency-free.
 */
function InlineMarkdown({ text }: { text: string }) {
  // Split on **bold** first, then on `code`.
  const parts: Array<{ kind: "text" | "bold" | "code"; value: string }> = [];
  const boldRe = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ kind: "text", value: text.slice(lastIdx, m.index) });
    }
    parts.push({ kind: "bold", value: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ kind: "text", value: text.slice(lastIdx) });
  }

  // Now split any text/bold parts on `code`.
  const out: Array<{ kind: "text" | "bold" | "code"; value: string }> = [];
  for (const part of parts) {
    if (part.kind !== "text" && part.kind !== "bold") {
      out.push(part);
      continue;
    }
    const codeRe = /`([^`]+)`/g;
    let last = 0;
    let cm: RegExpExecArray | null;
    const source = part.value;
    while ((cm = codeRe.exec(source)) !== null) {
      if (cm.index > last) {
        out.push({ kind: part.kind, value: source.slice(last, cm.index) });
      }
      out.push({ kind: "code", value: cm[1] });
      last = cm.index + cm[0].length;
    }
    if (last < source.length) {
      out.push({ kind: part.kind, value: source.slice(last) });
    }
  }

  return (
    <>
      {out.map((p, i) => {
        if (p.kind === "bold") {
          return (
            <strong key={i} style={{ color: "#ffffff" }}>
              {p.value}
            </strong>
          );
        }
        if (p.kind === "code") {
          return (
            <code
              key={i}
              className="rounded-sm px-1 py-0.5 text-[0.85em]"
              style={{ backgroundColor: "#1a1a1a", color: "#C8A882" }}
            >
              {p.value}
            </code>
          );
        }
        return <span key={i}>{p.value}</span>;
      })}
    </>
  );
}
