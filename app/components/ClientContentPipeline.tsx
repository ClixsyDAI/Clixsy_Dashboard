"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTENT_STATUS_META,
  ContentArticle,
  ContentStatus,
} from "../lib/content-types";

/**
 * Client-safe counterpart to ContentPipelineOverview.
 *
 * Reads ONLY the Google Sheet (no localStorage), and defaults to the current
 * month's bucket. Styling mirrors the internal pipeline block.
 */

type Scope = "this-month" | "last-3" | "all";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseMonth(ym: string): { y: number; m: number } | null {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { y, m };
}

function monthsBetween(
  a: { y: number; m: number },
  b: { y: number; m: number }
) {
  return (a.y - b.y) * 12 + (a.m - b.m);
}

function PencilIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function EyeIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function RocketIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}
function CheckCircleIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

const ICONS: Record<ContentStatus, (p: { color: string }) => React.ReactElement> = {
  "content-in-progress": PencilIcon,
  "content-for-review": EyeIcon,
  "queued-for-launch": RocketIcon,
  published: CheckCircleIcon,
};

const ORDER: ContentStatus[] = [
  "content-in-progress",
  "content-for-review",
  "queued-for-launch",
  "published",
];

export default function ClientContentPipeline({
  clientName,
}: {
  clientName: string;
}) {
  const [articles, setArticles] = useState<ContentArticle[]>([]);
  const [scope, setScope] = useState<Scope>("this-month");

  const load = useCallback(async () => {
    if (!clientName) return;
    try {
      const res = await fetch(
        `/api/content?client=${encodeURIComponent(clientName)}`
      );
      if (!res.ok) return;
      const json = await res.json();
      setArticles(json.articles || []);
    } catch {
      /* silent */
    }
  }, [clientName]);

  useEffect(() => {
    load();
  }, [load]);

  const now = new Date();
  const currentYm = { y: now.getFullYear(), m: now.getMonth() + 1 };

  const filtered = useMemo(() => {
    if (scope === "all") return articles;
    return articles.filter((a) => {
      const p = parseMonth(a.month);
      if (!p) return false;
      const diff = monthsBetween(currentYm, p);
      if (scope === "this-month") return diff === 0;
      if (scope === "last-3") return diff >= 0 && diff <= 2;
      return true;
    });
  }, [articles, scope, currentYm.y, currentYm.m]);

  const counts = useMemo(() => {
    const c: Record<ContentStatus, number> = {
      "content-in-progress": 0,
      "content-for-review": 0,
      "queued-for-launch": 0,
      published: 0,
    };
    for (const a of filtered) {
      if (a && a.status in c) c[a.status as ContentStatus]++;
    }
    return c;
  }, [filtered]);

  const total = filtered.length;

  const scopeLabel =
    scope === "this-month"
      ? `${MONTH_NAMES[currentYm.m - 1]} ${currentYm.y}`
      : scope === "last-3"
        ? "Last 3 Months"
        : "All Time";

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-wide" style={{ color: "#ffffff" }}>
            CONTENT PIPELINE
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: "#888" }}>
            {scopeLabel}
          </p>
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="rounded-sm px-3 py-1.5 text-xs"
          style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #222" }}
        >
          <option value="this-month">This Month</option>
          <option value="last-3">Last 3 Months</option>
          <option value="all">All Time</option>
        </select>
      </div>
      <div className="mt-1 h-[2px] w-full" style={{ backgroundColor: "#c8a882" }} />

      {total === 0 ? (
        <div
          className="mt-4 flex flex-col items-center justify-center rounded-sm py-10"
          style={{ backgroundColor: "#111111" }}
        >
          <p className="text-sm" style={{ color: "#888" }}>
            No content scheduled for this period
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {ORDER.map((status) => {
              const meta = CONTENT_STATUS_META[status];
              const Icon = ICONS[status];
              return (
                <div
                  key={status}
                  className="flex flex-col items-center justify-center rounded-sm px-4 py-6"
                  style={{
                    backgroundColor: "#111111",
                    borderBottom: `2px solid ${meta.color}`,
                  }}
                >
                  <div className="mb-2">
                    <Icon color={meta.color} />
                  </div>
                  <span className="text-4xl font-bold" style={{ color: "#ffffff" }}>
                    {counts[status]}
                  </span>
                  <span
                    className="mt-2 text-[10px] tracking-widest uppercase"
                    style={{ color: "#888" }}
                  >
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="mt-4 flex h-2 w-full overflow-hidden rounded-sm"
            style={{ backgroundColor: "#1a1a1a" }}
            aria-label="Pipeline distribution"
          >
            {ORDER.map((status) => {
              const pct = (counts[status] / total) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={status}
                  style={{
                    width: `${pct}%`,
                    backgroundColor: CONTENT_STATUS_META[status].color,
                  }}
                  title={`${CONTENT_STATUS_META[status].label}: ${counts[status]}`}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
