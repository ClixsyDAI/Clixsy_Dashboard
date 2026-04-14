/**
 * Client Health Summary — server-side loader that computes an Account
 * Health score for every project in projects.json in one shot.
 *
 * Used by the internal client list (/) to show a triage strip per client.
 * Safe to call in a server component — no React hooks here.
 *
 * INTERNAL-ONLY. Do not import from app/share/.
 */

import { existsSync } from "fs";
import { join } from "path";
import projects from "../data/projects.json";
import { loadClientTodos } from "./dashboard-data";
import { loadGscData, loadGa4Data } from "./google-data";
import { getBrightLocalSummary } from "./brightlocal-data";
import { loadAllContentArticles, articlesForClient } from "./content-data";
import {
  calculateHealthScore,
  type HealthScoreResult,
} from "./health-score";
import type { ContentArticle } from "./content-types";

export interface ClientHealthSummary {
  id: number;
  name: string;
  displayName: string; // name with J### prefix stripped
  description: string;
  todoset_id: number;
  hasData: boolean; // at least basecamp todos synced
  health: HealthScoreResult | null; // null if no data has been synced for this project
  missingSources: string[]; // human-readable: ["GA4", "BrightLocal"]
}

interface GscDaily {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function sumGscDaily(
  daily: GscDaily[] | undefined | null,
  from: Date,
  to: Date
): { clicks: number; impressions: number; ctr: number; position: number } {
  if (!Array.isArray(daily)) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const rows = daily.filter((r) => {
    const d = new Date(r.date);
    return d >= from && d <= to;
  });
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  // Weight position by impressions when possible; fall back to simple mean.
  const weightedImpressions = rows.reduce((s, r) => s + r.impressions, 0);
  const position =
    weightedImpressions > 0
      ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / weightedImpressions
      : rows.length > 0
        ? rows.reduce((s, r) => s + r.position, 0) / rows.length
        : 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  return { clicks, impressions, ctr, position };
}

interface Ga4Daily {
  date: string;
  sessions: number;
}

function sumGa4Sessions(
  daily: Ga4Daily[] | undefined | null,
  from: Date,
  to: Date
): number {
  if (!Array.isArray(daily)) return 0;
  return daily
    .filter((r) => {
      const d = new Date(r.date);
      return d >= from && d <= to;
    })
    .reduce((s, r) => s + r.sessions, 0);
}

/**
 * Summarize one project. Synchronous on file-backed data; content articles
 * are passed in from the caller so the Sheet fetch happens once per request.
 */
function summarizeProject(
  p: (typeof projects)[number],
  articles: ContentArticle[] | null
): ClientHealthSummary {
  const id = String(p.id);
  const displayName = p.name.replace(/^J\d+\s+/, "");
  const baseMeta = {
    id: p.id,
    name: p.name,
    displayName,
    description: p.description,
    todoset_id: p.todoset_id,
  };

  const todosPath = join(process.cwd(), "app", "data", "clients", `${id}.json`);
  const hasTodos = existsSync(todosPath);
  if (!hasTodos) {
    return {
      ...baseMeta,
      hasData: false,
      health: null,
      missingSources: ["Basecamp", "GSC", "GA4", "BrightLocal", "Content"],
    };
  }

  const todos = loadClientTodos(id) || [];
  const gscData = loadGscData(id);
  const ga4Data = loadGa4Data(id);
  const blData = getBrightLocalSummary(id);

  const nowWall = new Date();
  // Anchor the rolling window to the latest data date we actually have.
  // GSC / GA4 lag several days behind wall-clock — if we used nowWall as
  // the endpoint, the "current" 30d window would be partial while the prior
  // window is full, producing a spurious downward trend on every client.
  const latestGscDate =
    gscData?.dailyData?.length
      ? new Date(gscData.dailyData[gscData.dailyData.length - 1].date)
      : null;
  const latestGa4Date =
    ga4Data?.dailyData?.length
      ? new Date(ga4Data.dailyData[ga4Data.dailyData.length - 1].date)
      : null;
  const gscNow = latestGscDate || nowWall;
  const ga4Now = latestGa4Date || nowWall;
  const gscCutoff = new Date(gscNow.getTime() - 30 * 24 * 60 * 60 * 1000);
  const gscPrevCutoff = new Date(gscCutoff.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ga4Cutoff = new Date(ga4Now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ga4PrevCutoff = new Date(ga4Cutoff.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Task windows still use wall-clock "now" — Basecamp is live.
  const cutoff = new Date(nowWall.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Task metrics over the last 30 days ─────────────────────
  const completedInPeriod = todos.filter(
    (t) => t.completed && t.completed_on && new Date(t.completed_on) >= cutoff
  ).length;
  const dueInPeriod = todos.filter(
    (t) => t.due_on && new Date(t.due_on) >= cutoff && new Date(t.due_on) <= nowWall
  ).length;
  const overdueCount = todos.filter(
    (t) => !t.completed && t.due_on && new Date(t.due_on) < nowWall
  ).length;

  // ── GSC metrics (matched 30d vs prior-30d, anchored to latest GSC date) ──
  const gscCurr = gscData ? sumGscDaily(gscData.dailyData, gscCutoff, gscNow) : null;
  const gscPrev = gscData ? sumGscDaily(gscData.dailyData, gscPrevCutoff, gscCutoff) : null;

  // ── GA4 metrics (matched 30d vs prior-30d total sessions) ──
  const ga4Curr = ga4Data ? sumGa4Sessions(ga4Data.dailyData, ga4Cutoff, ga4Now) : null;
  const ga4Prev = ga4Data ? sumGa4Sessions(ga4Data.dailyData, ga4PrevCutoff, ga4Cutoff) : null;

  // ── Compute score ──────────────────────────────────────────
  const health = calculateHealthScore({
    tasksDueInPeriod: dueInPeriod,
    tasksCompletedInPeriod: completedInPeriod,
    overdueCount,
    gscClicksCurrent: gscCurr ? gscCurr.clicks : null,
    gscClicksPrevious: gscPrev ? gscPrev.clicks : null,
    gscAvgPositionCurrent: gscCurr && gscCurr.position > 0 ? gscCurr.position : null,
    gscAvgPositionPrevious: gscPrev && gscPrev.position > 0 ? gscPrev.position : null,
    gscCtrCurrent: gscCurr ? gscCurr.ctr : null,
    gscCtrPrevious: gscPrev ? gscPrev.ctr : null,
    gscImpressionsCurrent: gscCurr ? gscCurr.impressions : null,
    ga4SessionsCurrent: ga4Data ? ga4Curr : null,
    ga4SessionsPrevious: ga4Data ? ga4Prev : null,
    blRankingsUp: blData?.totalRankingsUp ?? null,
    blRankingsDown: blData?.totalRankingsDown ?? null,
    blAvgGoogleRank: blData?.avgGoogleRank ?? null,
    blReviewRating: blData?.reviewRating ?? null,
    contentArticles: articles,
  });

  const missingSources: string[] = [];
  if (!gscData) missingSources.push("GSC");
  if (!ga4Data) missingSources.push("GA4");
  if (!blData) missingSources.push("BrightLocal");
  if (!articles || articles.length === 0) missingSources.push("Content");

  return {
    ...baseMeta,
    hasData: true,
    health,
    missingSources,
  };
}

/**
 * Load a single project's health summary. Fetches only that project's
 * content articles from the Sheet (via the shared cache — so if the
 * list-page loader already ran this request cycle, this is free).
 */
export async function getClientHealthSummary(
  projectId: string | number
): Promise<ClientHealthSummary | null> {
  const p = projects.find((pp) => String(pp.id) === String(projectId));
  if (!p) return null;

  let articles: ContentArticle[] | null = null;
  try {
    const { byRawClient } = await loadAllContentArticles(false);
    articles = articlesForClient(byRawClient, p.name);
  } catch (err) {
    console.warn(
      `[client-health-summary] content fetch failed for ${p.name}:`,
      err
    );
  }

  try {
    return summarizeProject(p, articles);
  } catch (err) {
    console.warn(
      `[client-health-summary] single-project summarize failed for ${p.id}:`,
      err
    );
    return null;
  }
}

/**
 * Load health summaries for every client. Fetches the content sheet once
 * and reuses the parse across all projects. Individual project failures
 * are isolated so one bad data file doesn't break the whole list.
 */
export async function getAllClientHealthSummaries(): Promise<ClientHealthSummary[]> {
  let byRawClient: Map<string, ContentArticle[]> | null = null;
  try {
    const result = await loadAllContentArticles(false);
    byRawClient = result.byRawClient;
  } catch (err) {
    // Content sheet unavailable — every client just gets no content sub-score
    console.warn("[client-health-summary] content fetch failed:", err);
  }

  return projects.map((p) => {
    try {
      const articles = byRawClient ? articlesForClient(byRawClient, p.name) : null;
      return summarizeProject(p, articles);
    } catch (err) {
      console.warn(
        `[client-health-summary] failed to summarize project ${p.id} (${p.name}):`,
        err
      );
      return {
        id: p.id,
        name: p.name,
        displayName: p.name.replace(/^J\d+\s+/, ""),
        description: p.description,
        todoset_id: p.todoset_id,
        hasData: false,
        health: null,
        missingSources: [],
      };
    }
  });
}

/** Compact counts for the summary strip at the top of the list. */
export interface TriageCounts {
  strong: number;
  needsAttention: number;
  atRisk: number;
  noData: number;
  total: number;
}

export function summarizeCounts(
  summaries: ClientHealthSummary[]
): TriageCounts {
  const counts: TriageCounts = {
    strong: 0,
    needsAttention: 0,
    atRisk: 0,
    noData: 0,
    total: summaries.length,
  };
  for (const s of summaries) {
    if (!s.hasData || !s.health) {
      counts.noData++;
      continue;
    }
    if (s.health.overall >= 70) counts.strong++;
    else if (s.health.overall >= 40) counts.needsAttention++;
    else counts.atRisk++;
  }
  return counts;
}
