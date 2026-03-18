import { notFound } from "next/navigation";
import Link from "next/link";
import projects from "../../data/projects.json";
import { getDashboardData } from "../../lib/dashboard-data";
import ClientDashboardCharts from "../../components/ClientDashboardCharts";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientDashboard({ params }: PageProps) {
  const { id } = await params;
  const project = projects.find((p) => String(p.id) === id);

  if (!project) {
    notFound();
  }

  const data = getDashboardData(id, project.name);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header */}
        <header className="mb-2">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-2 text-sm transition-colors hover:text-[#C8A882]"
            style={{ color: "#888888" }}
          >
            &larr; All Clients
          </Link>
          <h1
            className="text-3xl font-bold tracking-wide uppercase"
            style={{ color: "#ffffff", letterSpacing: "0.05em" }}
          >
            {project.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm" style={{ color: "#c8a882" }}>
              {project.description}
            </span>
            {data && (
              <span className="text-xs" style={{ color: "#888888" }}>
                Reporting Period: {data.periodStart} &mdash; {data.periodEnd}
              </span>
            )}
          </div>
          {data && (
            <p className="mt-1 text-xs" style={{ color: "#888888" }}>
              Last refreshed: {data.lastRefreshed}
            </p>
          )}
          <div
            className="mt-4 h-[2px] w-full"
            style={{ backgroundColor: "#c8a882" }}
          />
        </header>

        {!data ? (
          /* No data state */
          <div
            className="mt-12 flex flex-col items-center justify-center rounded-sm py-24"
            style={{ backgroundColor: "#111111" }}
          >
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(200, 168, 130, 0.1)" }}
            >
              <span className="text-2xl" style={{ color: "#C8A882" }}>
                ?
              </span>
            </div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "#f0ede8" }}
            >
              No Data Available
            </h2>
            <p className="mt-2 text-sm" style={{ color: "#888888" }}>
              Run data sync to populate this client&apos;s dashboard.
            </p>
            <Link
              href="/"
              className="mt-6 rounded-sm px-6 py-2 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
            >
              Back to All Clients
            </Link>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
              <KpiCardServer
                value={data.completedCount}
                label="COMPLETED TASKS"
              />
              <KpiCardServer
                value={data.outstandingCount}
                label="OUTSTANDING TASKS"
              />
              <KpiCardServer
                value={`${data.completionRate}%`}
                label="COMPLETION RATE"
              />
              <KpiCardServer
                value={data.periodCompletedCount}
                label="COMPLETED THIS PERIOD"
                accent
              />
            </section>

            <p
              className="mt-3 text-center text-xs"
              style={{ color: "#888888" }}
            >
              All-time: {data.completedCount} completed &nbsp;|&nbsp;{" "}
              {data.outstandingCount} outstanding &nbsp;|&nbsp; {data.total}{" "}
              total tasks tracked
            </p>

            {/* Charts (client component) */}
            <ClientDashboardCharts
              completedCount={data.completedCount}
              outstandingCount={data.outstandingCount}
              completionRate={data.completionRate}
              categoryData={data.categoryData}
              commentData={data.commentData}
              timelineData={data.timelineData}
            />

            {/* Most Discussed Tasks Table */}
            <section className="mt-12">
              <SectionHeader title="MOST DISCUSSED TASKS" />
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "#1a1a1a" }}>
                      <Th>Task</Th>
                      <Th>Task List</Th>
                      <Th>Owner</Th>
                      <Th className="text-center">Status</Th>
                      <Th className="text-center">Due Date</Th>
                      <Th className="text-center">Comments</Th>
                      <Th className="text-center">Link</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCommented.map(
                      (
                        t: {
                          id: number;
                          title: string;
                          list_title: string;
                          assignees: string;
                          completed: boolean;
                          due_on: string | null;
                          comments_count: number;
                          app_url: string;
                        },
                        i: number
                      ) => (
                        <tr
                          key={t.id}
                          style={{
                            backgroundColor:
                              i % 2 === 0 ? "#111111" : "#1a1a1a",
                          }}
                        >
                          <Td
                            className="font-medium"
                            style={{ color: "#f0ede8" }}
                          >
                            {truncate(t.title, 55)}
                          </Td>
                          <Td dim>{truncate(t.list_title, 28)}</Td>
                          <Td dim>{t.assignees}</Td>
                          <Td className="text-center">
                            <StatusBadgeInline completed={t.completed} />
                          </Td>
                          <Td dim className="text-center">
                            {t.due_on || "\u2014"}
                          </Td>
                          <Td
                            className="text-center font-bold"
                            style={{ color: "#c8a882" }}
                          >
                            {t.comments_count}
                          </Td>
                          <Td className="text-center">
                            <a
                              href={t.app_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                              style={{ color: "#c8a882" }}
                            >
                              View
                            </a>
                          </Td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Highest Impact Tasks Table */}
            <section className="mt-12">
              <SectionHeader title="HIGHEST IMPACT TASKS" />
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "#1a1a1a" }}>
                      <Th>Task</Th>
                      <Th className="text-center">Impact</Th>
                      <Th>Why It Matters</Th>
                      <Th>Owner</Th>
                      <Th className="text-center">Status</Th>
                      <Th className="text-center">Due Date</Th>
                      <Th className="text-center">Link</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topImpact.map(
                      (
                        t: {
                          id: number;
                          title: string;
                          impact_score: number;
                          impact_rationale: string;
                          assignees: string;
                          completed: boolean;
                          due_on: string | null;
                          app_url: string;
                        },
                        i: number
                      ) => (
                        <tr
                          key={t.id}
                          style={{
                            backgroundColor:
                              i % 2 === 0 ? "#111111" : "#1a1a1a",
                          }}
                        >
                          <Td
                            className="font-medium"
                            style={{ color: "#f0ede8" }}
                          >
                            {truncate(t.title, 50)}
                          </Td>
                          <Td
                            className="text-center font-bold"
                            style={{ color: "#c8a882" }}
                          >
                            {t.impact_score}
                          </Td>
                          <Td dim>{t.impact_rationale}</Td>
                          <Td dim>{t.assignees}</Td>
                          <Td className="text-center">
                            <StatusBadgeInline completed={t.completed} />
                          </Td>
                          <Td dim className="text-center">
                            {t.due_on || "\u2014"}
                          </Td>
                          <Td className="text-center">
                            <a
                              href={t.app_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                              style={{ color: "#c8a882" }}
                            >
                              View
                            </a>
                          </Td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Footer */}
            <footer className="mt-12 pb-8">
              <div
                className="h-[1px] w-full"
                style={{ backgroundColor: "#1a1a1a" }}
              />
              <p
                className="mt-4 text-xs italic"
                style={{ color: "#888888" }}
              >
                Impact scores are calculated from task scope, comment activity,
                due-date urgency, and keyword relevance. Scores are transparent
                and editable.
              </p>
              <p
                className="mt-1 text-xs italic"
                style={{ color: "#888888" }}
              >
                Data source: Basecamp project &ldquo;{data.clientName}&rdquo;
                &mdash; {data.total} tasks tracked across {data.uniqueLists}{" "}
                task lists.
              </p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/* ── SERVER SUB-COMPONENTS ──────────────────────────────────────── */

function KpiCardServer({
  value,
  label,
  accent = false,
}: {
  value: number | string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-sm px-4 py-6"
      style={{ backgroundColor: "#111111" }}
    >
      <span
        className="text-4xl font-bold"
        style={{ color: accent ? "#c8a882" : "#ffffff" }}
      >
        {value}
      </span>
      <span
        className="mt-2 text-[10px] tracking-widest uppercase"
        style={{ color: "#888888" }}
      >
        {label}
      </span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <>
      <h2
        className="text-lg font-bold tracking-wide"
        style={{ color: "#ffffff" }}
      >
        {title}
      </h2>
      <div
        className="mt-1 h-[2px] w-full"
        style={{ backgroundColor: "#c8a882" }}
      />
    </>
  );
}

function StatusBadgeInline({ completed }: { completed: boolean }) {
  return (
    <span
      className="inline-block rounded-sm px-2 py-0.5 text-xs font-medium"
      style={{
        color: completed ? "#2d6a4f" : "#b08d57",
        backgroundColor: completed
          ? "rgba(45, 106, 79, 0.15)"
          : "rgba(176, 141, 87, 0.15)",
      }}
    >
      {completed ? "Done" : "Open"}
    </span>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2.5 text-xs font-semibold tracking-wide ${className}`}
      style={{ color: "#f0ede8" }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  dim = false,
  style = {},
}: {
  children: React.ReactNode;
  className?: string;
  dim?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <td
      className={`px-3 py-2.5 ${className}`}
      style={{ color: dim ? "#888888" : undefined, ...style }}
    >
      {children}
    </td>
  );
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}
