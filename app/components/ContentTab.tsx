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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setArticles(JSON.parse(raw));
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
    const newArticle: Article = {
      id: crypto.randomUUID(),
      month,
      title: title.trim(),
      type: type.trim() || "Blog Post",
      status,
    };
    setArticles((prev) => [newArticle, ...prev]);
    setTitle("");
    setStatus("content-in-progress");
  }

  function updateStatus(id: string, newStatus: Status) {
    setArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
    );
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
        <form
          onSubmit={addArticle}
          className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_200px_220px_auto]"
        >
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
          <button
            type="submit"
            className="rounded-sm px-5 py-2 text-xs font-semibold tracking-widest uppercase transition-opacity hover:opacity-80"
            style={{ backgroundColor: "#c8a882", color: "#0a0a0a" }}
          >
            Add
          </button>
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
                          <td className="px-3 py-2.5 font-medium" style={{ color: "#f0ede8" }}>
                            {a.title}
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#888" }}>
                            {a.type}
                          </td>
                          <td className="px-3 py-2.5">
                            <select
                              value={a.status}
                              onChange={(e) => updateStatus(a.id, e.target.value as Status)}
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
                          <td className="px-3 py-2.5 text-right">
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
