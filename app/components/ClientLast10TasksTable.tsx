"use client";

export interface ClientLast10Task {
  id: number;
  title: string;
  description: string;
  list_title: string;
  completed: boolean;
  updated_at: string;
}

interface CachedSummary {
  id: number;
  title: string;
  whyItMatters: string;
  updatedAt: string;
}

interface Props {
  projectId: string;
  tasks: ClientLast10Task[];
  /** Server-loaded cache snapshot to seed the UI before any client fetch. */
  initialSummaries: Record<string, CachedSummary>;
}

/**
 * Client-safe variant of Last10TasksTable.
 *
 * Identical to the internal version except it DOES NOT expose the Basecamp
 * `app_url` column — the client never sees a direct Basecamp link.
 */
export default function ClientLast10TasksTable({
  tasks,
  initialSummaries,
}: Props) {
  // Live-refresh fetch removed: /api/task-summaries/[projectId] was deleted
  // in PR #31. The share page that hosts this component still renders the
  // server-seeded snapshot; the live update path will be reintroduced when
  // the ClickUp ingest replaces the Basecamp pipeline.
  const summaries = initialSummaries;

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold tracking-wide" style={{ color: "#ffffff" }}>
          RECENT WORK
        </h2>
      </div>
      <div className="mt-1 h-[2px] w-full" style={{ backgroundColor: "#c8a882" }} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: "#1a1a1a" }}>
              <th className="px-3 py-2.5 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                Task
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
              const displayTitle = summary?.title || t.title;
              return (
                <tr
                  key={t.id}
                  style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}
                >
                  <td className="px-3 py-2.5 font-medium" style={{ color: "#f0ede8", maxWidth: 320 }}>
                    {displayTitle}
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
                      {t.completed ? "Done" : "In Progress"}
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
