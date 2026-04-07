"use client";

import { useEffect, useState } from "react";

export interface Last10Task {
  id: number;
  title: string;
  description: string;
  list_title: string;
  completed: boolean;
  updated_at: string;
  app_url: string;
}

interface CachedSummary {
  id: number;
  title: string;
  whyItMatters: string;
  updatedAt: string;
}

interface Last10TasksTableProps {
  projectId: string;
  tasks: Last10Task[];
  /** Server-loaded cache snapshot to seed the UI before any client fetch. */
  initialSummaries: Record<string, CachedSummary>;
}

export default function Last10TasksTable({
  projectId,
  tasks,
  initialSummaries,
}: Last10TasksTableProps) {
  const [summaries, setSummaries] = useState<Record<string, CachedSummary>>(
    initialSummaries
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Determine which tasks need fresh AI summaries
    const stale = tasks.filter((t) => {
      const cached = summaries[String(t.id)];
      return !cached || cached.updatedAt !== t.updated_at;
    });

    if (stale.length === 0) return;

    let cancelled = false;
    setLoading(true);

    fetch(`/api/task-summaries/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          list_title: t.list_title,
          updated_at: t.updated_at,
        })),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.summaries) {
          setSummaries((prev) => ({ ...prev, ...data.summaries }));
        }
      })
      .catch((e) => {
        if (!cancelled) console.error("Task summaries fetch failed:", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // We intentionally exclude `summaries` from deps — we only want to trigger
    // on the task list itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tasks]);

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold tracking-wide" style={{ color: "#ffffff" }}>
          LAST 10 TASKS WORKED ON
        </h2>
        {loading && (
          <span className="text-[11px]" style={{ color: "#888" }}>
            Generating summaries…
          </span>
        )}
      </div>
      <div className="mt-1 h-[2px] w-full" style={{ backgroundColor: "#c8a882" }} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: "#1a1a1a" }}>
              <th className="px-3 py-2.5 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                Task in Basecamp
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                Task Title
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                Why It Matters
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => {
              const summary = summaries[String(t.id)];
              return (
                <tr
                  key={t.id}
                  style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}
                >
                  <td className="px-3 py-2.5" style={{ maxWidth: 220 }}>
                    <a
                      href={t.app_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: "#c8a882" }}
                      title={t.title}
                    >
                      {truncate(t.title, 55)}
                    </a>
                  </td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: "#f0ede8" }}>
                    {summary?.title || (
                      <span style={{ color: "#666" }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "#888" }}>
                    {summary?.whyItMatters || (
                      <span style={{ color: "#666" }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className="inline-block rounded-sm px-2 py-0.5 text-xs font-medium"
                      style={{
                        color: t.completed ? "#2d6a4f" : "#b08d57",
                        backgroundColor: t.completed
                          ? "rgba(45, 106, 79, 0.15)"
                          : "rgba(176, 141, 87, 0.15)",
                      }}
                    >
                      {t.completed ? "Done" : "Open"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
