/**
 * Account Health Score Calculator
 *
 * Computes a 0-100 composite health score from 5 sub-scores.
 * Weights redistribute proportionally when a data source is unavailable.
 */

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

interface HealthScoreInput {
  // Task data
  tasksDueInPeriod: number;
  tasksCompletedInPeriod: number;
  overdueCount: number;

  // GSC data
  gscClicksCurrent: number | null;
  gscClicksPrevious: number | null;

  // GA4 data
  ga4OrganicCurrent: number | null;
  ga4OrganicPrevious: number | null;

  // BrightLocal data
  blRankingsUp: number | null;
  blRankingsDown: number | null;
  blAvgGoogleRank: number | null;
  blReviewRating: number | null;
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
  if (previous === 0) return current > 0 ? 80 : 50;

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

export function calculateHealthScore(input: HealthScoreInput): HealthScoreResult {
  const subScores: HealthSubScore[] = [];

  // 1. Task Velocity (always available)
  subScores.push({
    id: "tasks",
    label: "Task Velocity",
    score: Math.round(calcTaskVelocity(input)),
    weight: 20,
    available: true,
  });

  // 2. Organic Traffic (GSC)
  const trafficScore = calcTrafficScore(input.gscClicksCurrent, input.gscClicksPrevious);
  subScores.push({
    id: "traffic",
    label: "Organic Traffic",
    score: trafficScore !== null ? Math.round(trafficScore) : 0,
    weight: 25,
    available: trafficScore !== null,
  });

  // 3. Ranking Momentum (BrightLocal)
  const rankScore = calcRankingMomentum(input.blRankingsUp, input.blRankingsDown);
  subScores.push({
    id: "rankings",
    label: "Ranking Momentum",
    score: rankScore !== null ? Math.round(rankScore) : 0,
    weight: 25,
    available: rankScore !== null,
  });

  // 4. Engagement (GA4 Organic)
  const engagementScore = calcTrafficScore(input.ga4OrganicCurrent, input.ga4OrganicPrevious);
  subScores.push({
    id: "engagement",
    label: "Engagement",
    score: engagementScore !== null ? Math.round(engagementScore) : 0,
    weight: 15,
    available: engagementScore !== null,
  });

  // 5. Local Presence (BrightLocal)
  const localScore = calcLocalPresence(input.blAvgGoogleRank, input.blReviewRating);
  subScores.push({
    id: "local",
    label: "Local Presence",
    score: localScore !== null ? Math.round(localScore) : 0,
    weight: 15,
    available: localScore !== null,
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
