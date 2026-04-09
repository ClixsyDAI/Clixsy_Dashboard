"use client";

import { useEffect, useState } from "react";

type Status =
  | "content-in-progress"
  | "content-for-review"
  | "queued-for-launch"
  | "published";

interface Article {
  id: string;
  month: string; // YYYY-MM
  title: string;
  type: string;
  status: Status;
  contentLink?: string;
  liveUrl?: string;
  brief?: string;
}

const STATUS_OPTIONS: { value: Status; label: string; color: string }[] = [
  { value: "content-in-progress", label: "Content in Progress", color: "#b08d57" },
  { value: "content-for-review", label: "Content for Review", color: "#c8a882" },
  { value: "queued-for-launch", label: "Queued for Launch", color: "#6a8caf" },
  { value: "published", label: "Published", color: "#2d6a4f" },
];

function statusMeta(s: Status) {
  return STATUS_OPTIONS.find((o) => o.value === s) ?? STATUS_OPTIONS[0];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonth(ym: string) {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  if (!y || isNaN(idx) || idx < 0 || idx > 11) return ym;
  return `${MONTHS[idx]} ${y}`;
}

function isValidUrl(v: string) {
  if (!v) return true;
  return /^https?:\/\//i.test(v.trim());
}

/* ── Inline-editable URL cell ───────────────────────────────── */
function UrlCell({
  value,
  placeholder,
  onSave,
  iconOnly = false,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  iconOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && !isValidUrl(trimmed)) {
      // reject invalid url, reset draft
      setDraft(value);
      setEditing(false);
      return;
    }
    onSave(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        type="url"
        autoFocus
        value={draft}
        placeholder="https://..."
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full rounded-sm px-2 py-1 text-xs"
        style={{
          backgroundColor: "#0a0a0a",
          color: "#f0ede8",
          border: "1px solid #c8a882",
        }}
      />
    );
  }

  if (!value) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs italic underline-offset-2 hover:underline"
        style={{ color: "#555" }}
        title={placeholder}
      >
        {iconOnly ? "+" : placeholder}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs hover:underline"
        style={{ color: "#c8a882" }}
        title={value}
      >
        <span aria-hidden>🔗</span>
        {!iconOnly && <span>Open</span>}
      </a>
      <button
        onClick={() => setEditing(true)}
        className="text-[10px]"
        style={{ color: "#555" }}
        title="Edit link"
      >
        edit
      </button>
    </div>
  );
}

/* ── Expandable brief cell ──────────────────────────────────── */
function BriefCell({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!value) {
    return <span className="text-xs italic" style={{ color: "#555" }}>—</span>;
  }
  const needsTruncation = value.length > 60;
  const shown = expanded || !needsTruncation ? value : value.slice(0, 60) + "…";
  return (
    <div className="max-w-[260px] text-xs" style={{ color: "#aaa" }}>
      <span className="whitespace-pre-wrap">{shown}</span>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="ml-1 underline"
          style={{ color: "#c8a882" }}
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

export default function ContentTab({ projectId }: { projectId: string }) {
  const storageKey = `clixsy-content-${projectId}`;
  const [articles, setArticles] = useState<Article[]>([]);
  const [loaded, setLoaded] = useState(false);

  // form state
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Blog Post");
  const [status, setStatus] = useState<Status>("content-in-progress");
  const [contentLink, setContentLink] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Article[];
        // Backward compat: ensure new fields default to ""
        const normalized = parsed.map((a) => ({
          contentLink: "",
          liveUrl: "",
          brief: "",
          ...a,
        }));
        setArticles(normalized);
      }
    } catch {}
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(articles));
    } catch {}
  }, [articles, loaded, storageKey]);

  function addArticle(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (contentLink && !isValidUrl(contentLink)) {
      setFormError("Content Link must start with http:// or https://");
      return;
    }
    if (liveUrl && !isValidUrl(liveUrl)) {
      setFormError("Live URL must start with http:// or https://");
      return;
    }
    setFormError(null);
    const newArticle: Article = {
      id: crypto.randomUUID(),
      month,
      title: title.trim(),
      type: type.trim() || "Blog Post",
      status,
      contentLink: contentLink.trim(),
      liveUrl: liveUrl.trim(),
      brief: brief.trim(),
    };
    setArticles((prev) => [newArticle, ...prev]);
    setTitle("");
    setStatus("content-in-progress");
    setContentLink("");
    setLiveUrl("");
    setBrief("");
  }

  function updateArticle(id: string, patch: Partial<Article>) {
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeArticle(id: string) {
    setArticles((prev) => prev.filter((a) => a.id !== id));
  }

  // Group by month, most recent first
  const grouped = articles.reduce<Record<string, Article[]>>((acc, a) => {
    (acc[a.month] ??= []).push(a);
    return acc;
  }, {});
  const monthKeys = Object.keys(grouped).sort().reverse();

  return (
    <div>
      {/* Add form */}
      <section
        className="rounded-sm p-5"
        style={{ backgroundColor: "#111111" }}
      >
        <h2
          className="mb-4 text-sm font-semibold tracking-widest uppercase"
          style={{ color: "#c8a882" }}
        >
          Add Article
        </h2>
        <form onSubmit={addArticle} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_200px_220px]">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              required
              className="rounded-sm px-3 py-2 text-sm"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
            />
            <input
              type="text"
              placeholder="Article Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="rounded-sm px-3 py-2 text-sm"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
            />
            <input
              type="text"
              placeholder="Type (e.g. Blog Post)"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-sm px-3 py-2 text-sm"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="rounded-sm px-3 py-2 text-sm"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              type="url"
              placeholder="Content Link (Google Doc, etc.)"
              value={contentLink}
              onChange={(e) => setContentLink(e.target.value)}
              className="rounded-sm px-3 py-2 text-sm"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
            />
            <input
              type="url"
              placeholder="Live URL"
              value={liveUrl}
              onChange={(e) => setLiveUrl(e.target.value)}
              className="rounded-sm px-3 py-2 text-sm"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
            />
          </div>
          <textarea
            placeholder="Brief / Notes (keyword target, word count, etc.)"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={2}
            className="w-full rounded-sm px-3 py-2 text-sm"
            style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
          />
          {formError && (
            <p className="text-xs" style={{ color: "#c97b63" }}>{formError}</p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-sm px-5 py-2 text-xs font-semibold tracking-widest uppercase transition-opacity hover:opacity-80"
              style={{ backgroundColor: "#c8a882", color: "#0a0a0a" }}
            >
              Add
            </button>
          </div>
        </form>
      </section>

      {/* List */}
      <section className="mt-8">
        {monthKeys.length === 0 ? (
          <p className="py-12 text-center text-sm" style={{ color: "#666" }}>
            No articles yet. Add your first one above.
          </p>
        ) : (
          monthKeys.map((mk) => (
            <div key={mk} className="mb-8">
              <h3
                className="text-lg font-bold tracking-wide"
                style={{ color: "#ffffff" }}
              >
                {formatMonth(mk)}
              </h3>
              <div
                className="mt-1 mb-3 h-[2px] w-full"
                style={{ backgroundColor: "#c8a882" }}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "#1a1a1a" }}>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Title</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Type</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Content Link</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Live URL</th>
                      <th className="hidden px-3 py-2.5 text-xs font-semibold md:table-cell" style={{ color: "#f0ede8" }}>Brief</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Status</th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-right" style={{ color: "#f0ede8" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[mk].map((a, i) => {
                      const meta = statusMeta(a.status);
                      return (
                        <tr
                          key={a.id}
                          style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}
                        >
                          <td className="px-3 py-2.5 font-medium align-top" style={{ color: "#f0ede8" }}>
                            {a.title}
                          </td>
                          <td className="px-3 py-2.5 align-top" style={{ color: "#888" }}>
                            {a.type}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <UrlCell
                              value={a.contentLink || ""}
                              placeholder="Add link"
                              onSave={(v) => updateArticle(a.id, { contentLink: v })}
                              iconOnly
                            />
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <UrlCell
                              value={a.liveUrl || ""}
                              placeholder="Add URL"
                              onSave={(v) => updateArticle(a.id, { liveUrl: v })}
                              iconOnly
                            />
                          </td>
                          <td className="hidden px-3 py-2.5 align-top md:table-cell">
                            <BriefCell value={a.brief || ""} />
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <select
                              value={a.status}
                              onChange={(e) => updateArticle(a.id, { status: e.target.value as Status })}
                              className="rounded-sm px-2 py-1 text-xs font-medium"
                              style={{
                                backgroundColor: `${meta.color}26`,
                                color: meta.color,
                                border: `1px solid ${meta.color}66`,
                              }}
                            >
                              {STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value} style={{ backgroundColor: "#1a1a1a", color: "#f0ede8" }}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2.5 text-right align-top">
                            <button
                              onClick={() => removeArticle(a.id)}
                              className="text-xs underline"
                              style={{ color: "#666" }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
