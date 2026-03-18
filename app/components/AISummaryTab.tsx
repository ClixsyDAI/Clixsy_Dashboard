"use client";

import { useState, useMemo, useCallback } from "react";
import { calculateHealthScore, type HealthScoreResult } from "../lib/health-score";
import { detectWins, detectFlags, type DetectedItem } from "../lib/win-flag-detection";

// ── Types ─────────────────────────────────────────────────────

interface GscDailyRow { date: string; clicks: number; impressions: number; ctr: number; position: number }
interface GscQuery { query: string; clicks: number; impressions: number; ctr: number; position: number }
interface Ga4DailyRow { date: string; sessions: number; users: number; screenPageViews: number }
interface Ga4Channel { channel: string; sessions: number; users: number }
interface Todo {
  id: number; title: string; list_title: string; completed: boolean;
  due_on: string | null; created_at: string; completed_on: string | null;
  comments_count: number; assignees: string; description: string;
}

interface AISummaryTabProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
  todos: Todo[];
  gscDaily: GscDailyRow[] | null;
  gscTopQueries: GscQuery[] | null;
  ga4Daily: Ga4DailyRow[] | null;
  ga4Channels: Ga4Channel[] | null;
  ga4OrganicSessions: number | null;
  blLocations: number | null;
  blRankingsUp: number | null;
  blRankingsDown: number | null;
  blAvgGoogleRank: number | null;
  blCitations: number | null;
  blReviewRating: number | null;
  blTotalReviews: number | null;
  blGmbCalls: number | null;
}

interface AIResponse {
  aiSummary: string;
  completedTasks: Array<{ title: string; list_title: string; completed_on: string; assignees: string }>;
}

// ── Helpers ───────────────────────────────────────────────────

function getDefaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
}

function filterByDateRange<T extends { date: string }>(data: T[], start: string, end: string): T[] {
  const s = new Date(start);
  const e = new Date(end);
  return data.filter((d) => { const dt = new Date(d.date); return dt >= s && dt <= e; });
}

function getPreviousPeriod(start: string, end: string): { start: string; end: string } {
  const s = new Date(start);
  const e = new Date(end);
  const days = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  const prevEnd = new Date(s);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days);
  return { start: prevStart.toISOString().split("T")[0], end: prevEnd.toISOString().split("T")[0] };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function stripHtml(text: string): string {
  if (!text) return "";
  return text.replace(new RegExp("<bc-attachment[^>]*>.*?</bc-attachment>", "gs"), "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// ── Sparkline SVG ─────────────────────────────────────────────

function Sparkline({ data, color = "#C8A882", height = 24, width = 80 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Weekly aggregation ────────────────────────────────────────

function aggregateWeekly(data: { date: string; value: number }[]): number[] {
  const weeks = new Map<string, number>();
  for (const d of data) {
    const dt = new Date(d.date);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(dt);
    monday.setDate(diff);
    const key = monday.toISOString().split("T")[0];
    weeks.set(key, (weeks.get(key) || 0) + d.value);
  }
  return Array.from(weeks.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

// ── Main Component ────────────────────────────────────────────

export default function AISummaryTab(props: AISummaryTabProps) {
  const defaults = getDefaultRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiData, setAiData] = useState<AIResponse | null>(null);
  const [showFullReport, setShowFullReport] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);

  // ── Derived data (recalculates on date range change) ──────

  const computed = useMemo(() => {
    const prev = getPreviousPeriod(startDate, endDate);

    // Tasks
    const completedInPeriod = props.todos.filter((t) => {
      if (!t.completed || !t.completed_on) return false;
      const d = new Date(t.completed_on);
      return d >= new Date(startDate) && d <= new Date(endDate);
    });
    const completedPrevPeriod = props.todos.filter((t) => {
      if (!t.completed || !t.completed_on) return false;
      const d = new Date(t.completed_on);
      return d >= new Date(prev.start) && d <= new Date(prev.end);
    });
    const openTasks = props.todos.filter((t) => !t.completed);
    const overdueTasks = openTasks.filter((t) => t.due_on && new Date(t.due_on) < new Date());
    const tasksDueInPeriod = props.todos.filter((t) => {
      if (!t.due_on) return false;
      const d = new Date(t.due_on);
      return d >= new Date(startDate) && d <= new Date(endDate);
    }).length;

    // GSC
    let gscCurrent = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    let gscPrevious = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    let gscWeeklyClicks: number[] = [];
    if (props.gscDaily) {
      const cur = filterByDateRange(props.gscDaily, startDate, endDate);
      const prv = filterByDateRange(props.gscDaily, prev.start, prev.end);
      gscCurrent = {
        clicks: cur.reduce((s, d) => s + d.clicks, 0),
        impressions: cur.reduce((s, d) => s + d.impressions, 0),
        ctr: cur.length > 0 ? cur.reduce((s, d) => s + d.ctr, 0) / cur.length : 0,
        position: cur.length > 0 ? cur.reduce((s, d) => s + d.position, 0) / cur.length : 0,
      };
      gscPrevious = {
        clicks: prv.reduce((s, d) => s + d.clicks, 0),
        impressions: prv.reduce((s, d) => s + d.impressions, 0),
        ctr: prv.length > 0 ? prv.reduce((s, d) => s + d.ctr, 0) / prv.length : 0,
        position: prv.length > 0 ? prv.reduce((s, d) => s + d.position, 0) / prv.length : 0,
      };
      gscWeeklyClicks = aggregateWeekly(cur.map((d) => ({ date: d.date, value: d.clicks })));
    }

    // GA4
    let ga4Current = { sessions: 0, users: 0 };
    let ga4Previous = { sessions: 0, users: 0 };
    let ga4WeeklySessions: number[] = [];
    if (props.ga4Daily) {
      const cur = filterByDateRange(props.ga4Daily, startDate, endDate);
      const prv = filterByDateRange(props.ga4Daily, prev.start, prev.end);
      ga4Current = {
        sessions: cur.reduce((s, d) => s + d.sessions, 0),
        users: cur.reduce((s, d) => s + d.users, 0),
      };
      ga4Previous = {
        sessions: prv.reduce((s, d) => s + d.sessions, 0),
        users: prv.reduce((s, d) => s + d.users, 0),
      };
      ga4WeeklySessions = aggregateWeekly(cur.map((d) => ({ date: d.date, value: d.sessions })));
    }

    // Task weekly completions
    const taskWeekly = aggregateWeekly(
      completedInPeriod.map((t) => ({ date: t.completed_on!.split("T")[0], value: 1 }))
    );

    // Category breakdown
    const catMap = new Map<string, number>();
    for (const t of completedInPeriod) {
      const cat = t.list_title.replace(/:$/, "").trim();
      catMap.set(cat, (catMap.get(cat) || 0) + 1);
    }
    const categories = Array.from(catMap.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));

    // Upcoming tasks
    const upcoming = openTasks
      .filter((t) => t.due_on)
      .sort((a, b) => (a.due_on || "").localeCompare(b.due_on || ""))
      .slice(0, 7);

    // Health score
    const healthScore = calculateHealthScore({
      tasksDueInPeriod,
      tasksCompletedInPeriod: completedInPeriod.length,
      overdueCount: overdueTasks.length,
      gscClicksCurrent: props.gscDaily ? gscCurrent.clicks : null,
      gscClicksPrevious: props.gscDaily ? gscPrevious.clicks : null,
      ga4OrganicCurrent: props.ga4Daily && props.ga4OrganicSessions !== null ? props.ga4OrganicSessions : null,
      ga4OrganicPrevious: props.ga4Daily ? ga4Previous.sessions : null,
      blRankingsUp: props.blRankingsUp,
      blRankingsDown: props.blRankingsDown,
      blAvgGoogleRank: props.blAvgGoogleRank,
      blReviewRating: props.blReviewRating,
    });

    // Wins & flags
    const wins = detectWins({
      tasksCompletedInPeriod: completedInPeriod.length,
      tasksDueInPeriod,
      overdueTasks: overdueTasks.map((t) => ({ title: stripHtml(t.title), due_on: t.due_on })),
      completionRate: tasksDueInPeriod > 0 ? completedInPeriod.length / tasksDueInPeriod : completedInPeriod.length > 0 ? 0.9 : 0,
      gscClicksCurrent: props.gscDaily ? gscCurrent.clicks : null,
      gscClicksPrevious: props.gscDaily ? gscPrevious.clicks : null,
      gscAvgPositionCurrent: props.gscDaily && gscCurrent.position > 0 ? gscCurrent.position : null,
      gscAvgPositionPrevious: props.gscDaily && gscPrevious.position > 0 ? gscPrevious.position : null,
      gscCtrCurrent: props.gscDaily ? gscCurrent.ctr : null,
      gscCtrPrevious: props.gscDaily ? gscPrevious.ctr : null,
      ga4SessionsCurrent: props.ga4Daily ? ga4Current.sessions : null,
      ga4SessionsPrevious: props.ga4Daily ? ga4Previous.sessions : null,
      ga4OrganicCurrent: props.ga4OrganicSessions,
      ga4OrganicPrevious: props.ga4Daily ? ga4Previous.sessions : null,
      blRankingsUp: props.blRankingsUp,
      blRankingsDown: props.blRankingsDown,
      blAvgGoogleRank: props.blAvgGoogleRank,
      blReviewRating: props.blReviewRating,
      blTotalReviews: props.blTotalReviews,
      blCitations: props.blCitations,
      blGmbCalls: props.blGmbCalls,
    });

    const flags = detectFlags({
      tasksCompletedInPeriod: completedInPeriod.length,
      tasksDueInPeriod,
      overdueTasks: overdueTasks.map((t) => ({ title: stripHtml(t.title), due_on: t.due_on })),
      completionRate: tasksDueInPeriod > 0 ? completedInPeriod.length / tasksDueInPeriod : 0,
      gscClicksCurrent: props.gscDaily ? gscCurrent.clicks : null,
      gscClicksPrevious: props.gscDaily ? gscPrevious.clicks : null,
      gscAvgPositionCurrent: props.gscDaily && gscCurrent.position > 0 ? gscCurrent.position : null,
      gscAvgPositionPrevious: props.gscDaily && gscPrevious.position > 0 ? gscPrevious.position : null,
      gscCtrCurrent: props.gscDaily ? gscCurrent.ctr : null,
      gscCtrPrevious: props.gscDaily ? gscPrevious.ctr : null,
      ga4SessionsCurrent: props.ga4Daily ? ga4Current.sessions : null,
      ga4SessionsPrevious: props.ga4Daily ? ga4Previous.sessions : null,
      ga4OrganicCurrent: props.ga4OrganicSessions,
      ga4OrganicPrevious: props.ga4Daily ? ga4Previous.sessions : null,
      blRankingsUp: props.blRankingsUp,
      blRankingsDown: props.blRankingsDown,
      blAvgGoogleRank: props.blAvgGoogleRank,
      blReviewRating: props.blReviewRating,
      blTotalReviews: props.blTotalReviews,
      blCitations: props.blCitations,
      blGmbCalls: props.blGmbCalls,
    });

    return {
      completedInPeriod,
      completedPrevPeriod,
      openTasks,
      overdueTasks,
      gscCurrent,
      gscPrevious,
      ga4Current,
      ga4Previous,
      gscWeeklyClicks,
      ga4WeeklySessions,
      taskWeekly,
      categories,
      upcoming,
      healthScore,
      wins,
      flags,
    };
  }, [startDate, endDate, props]);

  // ── AI Generation ─────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: props.projectId, startDate, endDate }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const result = await res.json();
      setAiData(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }, [props.projectId, startDate, endDate]);

  // ── Presets ────────────────────────────────────────────────

  const presets = [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
    { label: "This Month", fn: () => {
      const now = new Date();
      return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0], end: now.toISOString().split("T")[0] };
    }},
    { label: "Last Month", fn: () => {
      const now = new Date();
      return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0], end: new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0] };
    }},
  ];

  const applyPreset = (p: typeof presets[number]) => {
    if ("fn" in p && p.fn) {
      const r = p.fn();
      setStartDate(r.start);
      setEndDate(r.end);
    } else if ("days" in p) {
      const e = new Date();
      const s = new Date();
      s.setDate(s.getDate() - p.days);
      setStartDate(s.toISOString().split("T")[0]);
      setEndDate(e.toISOString().split("T")[0]);
    }
    setAiData(null);
  };

  const { completedInPeriod, overdueTasks, gscCurrent, gscPrevious, ga4Current, ga4Previous, gscWeeklyClicks, ga4WeeklySessions, taskWeekly, categories, upcoming, healthScore, wins, flags } = computed;

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Client Context Bar */}
      <div className="flex flex-wrap items-center gap-4 text-base" style={{ color: "#888" }}>
        <span>Total tasks: <strong style={{ color: "#f0ede8" }}>{props.todos.length}</strong></span>
        {props.blLocations && props.blLocations > 0 && (
          <span>Locations: <strong style={{ color: "#f0ede8" }}>{props.blLocations}</strong></span>
        )}
        <span>{props.projectDescription}</span>
      </div>

      {/* Date Range Picker */}
      <div className="rounded-sm p-4 flex flex-wrap items-end gap-3" style={{ backgroundColor: "#111" }}>
        <div>
          <label className="block text-sm uppercase tracking-widest mb-1" style={{ color: "#666" }}>From</label>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setAiData(null); }}
            className="rounded-sm px-2.5 py-1.5 text-sm outline-none" style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #333" }} />
        </div>
        <div>
          <label className="block text-sm uppercase tracking-widest mb-1" style={{ color: "#666" }}>To</label>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setAiData(null); }}
            className="rounded-sm px-2.5 py-1.5 text-sm outline-none" style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #333" }} />
        </div>
        <div className="flex gap-1">
          {presets.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className="rounded-sm px-2.5 py-1.5 text-sm uppercase tracking-wide hover:text-white transition-colors"
              style={{ backgroundColor: "#1a1a1a", color: "#888", border: "1px solid #333" }}>
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={handleGenerate} disabled={aiLoading}
          className="ml-auto rounded-sm px-5 py-1.5 text-sm font-semibold tracking-wide transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}>
          {aiLoading ? "Analyzing..." : aiData ? "Regenerate" : "Generate Report"}
        </button>
      </div>

      {/* Section 1: Health Score */}
      <div className="rounded-sm p-5 flex flex-col items-center" style={{ backgroundColor: "#111" }}>
        <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
          <svg viewBox="0 0 120 120" width="120" height="120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#222" strokeWidth="8" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={healthScore.color} strokeWidth="8"
              strokeDasharray={`${(healthScore.overall / 100) * 327} 327`}
              strokeLinecap="round" transform="rotate(-90 60 60)" style={{ transition: "stroke-dasharray 0.5s ease" }} />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="text-3xl font-bold" style={{ color: healthScore.color }}>{healthScore.overall}</span>
          </div>
        </div>
        <span className="mt-2 text-base font-semibold" style={{ color: healthScore.color }}>
          Account Health: {healthScore.label}
        </span>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {healthScore.subScores.filter((s) => s.available).map((s) => (
            <span key={s.id} className="rounded-sm px-2 py-0.5 text-sm tracking-wide"
              style={{ backgroundColor: "#1a1a1a", color: s.score >= 70 ? "#2d6a4f" : s.score >= 40 ? "#C8A882" : "#e74c3c" }}>
              {s.label}: {s.score}
            </span>
          ))}
        </div>
      </div>

      {/* Section 2: Headline Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="TASKS COMPLETED" value={completedInPeriod.length}
          change={pctChange(completedInPeriod.length, computed.completedPrevPeriod.length)}
          sparkData={taskWeekly} />
        <MetricCard label="TASKS OPEN" value={computed.openTasks.length} />
        <MetricCard label="OVERDUE" value={overdueTasks.length}
          valueColor={overdueTasks.length > 0 ? "#e74c3c" : undefined} />
        {props.gscDaily && (
          <MetricCard label="GSC CLICKS" value={gscCurrent.clicks}
            change={pctChange(gscCurrent.clicks, gscPrevious.clicks)}
            sparkData={gscWeeklyClicks} accent />
        )}
        {props.ga4Daily && (
          <MetricCard label="SESSIONS" value={ga4Current.sessions}
            change={pctChange(ga4Current.sessions, ga4Previous.sessions)}
            sparkData={ga4WeeklySessions} accent />
        )}
        {props.blRankingsUp !== null && (
          <MetricCard label="NET RANKINGS" value={(props.blRankingsUp || 0) - (props.blRankingsDown || 0)}
            prefix={((props.blRankingsUp || 0) - (props.blRankingsDown || 0)) > 0 ? "+" : ""}
            valueColor={((props.blRankingsUp || 0) > (props.blRankingsDown || 0)) ? "#2d6a4f" : "#e74c3c"} />
        )}
      </div>

      {/* Section 3 & 4: Wins & Flags */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Wins */}
        <div className="rounded-sm p-4" style={{ backgroundColor: "#111" }}>
          <h3 className="text-base font-semibold tracking-widest uppercase mb-3" style={{ color: "#2d6a4f" }}>
            Top Wins This Period
          </h3>
          {wins.length > 0 ? wins.map((w, i) => (
            <ItemCard key={i} item={w} type="win" />
          )) : (
            <p className="text-sm py-4 text-center" style={{ color: "#666" }}>No standout wins detected — generate report for deeper analysis</p>
          )}
        </div>
        {/* Flags */}
        <div className="rounded-sm p-4" style={{ backgroundColor: "#111" }}>
          <h3 className="text-base font-semibold tracking-widest uppercase mb-3" style={{ color: "#e74c3c" }}>
            Flags &amp; Watch Items
          </h3>
          {flags.length > 0 ? flags.map((f, i) => (
            <ItemCard key={i} item={f} type="flag" />
          )) : (
            <p className="text-sm py-4 text-center" style={{ color: "#666" }}>No major concerns detected</p>
          )}
        </div>
      </div>

      {/* Section 5: Work Summary */}
      <div className="rounded-sm p-4" style={{ backgroundColor: "#111" }}>
        <h3 className="text-base font-semibold tracking-widest uppercase mb-3" style={{ color: "#f0ede8" }}>
          Work Completed This Period
        </h3>
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <span className="text-base" style={{ color: "#f0ede8" }}>
            <strong>{completedInPeriod.length}</strong> tasks completed across <strong>{categories.length}</strong> work categories
          </span>
        </div>
        {/* Category breakdown */}
        {categories.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {categories.map((c) => {
              const pct = completedInPeriod.length > 0 ? (c.count / completedInPeriod.length) * 100 : 0;
              return (
                <div key={c.name} className="flex items-center gap-2">
                  <span className="text-sm w-44 truncate" style={{ color: "#888" }}>{c.name}</span>
                  <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ backgroundColor: "#1a1a1a" }}>
                    <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: "#C8A882", transition: "width 0.3s" }} />
                  </div>
                  <span className="text-sm w-6 text-right" style={{ color: "#C8A882" }}>{c.count}</span>
                </div>
              );
            })}
          </div>
        )}
        {/* Weekly heatmap */}
        {taskWeekly.length > 1 && (
          <div className="flex items-end gap-1 mt-2">
            <span className="text-sm uppercase tracking-wide mr-1" style={{ color: "#666" }}>Weekly:</span>
            {taskWeekly.map((v, i) => {
              const max = Math.max(...taskWeekly);
              const h = max > 0 ? Math.max(4, (v / max) * 24) : 4;
              return (
                <div key={i} className="rounded-sm" title={`${v} tasks`}
                  style={{ width: 16, height: h, backgroundColor: v > 0 ? "#C8A882" : "#222", transition: "height 0.3s" }} />
              );
            })}
          </div>
        )}
        {/* Collapsible task list */}
        {completedInPeriod.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowAllTasks(!showAllTasks)}
              className="text-sm uppercase tracking-widest hover:text-white transition-colors"
              style={{ color: "#C8A882" }}>
              {showAllTasks ? "Hide" : "View"} All {completedInPeriod.length} Tasks {showAllTasks ? "\u25B2" : "\u25BC"}
            </button>
            {showAllTasks && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "#1a1a1a" }}>
                      <th className="px-2 py-1.5 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Task</th>
                      <th className="px-2 py-1.5 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Category</th>
                      <th className="px-2 py-1.5 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Completed</th>
                      <th className="px-2 py-1.5 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Assigned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedInPeriod.map((t, i) => (
                      <tr key={t.id} style={{ backgroundColor: i % 2 === 0 ? "#111" : "#161616" }}>
                        <td className="px-2 py-1.5 text-sm" style={{ color: "#f0ede8" }}>{stripHtml(t.title).substring(0, 60)}</td>
                        <td className="px-2 py-1.5 text-sm" style={{ color: "#C8A882" }}>{t.list_title.replace(/:$/, "")}</td>
                        <td className="px-2 py-1.5 text-sm" style={{ color: "#888" }}>
                          {t.completed_on ? new Date(t.completed_on).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-"}
                        </td>
                        <td className="px-2 py-1.5 text-sm" style={{ color: "#888" }}>{t.assignees?.substring(0, 25)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 6: Coming Up Next */}
      <div className="rounded-sm p-4" style={{ backgroundColor: "#111" }}>
        <h3 className="text-base font-semibold tracking-widest uppercase mb-3" style={{ color: "#f0ede8" }}>
          Coming Up Next
        </h3>
        {computed.upcoming.length > 0 ? (
          <div className="space-y-1">
            {computed.upcoming.map((t) => {
              const isOverdue = t.due_on && new Date(t.due_on) < new Date();
              return (
                <div key={t.id} className="flex items-center gap-3 py-1.5 px-2 rounded-sm" style={{ backgroundColor: "#1a1a1a" }}>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: isOverdue ? "#e74c3c" : "#C8A882" }} />
                  <span className="flex-1 text-base truncate" style={{ color: "#f0ede8" }}>{stripHtml(t.title)}</span>
                  <span className="text-sm" style={{ color: "#888" }}>{t.assignees?.split(",")[0]}</span>
                  <span className="text-sm whitespace-nowrap" style={{ color: isOverdue ? "#e74c3c" : "#888" }}>
                    {t.due_on ? new Date(t.due_on).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No date"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm py-2" style={{ color: "#666" }}>No upcoming tasks with due dates</p>
        )}

        {/* AI Recommendations (after generation) */}
        {aiData && (
          <div className="mt-4 pt-3" style={{ borderTop: "1px solid #222" }}>
            <h4 className="text-sm font-semibold tracking-widest uppercase mb-2" style={{ color: "#C8A882" }}>
              Recommended Next Steps
            </h4>
            <div className="text-sm" style={{ color: "#ccc" }}
              dangerouslySetInnerHTML={{ __html: extractRecommendations(aiData.aiSummary) }} />
          </div>
        )}
      </div>

      {/* AI Loading */}
      {aiLoading && (
        <div className="flex items-center justify-center gap-3 py-8 rounded-sm" style={{ backgroundColor: "#111" }}>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "#C8A882", borderTopColor: "transparent" }} />
          <span className="text-sm" style={{ color: "#888" }}>Generating analysis...</span>
        </div>
      )}

      {/* AI Error */}
      {aiError && (
        <div className="rounded-sm p-3" style={{ backgroundColor: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.3)" }}>
          <p className="text-sm" style={{ color: "#e74c3c" }}>{aiError}</p>
        </div>
      )}

      {/* Full AI Report (collapsible) */}
      {aiData && !aiLoading && (
        <div className="rounded-sm" style={{ backgroundColor: "#111" }}>
          <button onClick={() => setShowFullReport(!showFullReport)}
            className="w-full flex items-center justify-between p-4 text-left hover:opacity-90 transition-opacity">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-widest uppercase" style={{ color: "#f0ede8" }}>Full Performance Report</span>
            </div>
            <span className="text-sm" style={{ color: "#888" }}>{showFullReport ? "\u25B2 Collapse" : "\u25BC Expand"}</span>
          </button>
          {showFullReport && (
            <div className="px-4 pb-4">
              <div className="text-base leading-relaxed" style={{ color: "#ccc" }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(aiData.aiSummary) }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────

function MetricCard({ label, value, change, sparkData, accent, valueColor, prefix = "" }: {
  label: string; value: number; change?: number | null; sparkData?: number[];
  accent?: boolean; valueColor?: string; prefix?: string;
}) {
  return (
    <div className="rounded-sm p-3 flex flex-col items-center" style={{ backgroundColor: "#111" }}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold" style={{ color: valueColor || (accent ? "#C8A882" : "#fff") }}>
          {prefix}{value.toLocaleString()}
        </span>
        {change !== null && change !== undefined && (
          <span className="text-sm font-medium" style={{ color: change > 0 ? "#2d6a4f" : change < 0 ? "#e74c3c" : "#666" }}>
            {change > 0 ? "\u25B2" : change < 0 ? "\u25BC" : ""}{Math.abs(change).toFixed(0)}%
          </span>
        )}
      </div>
      {sparkData && sparkData.length > 1 && (
        <div className="mt-1">
          <Sparkline data={sparkData} color={accent ? "#C8A882" : "#555"} width={60} height={16} />
        </div>
      )}
      <span className="mt-1.5 text-xs tracking-widest uppercase" style={{ color: "#666" }}>{label}</span>
    </div>
  );
}

function ItemCard({ item, type }: { item: DetectedItem; type: "win" | "flag" }) {
  const color = type === "win" ? "#2d6a4f" : item.severity === "high" ? "#e74c3c" : "#C8A882";
  const badges: Record<string, string> = { Basecamp: "#444", GSC: "#1a73e8", GA4: "#e37400", BrightLocal: "#34a853" };
  return (
    <div className="mb-2.5 rounded-sm p-3" style={{ backgroundColor: "#1a1a1a", borderLeft: `3px solid ${color}` }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-medium" style={{ color: "#f0ede8" }}>{item.title}</span>
        <span className="text-xs px-1.5 py-0.5 rounded-sm whitespace-nowrap"
          style={{ backgroundColor: badges[item.source] || "#333", color: "#fff" }}>
          {item.source}
        </span>
      </div>
      <p className="mt-1 text-sm" style={{ color: "#999" }}>{item.detail}</p>
    </div>
  );
}

// ── Markdown Helpers ──────────────────────────────────────────

function extractRecommendations(md: string): string {
  const match = md.match(/## Recommendations\s*([\s\S]*?)(?=##|$)/);
  if (!match) return "";
  return renderMarkdown(match[1].trim());
}

function renderMarkdown(md: string): string {
  if (!md) return "";
  return md
    .replace(/^## (.*$)/gm, '<h2 style="color:#f0ede8;font-size:18px;font-weight:700;margin-top:20px;margin-bottom:8px">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 style="color:#C8A882;font-size:16px;font-weight:600;margin-top:14px;margin-bottom:6px">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f0ede8">$1</strong>')
    .replace(/^- (.*$)/gm, '<li style="margin-left:16px;margin-bottom:4px;list-style-type:disc;color:#ccc;font-size:15px">$1</li>')
    .replace(/^\d+\. (.*$)/gm, '<li style="margin-left:16px;margin-bottom:4px;list-style-type:decimal;color:#ccc;font-size:15px">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}
