"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTENT_STATUS_META,
  ContentArticle,
  ContentStatus,
  contentStorageKey,
} from "../lib/content-types";

const STATUS_OPTIONS: { value: ContentStatus; label: string }[] = [
  { value: "content-in-progress", label: "Content in Progress" },
  { value: "content-for-review", label: "Content for Review" },
  { value: "queued-for-launch", label: "Queued for Launch" },
  { value: "published", label: "Published" },
];

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

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatAgo(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function isValidUrl(v: string) {
  if (!v) return true;
  return /^https?:\/\//i.test(v.trim());
}

/* ── Inline-editable URL cell (local rows only) ─────────────── */
function UrlCell({
  value,
  placeholder,
  onSave,
  readOnly = false,
  isDocs = false,
}: {
  value: string;
  placeholder: string;
  onSave?: (v: string) => void;
  readOnly?: boolean;
  isDocs?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && !isValidUrl(trimmed)) {
      setDraft(value);
      setEditing(false);
      return;
    }
    onSave?.(trimmed);
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
        style={{ backgroundColor: "#0a0a0a", color: "#f0ede8", border: "1px solid #c8a882" }}
      />
    );
  }

  if (!value) {
    if (readOnly) return <span className="text-xs" style={{ color: "#555" }}>—</span>;
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs italic hover:underline"
        style={{ color: "#555" }}
      >
        {placeholder}
      </button>
    );
  }

  const icon = isDocs || /docs\.google\.com/i.test(value) ? "📄" : "🔗";
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
        <span aria-hidden>{icon}</span>
        <span>Open</span>
      </a>
      {!readOnly && (
        <button
          onClick={() => setEditing(true)}
          className="text-[10px]"
          style={{ color: "#555" }}
          title="Edit link"
        >
          edit
        </button>
      )}
    </div>
  );
}

/* ── Expandable brief cell ──────────────────────────────────── */
function BriefCell({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!value) return <span className="text-xs" style={{ color: "#555" }}>—</span>;
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

export default function ContentTab({
  projectId,
  clientName,
}: {
  projectId: string;
  clientName: string;
}) {
  const storageKey = contentStorageKey(projectId);

  const [localArticles, setLocalArticles] = useState<ContentArticle[]>([]);
  const [sheetArticles, setSheetArticles] = useState<ContentArticle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // form state
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Blog Post");
  const [status, setStatus] = useState<ContentStatus>("content-in-progress");
  const [contentLink, setContentLink] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Load local articles
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as ContentArticle[];
        const normalized = parsed.map((a) => ({
          contentLink: "",
          liveUrl: "",
          brief: "",
          source: "local" as const,
          ...a,
        }));
        setLocalArticles(normalized);
      }
    } catch {}
    setLoaded(true);
  }, [storageKey]);

  // Persist local articles
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(localArticles));
      // Notify pipeline overview in same tab
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    } catch {}
  }, [localArticles, loaded, storageKey]);

  // Fetch from Google Sheets
  const fetchSheet = useCallback(
    async (force = false) => {
      if (!clientName) return;
      setSyncing(true);
      setSyncError(null);
      try {
        const qs = new URLSearchParams({ client: clientName });
        if (force) qs.set("refresh", "1");
        const res = await fetch(`/api/content?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setSheetArticles(json.articles || []);
        setSyncedAt(json.syncedAt || new Date().toISOString());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ContentTab] sheet sync failed:", msg);
        setSyncError(msg);
      } finally {
        setSyncing(false);
      }
    },
    [clientName]
  );

  useEffect(() => {
    fetchSheet(false);
  }, [fetchSheet]);

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
    const newArticle: ContentArticle = {
      id: crypto.randomUUID(),
      month,
      title: title.trim(),
      type: type.trim() || "Blog Post",
      status,
      contentLink: contentLink.trim(),
      liveUrl: liveUrl.trim(),
      brief: brief.trim(),
      source: "local",
    };
    setLocalArticles((prev) => [newArticle, ...prev]);
    setTitle("");
    setStatus("content-in-progress");
    setContentLink("");
    setLiveUrl("");
    setBrief("");
  }

  function updateLocal(id: string, patch: Partial<ContentArticle>) {
    setLocalArticles((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeLocal(id: string) {
    setLocalArticles((prev) => prev.filter((a) => a.id !== id));
  }

  // Merge: sheet articles first, then local
  const merged = useMemo(
    () => [...sheetArticles, ...localArticles],
    [sheetArticles, localArticles]
  );

  const grouped = useMemo(() => {
    return merged.reduce<Record<string, ContentArticle[]>>((acc, a) => {
      (acc[a.month] ??= []).push(a);
      return acc;
    }, {});
  }, [merged]);

  const monthKeys = Object.keys(grouped).sort().reverse();

  return (
    <div>
      {/* Header: sync status + refresh */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs" style={{ color: "#888" }}>
          {syncing
            ? "Syncing from Google Sheets…"
            : syncError
              ? <span style={{ color: "#c97b63" }}>Sync error — showing local only</span>
              : <>Last synced: {formatAgo(syncedAt)} &middot; {sheetArticles.length} from sheet, {localArticles.length} local</>}
        </div>
        <button
          onClick={() => fetchSheet(true)}
          disabled={syncing}
          className="rounded-sm px-3 py-1.5 text-xs font-semibold tracking-widest uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: "#1a1a1a", color: "#c8a882", border: "1px solid #c8a882" }}
        >
          {syncing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {syncError && (
        <div
          className="mb-4 rounded-sm px-4 py-3 text-xs"
          style={{ backgroundColor: "rgba(201, 123, 99, 0.1)", color: "#c97b63", border: "1px solid #c97b63" }}
        >
          Unable to sync from Google Sheets — showing locally saved content only. ({syncError})
        </div>
      )}

      {/* Add form */}
      <section className="rounded-sm p-5" style={{ backgroundColor: "#111111" }}>
        <h2 className="mb-4 text-sm font-semibold tracking-widest uppercase" style={{ color: "#c8a882" }}>
          Add Article (Local)
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
              onChange={(e) => setStatus(e.target.value as ContentStatus)}
              className="rounded-sm px-3 py-2 text-sm"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
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
            placeholder="Brief / Notes"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={2}
            className="w-full rounded-sm px-3 py-2 text-sm"
            style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
          />
          {formError && <p className="text-xs" style={{ color: "#c97b63" }}>{formError}</p>}
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

      {/* Table */}
      <section className="mt-8">
        {!loaded || (syncing && merged.length === 0) ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 w-full rounded-sm" style={{ backgroundColor: "#111" }} />
            ))}
          </div>
        ) : monthKeys.length === 0 ? (
          <p className="py-12 text-center text-sm" style={{ color: "#666" }}>
            No articles yet. Add one above or sync from Google Sheets.
          </p>
        ) : (
          monthKeys.map((mk) => (
            <div key={mk} className="mb-8">
              <h3 className="text-lg font-bold tracking-wide" style={{ color: "#ffffff" }}>
                {formatMonth(mk)}
              </h3>
              <div className="mt-1 mb-3 h-[2px] w-full" style={{ backgroundColor: "#c8a882" }} />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "#1a1a1a" }}>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Title</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Type</th>
                      <th className="hidden px-3 py-2.5 text-xs font-semibold md:table-cell" style={{ color: "#f0ede8" }}>Writer</th>
                      <th className="hidden px-3 py-2.5 text-xs font-semibold md:table-cell" style={{ color: "#f0ede8" }}>Publish Date</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Doc</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Live</th>
                      <th className="hidden px-3 py-2.5 text-xs font-semibold md:table-cell" style={{ color: "#f0ede8" }}>Brief</th>
                      <th className="px-3 py-2.5 text-xs font-semibold" style={{ color: "#f0ede8" }}>Status</th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-right" style={{ color: "#f0ede8" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[mk].map((a, i) => {
                      const meta = CONTENT_STATUS_META[a.status];
                      const isSheet = a.source === "google_sheets";
                      const stripeColor = isSheet ? "#c8a882" : "#3b82f6";
                      return (
                        <tr
                          key={a.id}
                          style={{
                            backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a",
                            borderLeft: `3px solid ${stripeColor}`,
                          }}
                        >
                          <td className="px-3 py-2.5 align-top" style={{ color: "#f0ede8" }}>
                            <div className="flex items-center gap-2 font-medium">
                              <span title={isSheet ? "Synced from Google Sheet" : "Local entry"}>
                                {isSheet ? "☁" : "✎"}
                              </span>
                              <span>{a.title}</span>
                            </div>
                            {a.rawStatus && isSheet && (
                              <div className="text-[10px]" style={{ color: "#555" }}>
                                sheet: {a.rawStatus}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-top" style={{ color: "#888" }}>{a.type}</td>
                          <td className="hidden px-3 py-2.5 align-top md:table-cell" style={{ color: "#888" }}>
                            {a.writer || "—"}
                          </td>
                          <td className="hidden px-3 py-2.5 align-top md:table-cell" style={{ color: "#888" }}>
                            {formatDate(a.publishDate)}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <UrlCell
                              value={a.contentLink || ""}
                              placeholder="Add link"
                              readOnly={isSheet}
                              isDocs
                              onSave={(v) => updateLocal(a.id, { contentLink: v })}
                            />
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <UrlCell
                              value={a.liveUrl || ""}
                              placeholder="Add URL"
                              readOnly={isSheet}
                              onSave={(v) => updateLocal(a.id, { liveUrl: v })}
                            />
                          </td>
                          <td className="hidden px-3 py-2.5 align-top md:table-cell">
                            <BriefCell value={a.brief || ""} />
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            {isSheet ? (
                              <span
                                className="inline-block rounded-sm px-2 py-1 text-[11px] font-medium"
                                style={{
                                  backgroundColor: `${meta.color}26`,
                                  color: meta.color,
                                  border: `1px solid ${meta.color}66`,
                                }}
                              >
                                {meta.label}
                              </span>
                            ) : (
                              <select
                                value={a.status}
                                onChange={(e) => updateLocal(a.id, { status: e.target.value as ContentStatus })}
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
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right align-top">
                            {isSheet ? (
                              <span className="text-[10px]" style={{ color: "#555" }}>sheet</span>
                            ) : (
                              <button
                                onClick={() => removeLocal(a.id)}
                                className="text-xs underline"
                                style={{ color: "#666" }}
                              >
                                Remove
                              </button>
                            )}
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
