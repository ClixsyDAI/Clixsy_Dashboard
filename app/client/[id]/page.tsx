import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import projects from "../../data/projects.json";
import { getDashboardData, loadClientTodos } from "../../lib/dashboard-data";
import { loadGscData, loadGa4Data } from "../../lib/google-data";
import ClientDashboardCharts from "../../components/ClientDashboardCharts";
import GoogleSearchCharts from "../../components/GoogleSearchCharts";
import DashboardTabs from "../../components/DashboardTabs";
import AISummaryTab from "../../components/AISummaryTab";
import AskQuestionTab from "../../components/AskQuestionTab";
import ContentTab from "../../components/ContentTab";
import ContentPipelineOverview from "../../components/ContentPipelineOverview";
import ProjectLogTable from "../../components/ProjectLogTable";
import BrightLocalPanel from "../../components/BrightLocalPanel";
import { getBrightLocalSummary } from "../../lib/brightlocal-data";
import OverviewTopWins from "../../components/OverviewTopWins";
import Last10TasksTable from "../../components/Last10TasksTable";
import ShareClientUrlButton from "../../components/ShareClientUrlButton";
import HealthBadge from "../../components/HealthBadge";
import { detectWins } from "../../lib/win-flag-detection";
import { loadTaskSummaries } from "../../lib/task-summaries";
import { generateShareToken } from "../../lib/share-token";
import { getClientHealthSummary } from "../../lib/client-health-summary";

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
  const gscData = loadGscData(id);
  const ga4Data = loadGa4Data(id);
  const todos = loadClientTodos(id);
  const blData = getBrightLocalSummary(id);
  const taskSummariesCache = loadTaskSummaries(id);
  const healthSummary = await getClientHealthSummary(id);

  // Build an absolute client-safe share URL. If SHARE_SECRET isn't set, we
  // skip the button rather than crash the whole page.
  let shareUrl: string | null = null;
  try {
    const token = generateShareToken(id);
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host") || "";
    const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    shareUrl = host ? `${proto}://${host}/share/${token}` : `/share/${token}`;
  } catch (err) {
    console.warn("[client dashboard] share URL unavailable:", err);
  }

  // ── Compute TOP WINS for the Overview tab (server-side) ──────
  // Use a simple last-30-days vs prior-30-days comparison so the wins panel
  // matches the rest of the Overview's reporting period.
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prevCutoff = new Date(cutoff.getTime() - 30 * 24 * 60 * 60 * 1000);

  function sumGsc(daily: typeof gscData extends infer T ? T extends { dailyData: infer D } ? D : never : never, from: Date, to: Date) {
    if (!Array.isArray(daily)) return { clicks: 0, impressions: 0, position: 0, ctr: 0 };
    const rows = daily.filter((r) => {
      const d = new Date(r.date);
      return d >= from && d <= to;
    });
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const position = rows.length > 0 ? rows.reduce((s, r) => s + r.position, 0) / rows.length : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    return { clicks, impressions, position, ctr };
  }
  function sumGa4(daily: typeof ga4Data extends infer T ? T extends { dailyData: infer D } ? D : never : never, from: Date, to: Date) {
    if (!Array.isArray(daily)) return { sessions: 0 };
    const rows = daily.filter((r) => {
      const d = new Date(r.date);
      return d >= from && d <= to;
    });
    return { sessions: rows.reduce((s, r) => s + r.sessions, 0) };
  }
  const gscCurr = gscData ? sumGsc(gscData.dailyData, cutoff, now) : null;
  const gscPrev = gscData ? sumGsc(gscData.dailyData, prevCutoff, cutoff) : null;
  const ga4Curr = ga4Data ? sumGa4(ga4Data.dailyData, cutoff, now) : null;
  const ga4Prev = ga4Data ? sumGa4(ga4Data.dailyData, prevCutoff, cutoff) : null;
  const completedThisPeriod = (todos || []).filter(
    (t) => t.completed && t.completed_on && new Date(t.completed_on) >= cutoff
  ).length;
  const dueThisPeriod = (todos || []).filter(
    (t) => t.due_on && new Date(t.due_on) >= cutoff && new Date(t.due_on) <= now
  ).length;
  const overdue = (todos || [])
    .filter((t) => !t.completed && t.due_on && new Date(t.due_on) < now)
    .map((t) => ({ title: t.title, due_on: t.due_on }));
  const overviewWins = detectWins({
    tasksCompletedInPeriod: completedThisPeriod,
    tasksDueInPeriod: dueThisPeriod,
    overdueTasks: overdue,
    completionRate:
      dueThisPeriod > 0
        ? completedThisPeriod / dueThisPeriod
        : completedThisPeriod > 0
          ? 0.9
          : 0,
    gscClicksCurrent: gscCurr ? gscCurr.clicks : null,
    gscClicksPrevious: gscPrev ? gscPrev.clicks : null,
    gscAvgPositionCurrent: gscCurr && gscCurr.position > 0 ? gscCurr.position : null,
    gscAvgPositionPrevious: gscPrev && gscPrev.position > 0 ? gscPrev.position : null,
    gscCtrCurrent: gscCurr ? gscCurr.ctr : null,
    gscCtrPrevious: gscPrev ? gscPrev.ctr : null,
    ga4SessionsCurrent: ga4Curr ? ga4Curr.sessions : null,
    ga4SessionsPrevious: ga4Prev ? ga4Prev.sessions : null,
    ga4OrganicCurrent: ga4Data ? ga4Data.totals.organicSessions : null,
    ga4OrganicPrevious: ga4Prev ? ga4Prev.sessions : null,
    blRankingsUp: blData?.totalRankingsUp ?? null,
    blRankingsDown: blData?.totalRankingsDown ?? null,
    blAvgGoogleRank: blData?.avgGoogleRank ?? null,
    blReviewRating: blData?.reviewRating ?? null,
    blTotalReviews: blData?.totalReviews ?? null,
    blCitations: blData?.totalCitations ?? null,
    blGmbCalls: blData?.totalGmbCalls ?? null,
  });

  const tabs = [
    { id: "overview", label: "Overview" },
    ...(gscData || ga4Data ? [{ id: "search", label: "Search Performance" }] : []),
    ...(blData ? [{ id: "local-seo", label: "Local SEO" }] : []),
    { id: "ask-question", label: "Ask a Question" },
    { id: "content", label: "Content" },
    {
      id: "internal",
      label: "Internal Use",
      children: [
        { id: "report", label: "Report" },
        { id: "project-log", label: "Project Log" },
      ],
    },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header */}
        <header className="mb-2">
          <div className="mb-4 flex items-start justify-between gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm transition-colors hover:opacity-80"
            >
              <img
                src="https://res.cloudinary.com/dovgh19xr/image/upload/v1766427227/new_logo_nvrux0.svg"
                alt="CLIXSY"
                className="h-7 w-auto"
              />
              <span style={{ color: "#888888" }}>&larr; All Clients</span>
            </Link>
            {shareUrl && <ShareClientUrlButton shareUrl={shareUrl} />}
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1
                className="text-3xl font-bold tracking-wide uppercase"
                style={{ color: "#ffffff", letterSpacing: "0.05em" }}
              >
                {project.name}
              </h1>
            </div>
            {healthSummary?.health && (
              <HealthBadge
                health={healthSummary.health}
                missingSources={healthSummary.missingSources}
              />
            )}
          </div>
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
          <DashboardTabs tabs={tabs}>
            {/* ── TAB: OVERVIEW ──────────────────────────────── */}
            <div>
              {/* KPI Cards */}
              <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
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

              {/* Content Pipeline snapshot */}
              <ContentPipelineOverview projectId={id} clientName={project.name} />

              {/* Charts: Row 1 = TOP WINS + (Donut + Gauge half-width) ;
                  Row inserted after = Last 10 Tasks Worked On ;
                  Row 2 = Tasks by Category ; Row 3 = Comments + Timeline */}
              <ClientDashboardCharts
                completedCount={data.completedCount}
                outstandingCount={data.outstandingCount}
                completionRate={data.completionRate}
                categoryData={data.categoryData}
                commentData={data.commentData}
                timelineData={data.timelineData}
                topWinsSlot={<OverviewTopWins wins={overviewWins} />}
                afterRow1={
                  data.last10Updated && data.last10Updated.length > 0 ? (
                    <Last10TasksTable
                      projectId={id}
                      tasks={data.last10Updated}
                      initialSummaries={taskSummariesCache}
                    />
                  ) : null
                }
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
            </div>

            {/* ── TAB: SEARCH PERFORMANCE (conditional) ─────── */}
            {(gscData || ga4Data) && (
              <div>
                <GoogleSearchCharts
                  gscProperty={gscData?.property || null}
                  projectName={project.name}
                  gscDaily={gscData?.dailyData || null}
                  gscTopQueries={gscData?.topQueries || null}
                  gscYoyTopQueries={gscData?.yoyTopQueries || null}
                  gscYoyDateRange={gscData?.yoyDateRange || null}
                  gscDateRange={gscData?.dateRange || null}
                  gscTopPages={gscData?.topPages || null}
                  gscTotals={gscData?.totals || null}
                  ga4Daily={ga4Data?.dailyData || null}
                  ga4KeyEventsByChannel={ga4Data?.keyEventsByChannel || null}
                  ga4Totals={ga4Data?.totals || null}
                />
              </div>
            )}

            {/* ── TAB: LOCAL SEO / BRIGHTLOCAL (conditional) ── */}
            {blData && (
              <div>
                <BrightLocalPanel {...blData} />
              </div>
            )}

            {/* ── TAB: ASK A QUESTION (chatbot) ─────────────── */}
            <div>
              <AskQuestionTab projectId={id} projectName={project.name} />
            </div>

            {/* ── TAB: CONTENT ──────────────────────────────── */}
            <div>
              <ContentTab projectId={id} clientName={project.name} />
            </div>

            {/* ── TAB: INTERNAL USE → REPORT (AI) ───────────── */}
            <div>
              <AISummaryTab
                projectId={id}
                projectName={project.name}
                projectDescription={project.description}
                todos={todos || []}
                gscDaily={gscData?.dailyData || null}
                gscTopQueries={gscData?.topQueries || null}
                ga4Daily={ga4Data?.dailyData || null}
                ga4Channels={ga4Data?.channelData || null}
                ga4OrganicSessions={ga4Data?.totals?.organicSessions ?? null}
                blLocations={blData?.locationCount ?? null}
                blRankingsUp={blData?.totalRankingsUp ?? null}
                blRankingsDown={blData?.totalRankingsDown ?? null}
                blAvgGoogleRank={blData?.avgGoogleRank ?? null}
                blCitations={blData?.totalCitations ?? null}
                blReviewRating={blData?.reviewRating ?? null}
                blTotalReviews={blData?.totalReviews ?? null}
                blGmbCalls={blData?.totalGmbCalls ?? null}
              />
            </div>

            {/* ── TAB: INTERNAL USE → PROJECT LOG ───────────── */}
            <div>
              {todos && todos.length > 0 ? (
                <ProjectLogTable todos={todos} />
              ) : (
                <p className="py-12 text-center text-sm" style={{ color: "#666" }}>
                  No task data synced yet.
                </p>
              )}
            </div>
          </DashboardTabs>
        )}

        {/* Footer */}
        {data && (
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
            {(gscData || ga4Data) && (
              <p
                className="mt-1 text-xs italic"
                style={{ color: "#888888" }}
              >
                Search data:{" "}
                {gscData && <>GSC ({gscData.dateRange.start} to {gscData.dateRange.end})</>}
                {gscData && ga4Data && " | "}
                {ga4Data && <>GA4 ({ga4Data.dateRange.start} to {ga4Data.dateRange.end})</>}
              </p>
            )}
          </footer>
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
