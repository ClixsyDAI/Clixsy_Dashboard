"use client";

// =============================================================
// ClientTaskPanels
// =============================================================
//
// Phase 4 wrapper around the three task-dependent tab bodies
// (Overview, Internal Use Report, Internal Use Project Log).
//
// Why this exists:
//
//   Pre-Phase-4 the page.tsx server component read the per-client
//   task JSON from disk at render time. After PR #31 ripped out the
//   Basecamp poller those files no longer get written by cron, so
//   the three tabs render empty until an admin manually re-syncs.
//
//   This component moves those three tab bodies into a client
//   component that fires POST /api/basecamp/refresh on mount and
//   re-renders with the live response. The page.tsx server pass
//   still seeds initialTodos / initialData so the very first paint
//   isn't a spinner — when a stale JSON file exists locally it
//   shows immediately, then the live refresh updates it in place.
//
// State machine intentionally simple:
//
//   idle ──onClick / mount──▶ refreshing ──ok──▶ idle (with new data)
//                                       │
//                                       └──fail──▶ error ──onClick──▶ refreshing
//
// The refresh strip is always rendered, regardless of whether
// the section has data to show. That keeps the manual refresh
// button reachable on the empty-state placeholder too.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
// IMPORTANT: dashboard-data.ts imports `fs` and `path` at module
// top-level (it serves both server JSON loaders and the pure
// compute function). Pulling its runtime exports into a "use
// client" bundle would crash the client build with "Module not
// found: fs". We use type-only imports for the shapes (erased at
// compile time) and reimplement the pure computeDashboardData
// logic inline below. The duplication is intentional and small;
// a follow-up PR should split dashboard-data.ts into:
//   - dashboard-compute.ts: pure (Todo[] → DashboardData)
//   - dashboard-loaders.ts: fs-bound readers
// at which point this component can import the pure module
// directly.
import type {
  DashboardData,
  ScoredTodo,
  Todo,
} from "../lib/dashboard-data";
import type { DetectedItem } from "../lib/win-flag-detection";
import ClientDashboardCharts from "./ClientDashboardCharts";
import Last10TasksTable from "./Last10TasksTable";
import OverviewTopWins from "./OverviewTopWins";
import AISummaryTab from "./AISummaryTab";
import ProjectLogTable from "./ProjectLogTable";

// ── Types ─────────────────────────────────────────────────────

type SectionId = "overview" | "internal-report" | "internal-project-log";

type RefreshState =
  | { kind: "idle" }
  | { kind: "refreshing" }
  | { kind: "error"; message: string };

interface CachedSummary {
  id: number;
  title: string;
  whyItMatters: string;
  updatedAt: string;
}

// Opaque pass-throughs — the children own these shapes; we don't
// re-derive anything from them inside this component, so loose
// generics keep the prop surface readable without dragging the
// full GSC/GA4/BL/wins types in.

// GSC / GA4 / BrightLocal shapes that the AISummaryTab + overview
// charts consume. Importing the structural types from the lib would
// drag the server-only fs/path deps into a "use client" boundary,
// so we restate the structural minimum here.

interface GscDailyRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface Ga4DailyRow {
  date: string;
  sessions: number;
  users: number;
  screenPageViews: number;
}
interface Ga4Channel {
  channel: string;
  sessions: number;
  users: number;
}

interface GscDataForPanels {
  dailyData: GscDailyRow[] | null;
  topQueries: GscQuery[] | null;
}
interface Ga4DataForPanels {
  dailyData: Ga4DailyRow[] | null;
  channelData: Ga4Channel[] | null;
  totals: { organicSessions: number | null } | null;
}
interface BlDataForPanels {
  locationCount: number | null;
  totalRankingsUp: number | null;
  totalRankingsDown: number | null;
  avgGoogleRank: number | null;
  totalCitations: number | null;
  reviewRating: number | null;
  totalReviews: number | null;
  totalGmbCalls: number | null;
}

export interface ClientTaskPanelsProps {
  clientId: string;
  projectName: string;
  /** Pre-stripped project description for the AISummaryTab body. */
  projectDescription: string | null;
  section: SectionId;
  initialTodos: Todo[] | null;
  initialData: DashboardData | null;
  taskSummariesCache: Record<string, CachedSummary>;
  /** Server-detected wins for the Overview slot. Static — wins use
   *  GSC/GA4/BL data which doesn't change in a Basecamp refresh. */
  overviewWins: DetectedItem[];
  /** Inputs the AISummaryTab needs that aren't computed from todos. */
  gscData: GscDataForPanels | null;
  ga4Data: Ga4DataForPanels | null;
  blData: BlDataForPanels | null;
}

// ── Helpers ───────────────────────────────────────────────────

// ── Inline pure compute helpers (mirror of dashboard-data.ts) ─

const HIGH_IMPACT_KEYWORDS = [
  "homepage", "sitewide", "site-wide", "all pages", "all forms",
  "tracking", "conversion", "lead", "form", "booking", "schedule",
  "phone number", "call tracking", "chatbot", "review", "gbp",
  "google business", "schema", "restructur", "pruning", "redirect",
  "301", "meta title", "meta description", "h1", "url restructure",
  "compliance", "tcr",
];

function stripHtml(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(
    new RegExp("<bc-attachment[^>]*>.*?</bc-attachment>", "gs"),
    ""
  );
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

function cleanListTitle(title: string): string {
  return title.replace(/:$/, "").trim().replace(/^5\.\s*/, "");
}

function shortTruncate(text: string, maxLen: number = 80): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

function computeImpactScore(todo: Todo): { score: number; rationale: string } {
  let score = 0;
  const reasons: string[] = [];
  const combined = `${(todo.title || "").toLowerCase()} ${stripHtml(
    todo.description || ""
  ).toLowerCase()} ${(todo.list_title || "").toLowerCase()}`;

  const highMatches = HIGH_IMPACT_KEYWORDS.filter((kw) =>
    combined.includes(kw)
  );
  if (highMatches.length > 0) {
    score += Math.min(highMatches.length * 8, 30);
    if (["homepage", "sitewide", "all pages", "all forms"].some((kw) => combined.includes(kw))) {
      reasons.push("Affects homepage or sitewide elements");
    } else if (["form", "lead", "conversion", "booking", "schedule", "chatbot"].some((kw) => combined.includes(kw))) {
      reasons.push("Impacts lead flow or conversion path");
    } else if (["restructur", "pruning", "301", "redirect"].some((kw) => combined.includes(kw))) {
      reasons.push("Sitewide technical/structural change");
    } else if (["gbp", "google business", "review"].some((kw) => combined.includes(kw))) {
      reasons.push("Affects local visibility or reputation");
    } else if (["tracking", "compliance", "tcr"].some((kw) => combined.includes(kw))) {
      reasons.push("Compliance or tracking infrastructure");
    } else {
      reasons.push("Touches high-impact area");
    }
  }

  const comments = todo.comments_count || 0;
  if (comments >= 20) {
    score += 20;
    reasons.push(`Heavy stakeholder discussion (${comments} comments)`);
  } else if (comments >= 10) {
    score += 12;
    reasons.push(`Active discussion (${comments} comments)`);
  } else if (comments >= 5) {
    score += 6;
  }

  if (todo.due_on && !todo.completed) {
    const dueDate = new Date(todo.due_on);
    const now = new Date();
    const daysUntil = Math.floor(
      (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil < 0) {
      score += 15;
      reasons.push(`Overdue by ${Math.abs(daysUntil)} days`);
    } else if (daysUntil <= 7) {
      score += 10;
      reasons.push("Due within 7 days");
    }
  }

  if (todo.list_title.toLowerCase().includes("client change")) {
    score += 5;
    if (!reasons.some((r) => r.toLowerCase().includes("client"))) {
      reasons.push("Client-requested change");
    }
  }

  if (["content plan", "content optimization", "new content", "blog", "faq"].some((kw) => combined.includes(kw))) {
    score += 5;
    reasons.push("Content/SEO impact");
  }

  if (todo.assignees && todo.assignees.includes(",")) {
    score += 3;
  }

  score = Math.min(score, 100);
  const rationale = reasons.length > 0 ? reasons.slice(0, 3).join("; ") : "Standard task";
  return { score, rationale };
}

/** Pure mirror of dashboard-data.ts → computeDashboardData. See
 *  the top-of-file comment for why this is duplicated client-side. */
function computeDashboardData(
  todos: Todo[] | null,
  clientName: string
): DashboardData | null {
  if (!todos || todos.length === 0) return null;

  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const allCompleted = todos.filter((t) => t.completed);
  const allOutstanding = todos.filter((t) => !t.completed);
  const total = todos.length;
  const completedCount = allCompleted.length;
  const outstandingCount = allOutstanding.length;
  const completionRate = total > 0 ? (completedCount / total) * 100 : 0;

  const periodCompleted = allCompleted.filter(
    (t) => t.completed_on && new Date(t.completed_on) >= cutoff
  );

  const last10Updated = [...todos]
    .filter((t) => t.updated_at)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      title: stripHtml(t.title),
      description: stripHtml(t.description || "").slice(0, 600),
      list_title: cleanListTitle(t.list_title),
      completed: t.completed,
      updated_at: t.updated_at,
      app_url: t.app_url,
    }));

  const topCommented = [...todos]
    .sort((a, b) => (b.comments_count || 0) - (a.comments_count || 0))
    .slice(0, 10)
    .map((t) => ({
      ...t,
      title: stripHtml(t.title),
      list_title: cleanListTitle(t.list_title),
      assignees: shortTruncate(t.assignees, 30),
    }));

  const scoredTodos: ScoredTodo[] = todos.map((t) => {
    const { score, rationale } = computeImpactScore(t);
    return { ...t, impact_score: score, impact_rationale: rationale };
  });

  const topImpact = [...scoredTodos]
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, 10)
    .map((t) => ({
      ...t,
      title: stripHtml(t.title),
      list_title: cleanListTitle(t.list_title),
      assignees: shortTruncate(t.assignees, 25),
      impact_rationale: shortTruncate(t.impact_rationale, 80),
    }));

  const categoryMap = new Map<string, { completed: number; outstanding: number }>();
  todos.forEach((t) => {
    const cat = cleanListTitle(t.list_title);
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { completed: 0, outstanding: 0 });
    }
    const entry = categoryMap.get(cat)!;
    if (t.completed) entry.completed++;
    else entry.outstanding++;
  });
  const categoryData = Array.from(categoryMap.entries())
    .map(([name, counts]) => ({
      name: shortTruncate(name, 30),
      completed: counts.completed,
      outstanding: counts.outstanding,
    }))
    .sort((a, b) => b.completed + b.outstanding - (a.completed + a.outstanding));

  const commentData = [...todos]
    .sort((a, b) => (b.comments_count || 0) - (a.comments_count || 0))
    .slice(0, 10)
    .filter((t) => t.comments_count > 0)
    .map((t) => ({
      name: shortTruncate(stripHtml(t.title), 40),
      comments: t.comments_count,
    }));

  const monthMap = new Map<string, number>();
  allCompleted.forEach((t) => {
    if (t.completed_on) {
      const d = new Date(t.completed_on);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    }
  });
  const timelineData = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, completed]) => {
      const [y, m] = month.split("-");
      const date = new Date(parseInt(y), parseInt(m) - 1);
      return {
        month: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        completed,
      };
    });

  const periodStart = cutoff.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const periodEnd = now.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const lastRefreshed = now.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  const uniqueLists = new Set(todos.map((t) => t.list_title)).size;

  return {
    clientName,
    periodStart,
    periodEnd,
    lastRefreshed,
    total,
    completedCount,
    outstandingCount,
    completionRate: Math.round(completionRate),
    periodCompletedCount: periodCompleted.length,
    last10Updated,
    topCommented,
    topImpact,
    uniqueLists,
    categoryData,
    commentData,
    timelineData,
  };
}

// ── UI helpers ────────────────────────────────────────────────

function prettifyReason(reason: string): string {
  if (reason === "not_basecamp_syncable") {
    return "This client isn't backed by a Basecamp project.";
  }
  if (reason.includes("404")) {
    return "Basecamp project not found.";
  }
  if (reason.toLowerCase().includes("token")) {
    return "Basecamp credentials expired. An admin needs to reconnect.";
  }
  return "Refresh failed: " + reason;
}

function formatRelative(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = new Date(epochMs);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

// ── Component ─────────────────────────────────────────────────

export default function ClientTaskPanels({
  clientId,
  projectName,
  projectDescription,
  section,
  initialTodos,
  initialData,
  taskSummariesCache,
  overviewWins,
  gscData,
  ga4Data,
  blData,
}: ClientTaskPanelsProps) {
  const [todos, setTodos] = useState<Todo[] | null>(initialTodos);
  const [data, setData] = useState<DashboardData | null>(initialData);
  const [refreshState, setRefreshState] = useState<RefreshState>({
    kind: "idle",
  });
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const doRefresh = useCallback(async () => {
    setRefreshState({ kind: "refreshing" });
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch("/api/basecamp/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
        },
        body: JSON.stringify({ clientId }),
      });

      // Try to read the body whether or not the status is 2xx — the
      // API returns a structured { ok, reason } even on 4xx/5xx.
      type RefreshResponse = {
        ok?: boolean;
        reason?: string;
        todos?: Todo[];
        status?: string;
      };
      let json: RefreshResponse | null = null;
      try {
        json = (await res.json()) as RefreshResponse;
      } catch {
        json = null;
      }

      if (!res.ok || json === null || json.ok !== true) {
        const reason = json?.reason ?? `HTTP ${res.status}`;
        setRefreshState({ kind: "error", message: prettifyReason(reason) });
        return;
      }

      // The "skipped: not_basecamp_syncable" path still returns ok:true
      // but no todos — surface it as a friendly error rather than wiping
      // any existing in-memory data.
      if (json.status === "skipped" && json.reason) {
        setRefreshState({
          kind: "error",
          message: prettifyReason(json.reason),
        });
        return;
      }

      const nextTodos = Array.isArray(json.todos) ? json.todos : [];
      setTodos(nextTodos);
      setData(computeDashboardData(nextTodos, projectName));
      setLastRefreshedAt(Date.now());
      setRefreshState({ kind: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRefreshState({ kind: "error", message: prettifyReason(message) });
    }
  }, [clientId, projectName]);

  // Fire one refresh on mount. The empty dep array is intentional —
  // doRefresh is stable for the lifetime of the projectId/projectName
  // tuple, and we don't want a re-trigger when the section prop
  // changes (tab switches).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void doRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStrip = useMemo<ReactNode>(() => {
    return (
      <div
        className="mb-4 flex items-center justify-between gap-3 rounded-sm px-3 py-2"
        style={{ backgroundColor: "#111111" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void doRefresh()}
            disabled={refreshState.kind === "refreshing"}
            className="rounded-sm px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
          >
            {refreshState.kind === "refreshing"
              ? "Refreshing..."
              : "Refresh from Basecamp"}
          </button>
          <RefreshStatusText
            refreshState={refreshState}
            lastRefreshedAt={lastRefreshedAt}
          />
        </div>
      </div>
    );
  }, [refreshState, lastRefreshedAt, doRefresh]);

  return (
    <div>
      {refreshStrip}
      {data ? (
        <SectionBody
          section={section}
          clientId={clientId}
          projectName={projectName}
          projectDescription={projectDescription}
          data={data}
          todos={todos}
          taskSummariesCache={taskSummariesCache}
          overviewWins={overviewWins}
          gscData={gscData}
          ga4Data={ga4Data}
          blData={blData}
        />
      ) : (
        <EmptyTaskPlaceholder
          refreshing={refreshState.kind === "refreshing"}
        />
      )}
    </div>
  );
}

// ── Refresh strip status text ─────────────────────────────────

function RefreshStatusText({
  refreshState,
  lastRefreshedAt,
}: {
  refreshState: RefreshState;
  lastRefreshedAt: number | null;
}) {
  if (refreshState.kind === "refreshing") {
    return (
      <span className="text-xs" style={{ color: "#888888" }}>
        Refreshing...
      </span>
    );
  }
  if (refreshState.kind === "error") {
    return (
      <span
        className="text-xs"
        style={{ color: "#d97757" }}
        title={refreshState.message}
      >
        {refreshState.message}
      </span>
    );
  }
  if (lastRefreshedAt !== null) {
    return (
      <span className="text-xs" style={{ color: "#888888" }}>
        Last refreshed {formatRelative(lastRefreshedAt)}
      </span>
    );
  }
  return null;
}

// ── Empty-state placeholder ───────────────────────────────────

function EmptyTaskPlaceholder({ refreshing }: { refreshing: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-sm py-16"
      style={{ backgroundColor: "#111111" }}
    >
      <p className="text-sm" style={{ color: "#888888" }}>
        {refreshing
          ? "Loading tasks from Basecamp..."
          : "No task data available yet."}
      </p>
    </div>
  );
}

// ── Section body dispatcher ───────────────────────────────────

interface SectionBodyProps {
  section: SectionId;
  clientId: string;
  projectName: string;
  projectDescription: string | null;
  data: DashboardData;
  todos: Todo[] | null;
  taskSummariesCache: Record<string, CachedSummary>;
  overviewWins: DetectedItem[];
  gscData: GscDataForPanels | null;
  ga4Data: Ga4DataForPanels | null;
  blData: BlDataForPanels | null;
}

function SectionBody({
  section,
  clientId,
  projectName,
  projectDescription,
  data,
  todos,
  taskSummariesCache,
  overviewWins,
  gscData,
  ga4Data,
  blData,
}: SectionBodyProps) {
  if (section === "overview") {
    return (
      <OverviewSection
        clientId={clientId}
        data={data}
        taskSummariesCache={taskSummariesCache}
        overviewWins={overviewWins}
      />
    );
  }

  if (section === "internal-report") {
    return (
      <InternalReportSection
        clientId={clientId}
        projectName={projectName}
        projectDescription={projectDescription}
        todos={todos ?? []}
        gscData={gscData}
        ga4Data={ga4Data}
        blData={blData}
      />
    );
  }

  // internal-project-log
  return <InternalProjectLogSection todos={todos} />;
}

// ── Overview section ──────────────────────────────────────────

function OverviewSection({
  clientId,
  data,
  taskSummariesCache,
  overviewWins,
}: {
  clientId: string;
  data: DashboardData;
  taskSummariesCache: Record<string, CachedSummary>;
  overviewWins: DetectedItem[];
}) {
  return (
    <div>
      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard value={data.completedCount} label="COMPLETED TASKS" />
        <KpiCard value={data.outstandingCount} label="OUTSTANDING TASKS" />
        <KpiCard
          value={`${data.completionRate}%`}
          label="COMPLETION RATE"
        />
        <KpiCard
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
        {data.outstandingCount} outstanding &nbsp;|&nbsp; {data.total} total
        tasks tracked
      </p>

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
              projectId={clientId}
              tasks={data.last10Updated}
              initialSummaries={taskSummariesCache}
            />
          ) : null
        }
      />

      {/* Most Discussed Tasks */}
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
              {data.topCommented.map((t: Todo, i: number) => (
                <tr
                  key={t.id}
                  style={{
                    backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a",
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
                    {t.due_on || "—"}
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Highest Impact Tasks */}
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
              {data.topImpact.map((t: ScoredTodo, i: number) => (
                <tr
                  key={t.id}
                  style={{
                    backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a",
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
                    {t.due_on || "—"}
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
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── Internal Use → Report (AI summary) ────────────────────────

function InternalReportSection({
  clientId,
  projectName,
  projectDescription,
  todos,
  gscData,
  ga4Data,
  blData,
}: {
  clientId: string;
  projectName: string;
  projectDescription: string | null;
  todos: Todo[];
  gscData: GscDataForPanels | null;
  ga4Data: Ga4DataForPanels | null;
  blData: BlDataForPanels | null;
}) {
  return (
    <AISummaryTab
      projectId={clientId}
      projectName={projectName}
      projectDescription={projectDescription}
      todos={todos}
      gscDaily={gscData?.dailyData ?? null}
      gscTopQueries={gscData?.topQueries ?? null}
      ga4Daily={ga4Data?.dailyData ?? null}
      ga4Channels={ga4Data?.channelData ?? null}
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
  );
}

// ── Internal Use → Project Log ────────────────────────────────

function InternalProjectLogSection({ todos }: { todos: Todo[] | null }) {
  if (todos && todos.length > 0) {
    return <ProjectLogTable todos={todos} />;
  }
  return (
    <p
      className="py-12 text-center text-sm"
      style={{ color: "#666" }}
    >
      No task data synced yet.
    </p>
  );
}

// ── Local sub-components (mirrors page.tsx) ───────────────────

function KpiCard({
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
  children: ReactNode;
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
  children: ReactNode;
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
