/**
 * Automatic Win & Flag Detection
 *
 * Analyzes client data to surface top wins and concerns
 * before the AI report generates. AI can later enhance these.
 */

export interface DetectedItem {
  title: string;
  detail: string;
  source: "Basecamp" | "GSC" | "GA4" | "BrightLocal";
  severity?: "high" | "medium" | "low";
}

interface DetectionInput {
  // Tasks
  tasksCompletedInPeriod: number;
  tasksDueInPeriod: number;
  overdueTasks: Array<{ title: string; due_on: string | null }>;
  completionRate: number; // 0-1

  // GSC
  gscClicksCurrent: number | null;
  gscClicksPrevious: number | null;
  gscAvgPositionCurrent: number | null;
  gscAvgPositionPrevious: number | null;
  gscCtrCurrent: number | null;
  gscCtrPrevious: number | null;

  // GA4
  ga4SessionsCurrent: number | null;
  ga4SessionsPrevious: number | null;
  // Organic-only current/previous. Pass matched-window values (e.g.
  // 30d-vs-prior-30d) or leave null — DO NOT mix windows (e.g. a 90d
  // aggregate as "current" and a 30d total-sessions figure as "previous"),
  // which will produce wildly misleading percent changes. Today's GA4
  // pipeline doesn't fetch daily organic, so callers should pass null
  // until a matched organic series is available.
  ga4OrganicCurrent: number | null;
  ga4OrganicPrevious: number | null;

  // BrightLocal
  blRankingsUp: number | null;
  blRankingsDown: number | null;
  blAvgGoogleRank: number | null;
  blReviewRating: number | null;
  blTotalReviews: number | null;
  blCitations: number | null;
  blGmbCalls: number | null;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function fmtPct(val: number): string {
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}%`;
}

function fmtNum(val: number): string {
  return val.toLocaleString();
}

export function detectWins(input: DetectionInput): DetectedItem[] {
  const wins: DetectedItem[] = [];

  // Task completion rate >80%
  if (input.completionRate >= 0.8 && input.tasksCompletedInPeriod > 0) {
    const completed = input.tasksCompletedInPeriod;
    const due = input.tasksDueInPeriod;
    // Only show the "X of Y (Z%)" ratio when it reads sensibly. When more
    // tasks were completed than were due in the period — common for teams
    // who complete work ahead of schedule, or for tasks with no due date —
    // the ratio would exceed 100% ("5 of 3 tasks completed (167%)"), which
    // looks broken to clients. Fall back to a plain count in that case.
    const detail =
      due > 0 && completed <= due
        ? `${completed} of ${due} tasks completed (${Math.round(
            (completed / due) * 100
          )}%)`
        : `${completed} ${completed === 1 ? "task" : "tasks"} completed this period`;
    wins.push({
      title: "Strong task completion rate",
      detail,
      source: "Basecamp",
    });
  }

  // GSC clicks up >10%
  if (input.gscClicksCurrent !== null && input.gscClicksPrevious !== null && input.gscClicksPrevious > 0) {
    const change = pctChange(input.gscClicksCurrent, input.gscClicksPrevious);
    if (change > 10) {
      wins.push({
        title: "Organic clicks trending up",
        detail: `${fmtNum(input.gscClicksCurrent)} clicks (${fmtPct(change)} vs previous period)`,
        source: "GSC",
      });
    }
  }

  // GSC average position improved
  if (input.gscAvgPositionCurrent !== null && input.gscAvgPositionPrevious !== null) {
    const improvement = input.gscAvgPositionPrevious - input.gscAvgPositionCurrent;
    if (improvement > 1) {
      wins.push({
        title: "Search rankings improved",
        detail: `Average position improved by ${improvement.toFixed(1)} (${input.gscAvgPositionCurrent.toFixed(1)} now vs ${input.gscAvgPositionPrevious.toFixed(1)} before)`,
        source: "GSC",
      });
    }
  }

  // GA4 organic sessions up >10%
  if (input.ga4OrganicCurrent !== null && input.ga4OrganicPrevious !== null && input.ga4OrganicPrevious > 0) {
    const change = pctChange(input.ga4OrganicCurrent, input.ga4OrganicPrevious);
    if (change > 10) {
      wins.push({
        title: "Organic sessions growing",
        detail: `${fmtNum(input.ga4OrganicCurrent)} organic sessions (${fmtPct(change)} vs previous period)`,
        source: "GA4",
      });
    }
  }

  // GA4 overall sessions up
  if (input.ga4SessionsCurrent !== null && input.ga4SessionsPrevious !== null && input.ga4SessionsPrevious > 0) {
    const change = pctChange(input.ga4SessionsCurrent, input.ga4SessionsPrevious);
    if (change > 10) {
      wins.push({
        title: "Total traffic increased",
        detail: `${fmtNum(input.ga4SessionsCurrent)} sessions (${fmtPct(change)} vs previous period)`,
        source: "GA4",
      });
    }
  }

  // BrightLocal rankings net positive
  if (input.blRankingsUp !== null && input.blRankingsDown !== null) {
    const net = input.blRankingsUp - input.blRankingsDown;
    if (net > 0 && input.blRankingsUp > input.blRankingsDown * 1.5) {
      wins.push({
        title: "Local rankings improving",
        detail: `${input.blRankingsUp} rankings up vs ${input.blRankingsDown} down (net +${net})`,
        source: "BrightLocal",
      });
    }
  }

  // Good review rating
  if (input.blReviewRating !== null && input.blReviewRating >= 4.5 && input.blTotalReviews !== null && input.blTotalReviews > 10) {
    wins.push({
      title: "Excellent review reputation",
      detail: `${input.blReviewRating} star average across ${input.blTotalReviews} reviews`,
      source: "BrightLocal",
    });
  }

  // Strong citation count
  if (input.blCitations !== null && input.blCitations > 100) {
    wins.push({
      title: "Strong citation presence",
      detail: `${fmtNum(input.blCitations)} live citations across tracked locations`,
      source: "BrightLocal",
    });
  }

  return wins.slice(0, 5);
}

export function detectFlags(input: DetectionInput): DetectedItem[] {
  const flags: DetectedItem[] = [];

  // Overdue tasks
  if (input.overdueTasks.length > 0) {
    const oldest = input.overdueTasks
      .filter((t) => t.due_on)
      .sort((a, b) => (a.due_on || "").localeCompare(b.due_on || ""));
    const daysOverdue = oldest.length > 0
      ? Math.floor((Date.now() - new Date(oldest[0].due_on!).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    flags.push({
      title: `${input.overdueTasks.length} overdue task${input.overdueTasks.length > 1 ? "s" : ""}`,
      detail: daysOverdue > 0
        ? `Oldest overdue by ${daysOverdue} days: "${oldest[0].title.substring(0, 50)}"`
        : input.overdueTasks.map((t) => t.title.substring(0, 40)).join(", "),
      source: "Basecamp",
      severity: input.overdueTasks.length > 3 ? "high" : "medium",
    });
  }

  // GSC clicks down >10%
  if (input.gscClicksCurrent !== null && input.gscClicksPrevious !== null && input.gscClicksPrevious > 0) {
    const change = pctChange(input.gscClicksCurrent, input.gscClicksPrevious);
    if (change < -10) {
      flags.push({
        title: "Organic clicks declining",
        detail: `${fmtNum(input.gscClicksCurrent)} clicks (${fmtPct(change)} vs previous period)`,
        source: "GSC",
        severity: change < -25 ? "high" : "medium",
      });
    }
  }

  // Average position worsened by >2
  if (input.gscAvgPositionCurrent !== null && input.gscAvgPositionPrevious !== null) {
    const worsened = input.gscAvgPositionCurrent - input.gscAvgPositionPrevious;
    if (worsened > 2) {
      flags.push({
        title: "Search rankings dropped",
        detail: `Average position worsened by ${worsened.toFixed(1)} (now ${input.gscAvgPositionCurrent.toFixed(1)})`,
        source: "GSC",
        severity: worsened > 5 ? "high" : "medium",
      });
    }
  }

  // CTR dropped
  if (input.gscCtrCurrent !== null && input.gscCtrPrevious !== null && input.gscCtrPrevious > 0) {
    const change = pctChange(input.gscCtrCurrent, input.gscCtrPrevious);
    if (change < -15) {
      flags.push({
        title: "Click-through rate declining",
        detail: `CTR at ${(input.gscCtrCurrent * 100).toFixed(1)}% (${fmtPct(change)} vs previous period)`,
        source: "GSC",
        severity: "medium",
      });
    }
  }

  // GA4 organic sessions down >10%
  if (input.ga4OrganicCurrent !== null && input.ga4OrganicPrevious !== null && input.ga4OrganicPrevious > 0) {
    const change = pctChange(input.ga4OrganicCurrent, input.ga4OrganicPrevious);
    if (change < -10) {
      flags.push({
        title: "Organic sessions declining",
        detail: `${fmtNum(input.ga4OrganicCurrent)} organic sessions (${fmtPct(change)} vs previous period)`,
        source: "GA4",
        severity: change < -25 ? "high" : "medium",
      });
    }
  }

  // BrightLocal rankings net negative
  if (input.blRankingsUp !== null && input.blRankingsDown !== null) {
    if (input.blRankingsDown > input.blRankingsUp) {
      flags.push({
        title: "Local rankings declining",
        detail: `${input.blRankingsDown} rankings down vs ${input.blRankingsUp} up (net -${input.blRankingsDown - input.blRankingsUp})`,
        source: "BrightLocal",
        severity: input.blRankingsDown > input.blRankingsUp * 2 ? "high" : "medium",
      });
    }
  }

  // Poor average Google rank
  if (input.blAvgGoogleRank !== null && input.blAvgGoogleRank > 10) {
    flags.push({
      title: "Weak local search visibility",
      detail: `Average Google rank of ${input.blAvgGoogleRank} — aim for under 5`,
      source: "BrightLocal",
      severity: input.blAvgGoogleRank > 20 ? "high" : "medium",
    });
  }

  // Low review rating
  if (input.blReviewRating !== null && input.blReviewRating > 0 && input.blReviewRating < 4.0) {
    flags.push({
      title: "Review rating below 4.0",
      detail: `Current rating: ${input.blReviewRating} stars — needs attention`,
      source: "BrightLocal",
      severity: "high",
    });
  }

  return flags.slice(0, 5);
}
