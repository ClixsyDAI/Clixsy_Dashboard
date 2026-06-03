import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import projects from "../../data/projects.json";
import { formatClientDisplayName } from "../../lib/projects";
import { getDashboardData, loadClientTodos } from "../../lib/dashboard-data";
import { loadGscData, loadGa4Data } from "../../lib/google-data";
import GoogleSearchCharts from "../../components/GoogleSearchCharts";
import DashboardTabs from "../../components/DashboardTabs";
import AskQuestionTab from "../../components/AskQuestionTab";
import ContentTab from "../../components/ContentTab";
import ContentPipelineOverview from "../../components/ContentPipelineOverview";
import BrightLocalPanel from "../../components/BrightLocalPanel";
import { getBrightLocalSummary } from "../../lib/brightlocal-data";
import ShareClientUrlButton from "../../components/ShareClientUrlButton";
import MeetingPrepButton from "../../components/MeetingPrepButton";
import HealthBadge from "../../components/HealthBadge";
import TeamBadges from "../../components/TeamBadges";
import { detectWins } from "../../lib/win-flag-detection";
import { loadTaskSummaries } from "../../lib/task-summaries";
import { generateShareToken } from "../../lib/share-token";
import { getClientHealthSummary } from "../../lib/client-health-summary";
import { getClientTeam } from "../../lib/team-assignments";
import { getOnboardingByWorkbookId } from "../../lib/onboarding/get-by-workbook-id";
import OnboardingTabBody from "../../components/onboarding/OnboardingTabBody";
import ClientTaskPanels from "../../components/ClientTaskPanels";

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
  const teamMembers = getClientTeam(id);
  // Phase 2: fetch the full onboarding payload server-side via the
  // shared module. PR A's extraction made the same code path callable
  // from both this page and the /api/onboarding/by-workbook-id/[id]
  // route. The page bypasses the HTTP round-trip; the route stays in
  // place for client-side refresh patterns to come.
  //
  // The tab is hidden (per discovery-notes.md §5 Q10) when:
  //   - kind === 'invalid_id': not numeric route param (shouldn't
  //     happen since project lookup above already validated)
  //   - kind === 'not_found': no Supabase client row, or no session
  //     for the matched client
  //   - kind === 'error': Supabase down / env vars missing / etc.
  //     A noisy log fires inside the module; the page itself
  //     degrades gracefully and just doesn't show the tab.
  const onboardingResult = await getOnboardingByWorkbookId(project.id);
  const onboardingPayload =
    onboardingResult.kind === "ok" ? onboardingResult.payload : null;
  const hasOnboardingSession = onboardingPayload !== null;

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
  // Use a rolling 30-days-vs-prior-30-days comparison anchored to the latest
  // available data date, not wall-clock "now". GSC typically lags 2-4 days
  // and GA4 can lag 1-3 days, so anchoring to today would compare a short
  // current window against a full prior window and make every client look
  // like they're declining.
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
  // Task windows still use wall-clock "now".
  const cutoff = new Date(nowWall.getTime() - 30 * 24 * 60 * 60 * 1000);

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
  const gscCurr = gscData ? sumGsc(gscData.dailyData, gscCutoff, gscNow) : null;
  const gscPrev = gscData ? sumGsc(gscData.dailyData, gscPrevCutoff, gscCutoff) : null;
  const ga4Curr = ga4Data ? sumGa4(ga4Data.dailyData, ga4Cutoff, ga4Now) : null;
  const ga4Prev = ga4Data ? sumGa4(ga4Data.dailyData, ga4PrevCutoff, ga4Cutoff) : null;
  const completedThisPeriod = (todos || []).filter(
    (t) => t.completed && t.completed_on && new Date(t.completed_on) >= cutoff
  ).length;
  const dueThisPeriod = (todos || []).filter(
    (t) => t.due_on && new Date(t.due_on) >= cutoff && new Date(t.due_on) <= nowWall
  ).length;
  const overdue = (todos || [])
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
    // so a matched 30d-vs-prior-30d organic comparison isn't possible here.
    // The "Total traffic" win/flag below covers the overall-traffic signal.
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

  // Tab gating: each tab is gated on its own data source.
  //
  // Task-derived tabs (Overview, Internal Use) need `data`, which is the
  // per-client task file at app/data/clients/{id}.json. PR #31 wiped
  // those files when it removed the Basecamp poller; they'll come back
  // when the ClickUp ingest pipeline lands. Until then these tabs stay
  // code-resident but never render.
  //
  // Search Performance, Local SEO, and Content have their own independent
  // pipelines (GSC/GA4 JSON, BrightLocal JSON, Google Sheet) and were
  // accidentally tangled into the task gate in PR #31. They're now gated
  // on their own source data.
  //
  // Ask a Question reaches whenever there's something to ask about — task
  // data OR an onboarding session. Onboarding tab is gated on a Supabase
  // session existing for this workbook id.
  const tabs = [
    ...(data ? [{ id: "overview", label: "Overview" }] : []),
    ...(gscData || ga4Data
      ? [{ id: "search", label: "Search Performance" }]
      : []),
    ...(blData ? [{ id: "local-seo", label: "Local SEO" }] : []),
    ...(data || hasOnboardingSession
      ? [{ id: "ask-question", label: "Ask a Question" }]
      : []),
    // Content pulls from the Google Sheet via /api/content keyed on
    // client name — always available, the component handles empty state.
    { id: "content", label: "Content" },
    ...(data
      ? [
          {
            id: "internal",
            label: "Internal Use",
            children: [
              { id: "report", label: "Report" },
              { id: "project-log", label: "Project Log" },
            ],
          },
        ]
      : []),
    // Phase 1: ONBOARDING tab, gated on a Supabase session existing for
    // this workbook id. Placed to the right of Internal Use per the spec.
    ...(hasOnboardingSession ? [{ id: "onboarding", label: "Onboarding" }] : []),
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
            <div className="flex items-center gap-2">
              <MeetingPrepButton projectId={id} projectName={project.name} />
              {shareUrl && <ShareClientUrlButton shareUrl={shareUrl} />}
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1
                className="text-3xl font-bold tracking-wide uppercase"
                style={{ color: "#ffffff", letterSpacing: "0.05em" }}
              >
                {formatClientDisplayName(project)}
              </h1>
            </div>
            {healthSummary?.health && (
              <HealthBadge
                health={healthSummary.health}
                missingSources={healthSummary.missingSources}
              />
            )}
          </div>
          {/* Team assignment badges */}
          {teamMembers.length > 0 && (
            <div className="mt-2 flex items-center gap-3">
              <span
                className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: "#555" }}
              >
                Team
              </span>
              <TeamBadges members={teamMembers} variant="full" />
            </div>
          )}

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

        {tabs.length === 0 ? (
          /* No reachable tab — show the empty state. With the Content
             tab unconditional, this branch is currently unreachable in
             practice; kept as a safety net if a future change pulls
             Content back behind a gate. */
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
            {/* ── TAB: OVERVIEW (gated on task data) ─────── */}
            {/* Phase 5: Task-dependent body delegated to ClientTaskPanels.
                The page still seeds initialTodos/initialData so the first
                paint shows the stale JSON immediately; the client
                component then fires POST /api/basecamp/refresh and
                re-renders with live data. The ContentPipelineOverview
                snapshot stays server-rendered above because it pulls
                from a separate Google Sheet, not Basecamp. */}
            {data && (
              <div>
                <ContentPipelineOverview projectId={id} clientName={project.name} />
                <ClientTaskPanels
                  section="overview"
                  clientId={id}
                  projectName={project.name}
                  projectDescription={project.description ?? null}
                  initialTodos={todos}
                  initialData={data}
                  taskSummariesCache={taskSummariesCache}
                  overviewWins={overviewWins}
                  gscData={gscData}
                  ga4Data={ga4Data}
                  blData={blData}
                />
              </div>
            )}

            {/* ── TAB: SEARCH PERFORMANCE (gated on GSC or GA4 data) ─ */}
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

            {/* ── TAB: LOCAL SEO / BRIGHTLOCAL (gated on BL data only) ─ */}
            {blData && (
              <div>
                <BrightLocalPanel {...blData} />
              </div>
            )}

            {/* ── TAB: ASK A QUESTION (chatbot) — reachable when EITHER task data OR onboarding session ─ */}
            {(data || hasOnboardingSession) && (
              <div>
                <AskQuestionTab projectId={id} projectName={project.name} />
              </div>
            )}

            {/* ── TAB: CONTENT (Google Sheet, always available) ─ */}
            <div>
              <ContentTab projectId={id} clientName={project.name} />
            </div>

            {/* ── TAB: INTERNAL USE → REPORT (AI, gated on Basecamp data) ─ */}
            {/* Phase 5: AISummaryTab moved into ClientTaskPanels so the
                strip can re-fetch todos and the body sees the fresh list
                without a full page reload. */}
            {data && (
              <div>
                <ClientTaskPanels
                  section="internal-report"
                  clientId={id}
                  projectName={project.name}
                  projectDescription={project.description ?? null}
                  initialTodos={todos}
                  initialData={data}
                  taskSummariesCache={taskSummariesCache}
                  overviewWins={overviewWins}
                  gscData={gscData}
                  ga4Data={ga4Data}
                  blData={blData}
                />
              </div>
            )}

            {/* ── TAB: INTERNAL USE → PROJECT LOG (gated on task data) ─ */}
            {/* Phase 5: ProjectLogTable moved into ClientTaskPanels for
                the same reason as the Report sibling. */}
            {data && (
              <div>
                <ClientTaskPanels
                  section="internal-project-log"
                  clientId={id}
                  projectName={project.name}
                  projectDescription={project.description ?? null}
                  initialTodos={todos}
                  initialData={data}
                  taskSummariesCache={taskSummariesCache}
                  overviewWins={overviewWins}
                  gscData={gscData}
                  ga4Data={ga4Data}
                  blData={blData}
                />
              </div>
            )}

            {/* ── TAB: ONBOARDING (Phase 2 — reminder strip + action bar) ──── */}
            {onboardingPayload && (
              <div>
                <OnboardingTabBody payload={onboardingPayload} />
              </div>
            )}
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
              Data source: project &ldquo;{data.clientName}&rdquo;
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
