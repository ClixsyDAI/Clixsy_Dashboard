"use client";

import { useState, useRef, useEffect } from "react";
import { useAdminAuth } from "../lib/use-admin-auth";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AskQuestionTabProps {
  projectId: string;
  projectName: string;
}

const SUGGESTIONS = [
  "What tasks were completed in the last 30 days?",
  "Which open tasks are overdue?",
  "How is organic search trending vs. last month?",
  "What are our top 10 GSC queries?",
  "Summarise this client's local SEO health.",
];

function renderMarkdown(text: string): string {
  // Minimal markdown: headings, bold, inline code, lists, line breaks.
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escape(text).split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      const level = line.match(/^#+/)![0].length;
      out.push(
        `<div style="font-weight:700;color:#f0ede8;margin-top:8px;font-size:${
          level <= 2 ? "14px" : "13px"
        }">${line.replace(/^#+\s*/, "")}</div>`
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul style="margin:4px 0 4px 18px;list-style:disc">');
        inList = true;
      }
      out.push(`<li>${line.replace(/^[-*]\s+/, "")}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (line === "") {
      out.push("<div style='height:6px'></div>");
      continue;
    }
    out.push(`<div>${line}</div>`);
  }
  if (inList) out.push("</ul>");
  let html = out.join("");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:#1a1a1a;padding:1px 5px;border-radius:3px;color:#c8a882">$1</code>'
  );
  return html;
}

export default function AskQuestionTab({ projectId, projectName }: AskQuestionTabProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setError(null);
    const next: Message[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2
          className="text-lg font-bold tracking-wide"
          style={{ color: "#ffffff" }}
        >
          ASK A QUESTION
        </h2>
        <div className="mt-1 h-[2px] w-full" style={{ backgroundColor: "#c8a882" }} />
        <p className="mt-3 text-xs" style={{ color: "#888" }}>
          Ask anything about <span style={{ color: "#c8a882" }}>{projectName}</span>&apos;s
          Basecamp tasks, Google Search Console, Google Analytics, or local SEO. The
          assistant pulls live answers from this client&apos;s synced data.
        </p>
      </div>

      {/* Chat scroller */}
      <div
        ref={scrollerRef}
        className="rounded-sm p-4"
        style={{
          backgroundColor: "#111111",
          border: "1px solid #1f1f1f",
          minHeight: 360,
          maxHeight: 560,
          overflowY: "auto",
        }}
      >
        {messages.length === 0 && !loading && (
          <div style={{ color: "#666", fontSize: 13 }}>
            <div style={{ marginBottom: 10 }}>Try one of these to get started:</div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: "#0d0d0d",
                    border: "1px solid #222",
                    color: "#c8a882",
                    padding: "8px 12px",
                    borderRadius: 3,
                    fontSize: 12,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: 4,
                backgroundColor: m.role === "user" ? "#c8a882" : "#0d0d0d",
                color: m.role === "user" ? "#0a0a0a" : "#f0ede8",
                border: m.role === "user" ? "none" : "1px solid #1f1f1f",
                fontSize: 13,
                lineHeight: 1.5,
              }}
              dangerouslySetInnerHTML={{
                __html:
                  m.role === "assistant"
                    ? renderMarkdown(m.content)
                    : m.content
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;"),
              }}
            />
          </div>
        ))}

        {loading && (
          <div style={{ color: "#888", fontSize: 12, fontStyle: "italic" }}>
            Thinking
            <span className="inline-block animate-pulse">…</span>
          </div>
        )}

        {error && (
          <div
            style={{
              color: "#b08d57",
              fontSize: 12,
              marginTop: 8,
              padding: 8,
              border: "1px solid #b08d57",
              borderRadius: 3,
            }}
          >
            Error: {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about tasks, GSC, GA4, or local SEO… (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={loading}
          style={{
            flex: 1,
            backgroundColor: "#0d0d0d",
            border: "1px solid #222",
            color: "#f0ede8",
            padding: "10px 12px",
            borderRadius: 3,
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          style={{
            backgroundColor: loading || !input.trim() ? "#3a3022" : "#c8a882",
            color: "#0a0a0a",
            padding: "0 22px",
            borderRadius: 3,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </div>

      {messages.length > 0 && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            style={{ color: "#666", fontSize: 11, textDecoration: "underline" }}
          >
            Clear conversation
          </button>
        </div>
      )}
      {signInPromptJsx}
    </div>
  );
}
