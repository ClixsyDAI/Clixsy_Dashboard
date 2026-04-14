import { notFound } from "next/navigation";
import projects from "../../data/projects.json";
import {
  getDashboardData,
  loadClientVisibleTodos,
} from "../../lib/dashboard-data";
import { loadGscData, loadGa4Data } from "../../lib/google-data";
import { getBrightLocalSummary } from "../../lib/brightlocal-data";
import { loadTaskSummaries } from "../../lib/task-summaries";
import { detectWins } from "../../lib/win-flag-detection";
import { verifyShareToken } from "../../lib/share-token";

import DashboardTabs from "../../components/DashboardTabs";
import GoogleSearchCharts from "../../components/GoogleSearchCharts";
import BrightLocalPanel from "../../components/BrightLocalPanel";
import CompletionDonut from "../../components/CompletionDonut";
import CompletionGauge from "../../components/CompletionGauge";
import CompletionTimeline from "../../components/CompletionTimeline";
import TasksByCategory from "../../components/TasksByCategory";
import OverviewTopWins from "../../components/OverviewTopWins";
import ClientLast10TasksTable from "../../components/ClientLast10TasksTable";
import ClientContentView from "../../components/ClientContentView";
import ClientContentPipeline from "../../components/ClientContentPipeline";
import { normalizeClientName } from "../../lib/content-types";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ClientSharePage({ params }: PageProps) {
  const { token } = await params;

  let projectId: string | null = null;
  try {
    projectId = verifyShareToken(token);
  } catch (err) {
    console.error("[share] token verification failed:", err);
    notFound();
  }

  if (!projectId) {
    notFound();
  }

  const project = projects.find((p) => String(p.id) === projectId);
  if (!project) {
    notFound();
  }

  // Load everything, but filter todos to the visible_to_clients set.
  const data = getDashboardData(projectId, project.name, {
    clientVisibleOnly: true,
  });
  const gscData = loadGscData(projectId);
  const ga4Data = loadGa4Data(projectId);
  const visibleTodos = loadClientVisibleTodos(projectId);
  const blData = getBrightLocalSummary(projectId);
  const taskSummariesCache = loadTaskSummaries(projectId);

  // ── Top Wins (same 30d vs prior-30d comparison as the internal dashboard) ──
  // Anchor the rolling window to the latest available data date, not wall-
  // clock "now". GSC typically lags 2-4 days and GA4 can lag 1-3 days, so
  // using today as the endpoint would compare a short (partial) current
  // window against a full prior window and make every client look like
  // they're declining.
  const latestGscDate =
    gscData?.dailyData?.length
      ? new Date(gscData.dailyData[gscData.dailyData.length - 1].date)
      : null;
  const latestGa4Date =
    ga4Data?.dailyData?.length
      ? new Date(ga4Data.dailyData[ga4Data.dailyData.length - 1].date)
      : null;
  const nowWall = new Date();
  const gscNow = latestGscDate || nowWall;
  const ga4Now = latestGa4Date || nowWall;
  const gscCutoff = new Date(gscNow.getTime() - 30 * 24 * 60 * 60 * 1000);
  const gscPrevCutoff = new Date(gscCutoff.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ga4Cutoff = new Date(ga4Now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ga4PrevCutoff = new Date(ga4Cutoff.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Task windows still use wall-clock "now" — Basecamp data is live.
  const cutoff = new Date(nowWall.getTime() - 30 * 24 * 60 * 60 * 1000);

  function sumGsc(
    daily: typeof gscData extends infer T ? (T extends { dailyData: infer D } ? D : never) : never,
    from: Date,
    to: Date
  ) {
    if (!Array.isArray(daily)) return { clicks: 0, impressions: 0, position: 0, ctr: 0 };
    const rows = daily.filter((r) => {
      const d = new Date(r.date);
      return d >= from && d <= to;
    });
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const position =
      rows.length > 0 ? rows.reduce((s, r) => s + r.position, 0) / rows.length : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    return { clicks, impressions, position, ctr };
  }
  function sumGa4(
    daily: typeof ga4Data extends infer T ? (T extends { dailyData: infer D } ? D : never) : never,
    from: Date,
    to: Date
  ) {
    if (!Array.isArray(daily)) return { sessions: 0 };
    const rows = daily.filter((r) => {
      const d = new Date(r.date);
      return d >= from && d <= to;
    });
    return { sessions: rows.reduce((s, r) => s + r.sessions, 0) };
  }
  const gscCurr = gscData ? sumGsc(gscData.dailyData, gscCutoff, gscNow) : null;
  const gscPrev = gscData ? sumGsc(gscData.dailyData, gscPrevCutoff, gscCutoff) : null;
  const ga4Curr = ga4Data ? sumGa4(ga4Data.dailyData, ga4Cutoff, ga4Now) : null;
  const ga4Prev = ga4Data ? sumGa4(ga4Data.dailyData, ga4PrevCutoff, ga4Cutoff) : null;
  const completedThisPeriod = (visibleTodos || []).filter(
    (t) => t.completed && t.completed_on && new Date(t.completed_on) >= cutoff
  ).length;
  const dueThisPeriod = (visibleTodos || []).filter(
    (t) => t.due_on && new Date(t.due_on) >= cutoff && new Date(t.due_on) <= nowWall
  ).length;
  const overdue = (visibleTodos || [])
    .filter((t) => !t.completed && t.due_on && new Date(t.due_on) < nowWall)
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
    // Organic trend is intentionally left null: the GA4 pipeline only
    // fetches a single aggregate organicSessions total, not daily organic,
    // so a matched 30d-vs-prior-30d organic comparison isn't possible.
    ga4OrganicCurrent: null,
    ga4OrganicPrevious: null,
    blRankingsUp: blData?.totalRankingsUp ?? null,
    blRankingsDown: blData?.totalRankingsDown ?? null,
    blAvgGoogleRank: blData?.avgGoogleRank ?? null,
    blReviewRating: blData?.reviewRating ?? null,
    blTotalReviews: blData?.totalReviews ?? null,
    blCitations: blData?.totalCitations ?? null,
    blGmbCalls: blData?.totalGmbCalls ?? null,
  });

  // Strip the "J### " prefix so the client sees their own name, not our internal code.
  const displayName = normalizeClientName(project.name);

  const tabs = [
    { id: "overview", label: "Overview" },
    ...(gscData || ga4Data ? [{ id: "search", label: "Search Performance" }] : []),
    ...(blData ? [{ id: "local-seo", label: "Local SEO" }] : []),
    { id: "content", label: "Content" },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header (no "All Clients" back link — client only sees their own page) */}
        <header className="mb-2">
          <div className="mb-4 inline-flex items-center gap-3">
            <img
              src="https://res.cloudinary.com/dovgh19xr/image/upload/v1766427227/new_logo_nvrux0.svg"
              alt="CLIXSY"
              className="h-7 w-auto"
            />
            <span
              className="text-[10px] tracking-widest uppercase"
              style={{ color: "#888888" }}
            >
              Client Report
            </span>
          </div>
          <h1
            className="text-3xl font-bold tracking-wide uppercase"
            style={{ color: "#ffffff", letterSpacing: "0.05em" }}
          >
            {displayName}
          </h1>
          {data && (
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm" style={{ color: "#c8a882" }}>
                Progress &amp; Performance Summary
              </span>
              <span className="text-xs" style={{ color: "#888888" }}>
                Reporting Period: {data.periodStart} &mdash; {data.periodEnd}
              </span>
            </div>
          )}
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
            <h2 className="text-lg font-semibold" style={{ color: "#f0ede8" }}>
              Report not ready yet
            </h2>
            <p className="mt-2 text-sm" style={{ color: "#888888" }}>
              Your dashboard is still being prepared. Please check back soon.
            </p>
          </div>
        ) : (
          <DashboardTabs tabs={tabs}>
            {/* ── OVERVIEW ─────────────────────────────────────── */}
            <div>
              {/* KPIs: Completed, This Period, Completion Rate.
                  Outstanding is deliberately hidden for the client view. */}
              <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <KpiCardServer
                  value={data.completedCount}
                  label="COMPLETED TASKS"
                />
                <KpiCardServer
                  value={data.periodCompletedCount}
                  label="COMPLETED THIS PERIOD"
                  accent
                />
                <KpiCardServer
                  value={`${data.completionRate}%`}
                  label="COMPLETION RATE"
                />
              </section>

              <p
                className="mt-3 text-center text-xs"
                style={{ color: "#888888" }}
              >
                {data.completedCount} tasks completed to date across{" "}
                {data.uniqueLists} areas of work
              </p>

              {/* Content pipeline snapshot */}
              <ClientContentPipeline clientName={project.name} />

              {/* Row 1: Top Wins + Donut + Gauge */}
              <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
                <OverviewTopWins wins={overviewWins} />
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <CompletionDonut
                    completed={data.completedCount}
                    outstanding={data.outstandingCount}
                  />
                  <CompletionGauge rate={data.completionRate} />
                </div>
              </div>

              {/* Recent Work (client-safe — no Basecamp links) */}
              {data.last10Updated && data.last10Updated.length > 0 && (
                <ClientLast10TasksTable
                  projectId={projectId}
                  tasks={data.last10Updated.map((t) => ({
                    id: t.id,
                    title: t.title,
                    description: t.description,
                    list_title: t.list_title,
                    completed: t.completed,
                    updated_at: t.updated_at,
                  }))}
                  initialSummaries={taskSummariesCache}
                />
              )}

              {/* Tasks by category */}
              <div className="mt-8">
                <TasksByCategory data={data.categoryData} />
              </div>

              {/* Completion timeline */}
              <div className="mt-8">
                <CompletionTimeline data={data.timelineData} />
              </div>
            </div>

            {/* ── SEARCH PERFORMANCE ──────────────────────────── */}
            {(gscData || ga4Data) && (
              <div>
                <GoogleSearchCharts
                  gscProperty={gscData?.property || null}
                  projectName={displayName}
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

            {/* ── LOCAL SEO ───────────────────────────────────── */}
            {blData && (
              <div>
                <BrightLocalPanel {...blData} />
              </div>
            )}

            {/* ── CONTENT (Published + Queued only) ───────────── */}
            <div>
              <ClientContentView clientName={project.name} />
            </div>
          </DashboardTabs>
        )}

        {data && (
          <footer className="mt-12 pb-8">
            <div
              className="h-[1px] w-full"
              style={{ backgroundColor: "#1a1a1a" }}
            />
            <p className="mt-4 text-xs italic" style={{ color: "#888888" }}>
              This report summarises the SEO, content and local-search work
              Clixsy has been performing on your behalf.
            </p>
          </footer>
        )}
      </div>
    </div>
  );
}

/* ── SUB-COMPONENTS ───────────────────────────────────────────── */

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
