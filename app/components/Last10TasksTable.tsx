"use client";

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
  tasks,
  initialSummaries,
}: Last10TasksTableProps) {
  // PR #31 deleted /api/task-summaries/[projectId]; the live-refresh fetch
  // that used to live here was an orphan caller. The Overview tab that
  // hosts this component is itself gated on task data (currently always
  // null post-cutover), so this code path is unreachable today. The
  // component still ships the server-seeded `initialSummaries` snapshot
  // for whenever the ClickUp ingest brings task data back; live refresh
  // will be reintroduced against the new ingest endpoint at that time.
  const summaries = initialSummaries;

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold tracking-wide" style={{ color: "#ffffff" }}>
          LAST 10 TASKS WORKED ON
        </h2>
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
