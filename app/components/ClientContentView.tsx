"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTENT_STATUS_META,
  ContentArticle,
  ContentStatus,
} from "../lib/content-types";

/**
 * Client-safe content view.
 *
 * - Shows only Published + Queued for Launch articles (no in-progress drafts).
 * - Read-only — no add form, no inline editing, no localStorage.
 * - Data source is the Google Sheet via /api/content, scoped by client name.
 * - No "sheet status" debug captions, no remove/edit controls.
 */

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
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const VISIBLE_STATUSES: ContentStatus[] = ["published", "queued-for-launch"];

export default function ClientContentView({
  clientName,
}: {
  clientName: string;
}) {
  const [articles, setArticles] = useState<ContentArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content?client=${encodeURIComponent(clientName)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setArticles(json.articles || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [clientName]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => articles.filter((a) => VISIBLE_STATUSES.includes(a.status)),
    [articles]
  );

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, ContentArticle[]>>((acc, a) => {
      (acc[a.month] ??= []).push(a);
      return acc;
    }, {});
  }, [filtered]);

  const monthKeys = Object.keys(grouped).sort().reverse();

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 w-full rounded-sm"
            style={{ backgroundColor: "#111" }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-sm px-4 py-3 text-xs"
        style={{
          backgroundColor: "rgba(201, 123, 99, 0.1)",
          color: "#c97b63",
          border: "1px solid #c97b63",
        }}
      >
        Unable to load content at this time.
      </div>
    );
  }

  if (monthKeys.length === 0) {
    return (
      <p className="py-12 text-center text-sm" style={{ color: "#666" }}>
        No published or upcoming content yet.
      </p>
    );
  }

  return (
    <div>
      {monthKeys.map((mk) => (
        <div key={mk} className="mb-8">
          <h3 className="text-lg font-bold tracking-wide" style={{ color: "#ffffff" }}>
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
                  <th
                    className="px-3 py-2.5 text-xs font-semibold"
                    style={{ color: "#f0ede8" }}
                  >
                    Title
                  </th>
                  <th
                    className="px-3 py-2.5 text-xs font-semibold"
                    style={{ color: "#f0ede8" }}
                  >
                    Type
                  </th>
                  <th
                    className="hidden px-3 py-2.5 text-xs font-semibold md:table-cell"
                    style={{ color: "#f0ede8" }}
                  >
                    Publish Date
                  </th>
                  <th
                    className="px-3 py-2.5 text-xs font-semibold"
                    style={{ color: "#f0ede8" }}
                  >
                    View
                  </th>
                  <th
                    className="px-3 py-2.5 text-xs font-semibold"
                    style={{ color: "#f0ede8" }}
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {grouped[mk].map((a, i) => {
                  const meta = CONTENT_STATUS_META[a.status];
                  return (
                    <tr
                      key={a.id}
                      style={{
                        backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a",
                      }}
                    >
                      <td
                        className="px-3 py-2.5 align-top font-medium"
                        style={{ color: "#f0ede8" }}
                      >
                        {a.title}
                      </td>
                      <td
                        className="px-3 py-2.5 align-top"
                        style={{ color: "#888" }}
                      >
                        {a.type}
                      </td>
                      <td
                        className="hidden px-3 py-2.5 align-top md:table-cell"
                        style={{ color: "#888" }}
                      >
                        {formatDate(a.publishDate)}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {a.liveUrl ? (
                          <a
                            href={a.liveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs hover:underline"
                            style={{ color: "#c8a882" }}
                          >
                            <span aria-hidden>🔗</span>
                            <span>Read</span>
                          </a>
                        ) : (
                          <span className="text-xs" style={{ color: "#555" }}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
