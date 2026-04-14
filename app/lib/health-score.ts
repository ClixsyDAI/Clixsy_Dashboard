/**
 * Account Health Score Calculator
 *
 * Computes a 0-100 composite health score from up to 7 sub-scores:
 *   - Task Velocity            (15)  Basecamp
 *   - Organic Traffic          (20)  GSC clicks 30d vs prior 30d
 *   - Search Performance       (15)  GSC avg position + CTR trend
 *   - Ranking Momentum         (15)  BrightLocal rankings up − down
 *   - Local Presence           (10)  BrightLocal avg Google rank + review rating
 *   - Engagement               (10)  GA4 total sessions 30d vs prior 30d
 *   - Content Production       (15)  Content pipeline publishing cadence
 *
 * Weights redistribute proportionally when a data source is unavailable so a
 * client with only Basecamp + GSC still gets a sensible composite number.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * INTERNAL-ONLY. Do not import from app/share/ — this data is triage signal
 * for the Clixsy team and is not appropriate to surface on client-facing
 * pages. The health score synthesizes internal judgments ("At Risk") that
 * should not be shown to clients directly.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ContentArticle } from "./content-types";

export interface HealthSubScore {
  id: string;
  label: string;
  score: number; // 0-100
  weight: number;
  available: boolean;
}

export interface HealthScoreResult {
  overall: number; // 0-100
  label: string; // "Strong" | "Needs Attention" | "At Risk"
  color: string;
  subScores: HealthSubScore[];
}

export interface HealthScoreInput {
  // Task data
  tasksDueInPeriod: number;
  tasksCompletedInPeriod: number;
  overdueCount: number;

  // GSC — traffic volume
  gscClicksCurrent: number | null;
  gscClicksPrevious: number | null;
  // GSC — search performance (optional; gated on impression volume)
  gscAvgPositionCurrent?: number | null;
  gscAvgPositionPrevious?: number | null;
  gscCtrCurrent?: number | null;
  gscCtrPrevious?: number | null;
  gscImpressionsCurrent?: number | null;

  // GA4 — total sessions over the same rolling window we use for GSC.
  // (We don't have per-day organic breakdown in the current pull, so
  // using organic here would produce mismatched windows.)
  ga4SessionsCurrent: number | null;
  ga4SessionsPrevious: number | null;

  // BrightLocal
  blRankingsUp: number | null;
  blRankingsDown: number | null;
  blAvgGoogleRank: number | null;
  blReviewRating: number | null;

  // Content pipeline (optional — many clients have no content program)
  contentArticles?: ContentArticle[] | null;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function lerp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + t * (outMax - outMin);
}

function calcTaskVelocity(input: HealthScoreInput): number {
  const { tasksDueInPeriod, tasksCompletedInPeriod, overdueCount } = input;
  if (tasksDueInPeriod === 0 && tasksCompletedInPeriod === 0) return 60; // neutral

  let score = 60;
  if (tasksDueInPeriod > 0) {
    const completionRate = tasksCompletedInPeriod / Math.max(tasksDueInPeriod, 1);
    score = clamp(completionRate * 100, 0, 100);
  } else if (tasksCompletedInPeriod > 0) {
    score = 80; // completed tasks even though none were due
  }

  // Penalize overdue tasks
  score -= overdueCount * 10;
  return clamp(score, 0, 100);
}

function calcTrafficScore(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  // If the prior window has zero traffic we can't compute a meaningful trend
  // (dividing by zero produces absurd % changes like "+521%"). Treat as
  // unavailable so the weight redistributes to other sub-scores.
  if (previous === 0) return null;

  const pctChange = ((current - previous) / previous) * 100;

  if (pctChange >= 10) return 100;
  if (pctChange >= 0) return lerp(pctChange, 0, 10, 60, 100);
  if (pctChange >= -10) return lerp(pctChange, -10, 0, 20, 60);
  return 20;
}

function calcRankingMomentum(up: number | null, down: number | null): number | null {
  if (up === null || down === null) return null;
  const net = up - down;

  if (net > 50) return 100;
  if (net > 0) return lerp(net, 0, 50, 50, 100);
  if (net === 0) return 50;
  if (net > -50) return lerp(net, -50, 0, 10, 50);
  return 10;
}

function calcLocalPresence(avgRank: number | null, reviewRating: number | null): number | null {
  if (avgRank === null || avgRank === 0) return null;

  let score: number;
  if (avgRank < 3) score = 100;
  else if (avgRank <= 5) score = lerp(avgRank, 3, 5, 75, 100);
  else if (avgRank <= 10) score = lerp(avgRank, 5, 10, 50, 75);
  else score = lerp(avgRank, 10, 30, 10, 50);

  if (reviewRating && reviewRating >= 4.5) score = Math.min(100, score + 10);

  return clamp(score, 0, 100);
}

/**
 * Search performance: avg position trend + CTR trend. Returns null if we
 * don't have enough data to judge (too few impressions, or no previous
 * period to compare against).
 *
 * Position delta is "previous − current" so higher is better (moving from
 * position 12 → 8 is +4). CTR delta is "current − previous".
 */
function calcSearchPerformance(
  posCurrent: number | null | undefined,
  posPrevious: number | null | undefined,
  ctrCurrent: number | null | undefined,
  ctrPrevious: number | null | undefined,
  impressionsCurrent: number | null | undefined
): number | null {
  // Need at least ~100 impressions in the current period to make any claim.
  if (!impressionsCurrent || impressionsCurrent < 100) return null;

  const havePosition =
    posCurrent !== null &&
    posCurrent !== undefined &&
    posCurrent > 0 &&
    posPrevious !== null &&
    posPrevious !== undefined &&
    posPrevious > 0;

  const haveCtr =
    ctrCurrent !== null &&
    ctrCurrent !== undefined &&
    ctrPrevious !== null &&
    ctrPrevious !== undefined &&
    (ctrCurrent > 0 || ctrPrevious > 0);

  if (!havePosition && !haveCtr) return null;

  let positionScore: number | null = null;
  if (havePosition) {
    const delta = (posPrevious as number) - (posCurrent as number); // +ve = improved
    if (delta >= 2) positionScore = 100;
    else if (delta >= 0) positionScore = lerp(delta, 0, 2, 60, 100);
    else if (delta >= -2) positionScore = lerp(delta, -2, 0, 20, 60);
    else positionScore = 20;
  }

  let ctrScore: number | null = null;
  if (haveCtr) {
    // CTR is a ratio (0.05 = 5%). 1pp change is a meaningful move.
    const delta = (ctrCurrent as number) - (ctrPrevious as number);
    if (delta >= 0.01) ctrScore = 100;
    else if (delta >= 0) ctrScore = lerp(delta, 0, 0.01, 60, 100);
    else if (delta >= -0.01) ctrScore = lerp(delta, -0.01, 0, 20, 60);
    else ctrScore = 20;
  }

  if (positionScore !== null && ctrScore !== null) {
    return clamp(positionScore * 0.6 + ctrScore * 0.4, 0, 100);
  }
  return positionScore ?? ctrScore;
}

/**
 * Content production: publishing cadence over the last 30/60/90 days, with
 * a floor for clients whose pipeline is still actively being worked on.
 *
 * Returns null if the client has no content pipeline at all (many Clixsy
 * accounts don't, and we don't want to penalize them for a program they
 * never signed up for).
 */
function calcContentProduction(articles: ContentArticle[] | null | undefined): number | null {
  if (!articles || articles.length === 0) return null;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const publishedWithDate = articles.filter(
    (a) => a.status === "published" && a.publishDate
  );
  const published30 = publishedWithDate.filter(
    (a) => now - new Date(a.publishDate as string).getTime() <= 30 * day
  ).length;
  const published60 = publishedWithDate.filter(
    (a) => now - new Date(a.publishDate as string).getTime() <= 60 * day
  ).length;
  const published90 = publishedWithDate.filter(
    (a) => now - new Date(a.publishDate as string).getTime() <= 90 * day
  ).length;

  const active = articles.filter(
    (a) =>
      a.status === "content-in-progress" ||
      a.status === "content-for-review" ||
      a.status === "queued-for-launch"
  ).length;

  // If the Sheet has entries for this client but nothing is published in the
  // last 90 days AND there's no active work in flight, we don't have a
  // signal worth scoring — mark unavailable so the weight redistributes
  // instead of handing out a punitive 10 for a program the client likely
  // isn't on.
  if (publishedWithDate.length === 0 && active === 0) return null;

  let score: number;
  if (published30 >= 3) score = 100;
  else if (published30 === 2) score = 85;
  else if (published30 === 1) score = 70;
  else if (published60 >= 2) score = 55;
  else if (published60 === 1) score = 45;
  else if (published90 >= 1) score = 30;
  else score = 10;

  // Active pipeline cushions low publishing — work in flight counts for
  // something even if nothing has shipped this month.
  if (score < 60 && active >= 3) score = Math.min(60, score + 20);
  else if (score < 40 && active >= 1) score = Math.min(40, score + 10);

  return clamp(score, 0, 100);
}

export function calculateHealthScore(input: HealthScoreInput): HealthScoreResult {
  const subScores: HealthSubScore[] = [];

  // 1. Task Velocity (always available)
  subScores.push({
    id: "tasks",
    label: "Task Velocity",
    score: Math.round(calcTaskVelocity(input)),
    weight: 15,
    available: true,
  });

  // 2. Organic Traffic (GSC clicks trend)
  const trafficScore = calcTrafficScore(input.gscClicksCurrent, input.gscClicksPrevious);
  subScores.push({
    id: "traffic",
    label: "Organic Traffic",
    score: trafficScore !== null ? Math.round(trafficScore) : 0,
    weight: 20,
    available: trafficScore !== null,
  });

  // 3. Search Performance (GSC position + CTR trend)
  const searchPerfScore = calcSearchPerformance(
    input.gscAvgPositionCurrent,
    input.gscAvgPositionPrevious,
    input.gscCtrCurrent,
    input.gscCtrPrevious,
    input.gscImpressionsCurrent
  );
  subScores.push({
    id: "search-perf",
    label: "Search Performance",
    score: searchPerfScore !== null ? Math.round(searchPerfScore) : 0,
    weight: 15,
    available: searchPerfScore !== null,
  });

  // 4. Ranking Momentum (BrightLocal)
  const rankScore = calcRankingMomentum(input.blRankingsUp, input.blRankingsDown);
  subScores.push({
    id: "rankings",
    label: "Ranking Momentum",
    score: rankScore !== null ? Math.round(rankScore) : 0,
    weight: 15,
    available: rankScore !== null,
  });

  // 5. Local Presence (BrightLocal)
  const localScore = calcLocalPresence(input.blAvgGoogleRank, input.blReviewRating);
  subScores.push({
    id: "local",
    label: "Local Presence",
    score: localScore !== null ? Math.round(localScore) : 0,
    weight: 10,
    available: localScore !== null,
  });

  // 6. Engagement (GA4 total sessions, matched 30d vs prior 30d)
  const engagementScore = calcTrafficScore(input.ga4SessionsCurrent, input.ga4SessionsPrevious);
  subScores.push({
    id: "engagement",
    label: "Engagement",
    score: engagementScore !== null ? Math.round(engagementScore) : 0,
    weight: 10,
    available: engagementScore !== null,
  });

  // 7. Content Production (Google Sheets pipeline)
  const contentScore = calcContentProduction(input.contentArticles);
  subScores.push({
    id: "content",
    label: "Content Production",
    score: contentScore !== null ? Math.round(contentScore) : 0,
    weight: 15,
    available: contentScore !== null,
  });

  // Calculate weighted average, redistributing weight from unavailable scores
  const available = subScores.filter((s) => s.available);
  const totalWeight = available.reduce((s, sc) => s + sc.weight, 0);
  const overall =
    totalWeight > 0
      ? Math.round(
          available.reduce((s, sc) => s + sc.score * (sc.weight / totalWeight), 0)
        )
      : 50;

  const label = overall >= 70 ? "Strong" : overall >= 40 ? "Needs Attention" : "At Risk";
  const color = overall >= 70 ? "#2d6a4f" : overall >= 40 ? "#C8A882" : "#e74c3c";

  return { overall, label, color, subScores };
}
