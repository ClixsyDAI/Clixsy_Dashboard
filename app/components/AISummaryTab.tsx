"use client";

import { useState } from "react";

interface AISummaryTabProps {
  projectId: string;
  projectName: string;
}

interface SummaryResponse {
  dateRange: { start: string; end: string };
  stats: {
    tasksCompleted: number;
    tasksOpen: number;
    tasksOverdue: number;
    totalTasks: number;
    gscClicks: number;
    gscImpressions: number;
    gscAvgPosition: number;
    ga4Sessions: number;
    ga4Users: number;
    ga4OrganicSessions: number;
    blLocations: number;
    blRankingsUp: number;
    blRankingsDown: number;
    blCitations: number;
  };
  completedTasks: Array<{
    title: string;
    list_title: string;
    completed_on: string;
    assignees: string;
  }>;
  aiSummary: string;
}

function getDefaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export default function AISummaryTab({ projectId, projectName }: AISummaryTabProps) {
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SummaryResponse | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, startDate, endDate }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const presets = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
    { label: "This month", fn: () => {
      const now = new Date();
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }},
    { label: "Last month", fn: () => {
      const now = new Date();
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0],
        end: new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0],
      };
    }},
  ];

  const applyPreset = (preset: typeof presets[number]) => {
    if ("fn" in preset && preset.fn) {
      const range = preset.fn();
      setStartDate(range.start);
      setEndDate(range.end);
    } else if ("days" in preset) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - preset.days);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    }
  };

  return (
    <div>
      {/* Date Range Selector */}
      <div className="rounded-sm p-5" style={{ backgroundColor: "#111111" }}>
        <h3 className="text-sm font-semibold tracking-wide mb-4" style={{ color: "#f0ede8" }}>
          SELECT REPORTING PERIOD
        </h3>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: "#888" }}>
              From
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-sm px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #333" }}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: "#888" }}>
              To
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-sm px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #333" }}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="rounded-sm px-6 py-2 text-sm font-semibold tracking-wide transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
          >
            {loading ? "Analyzing..." : "Generate Report"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="rounded-sm px-3 py-1 text-[10px] uppercase tracking-wide transition-all hover:text-white"
              style={{ backgroundColor: "#1a1a1a", color: "#888", border: "1px solid #333" }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="mt-8 flex flex-col items-center justify-center py-16" style={{ backgroundColor: "#111111" }}>
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "#C8A882", borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: "#888" }}>
            Analyzing {projectName} data...
          </p>
          <p className="mt-1 text-xs" style={{ color: "#666" }}>
            Gathering tasks, search data, and local SEO metrics
          </p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mt-6 rounded-sm p-4" style={{ backgroundColor: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.3)" }}>
          <p className="text-sm" style={{ color: "#e74c3c" }}>{error}</p>
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="mt-6 space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <StatCard value={data.stats.tasksCompleted.toString()} label="TASKS COMPLETED" />
            <StatCard value={data.stats.tasksOpen.toString()} label="TASKS OPEN" />
            {data.stats.tasksOverdue > 0 && (
              <StatCard value={data.stats.tasksOverdue.toString()} label="OVERDUE" color="#e74c3c" />
            )}
            {data.stats.gscClicks > 0 && (
              <StatCard value={data.stats.gscClicks.toLocaleString()} label="GSC CLICKS" accent />
            )}
            {data.stats.ga4Sessions > 0 && (
              <StatCard value={data.stats.ga4Sessions.toLocaleString()} label="SESSIONS" accent />
            )}
            {data.stats.blRankingsUp > 0 && (
              <StatCard value={`+${data.stats.blRankingsUp}`} label="RANKINGS UP" color="#2d6a4f" />
            )}
          </div>

          {/* AI Summary */}
          <div className="rounded-sm p-6" style={{ backgroundColor: "#111111" }}>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}>
                AI
              </div>
              <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                AI PERFORMANCE ANALYSIS
              </h3>
              <span className="ml-auto text-[10px]" style={{ color: "#666" }}>
                {data.dateRange.start} to {data.dateRange.end}
              </span>
            </div>
            <div
              className="prose prose-invert prose-sm max-w-none"
              style={{ color: "#ccc" }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(data.aiSummary) }}
            />
          </div>

          {/* Completed Tasks List */}
          {data.completedTasks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                COMPLETED TASKS IN PERIOD ({data.completedTasks.length})
              </h3>
              <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ backgroundColor: "#1a1a1a" }}>
                      <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Task</th>
                      <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Tasklist</th>
                      <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Completed</th>
                      <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Assigned to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.completedTasks.map((t, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}>
                        <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8" }}>{t.title}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: "#C8A882" }}>{t.list_title}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: "#888" }}>
                          {t.completed_on ? new Date(t.completed_on).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-"}
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: "#888" }}>{t.assignees}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="mt-12 flex flex-col items-center justify-center py-16" style={{ backgroundColor: "#111111" }}>
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(200,168,130,0.1)" }}>
            <span className="text-xl" style={{ color: "#C8A882" }}>AI</span>
          </div>
          <h3 className="text-sm font-semibold" style={{ color: "#f0ede8" }}>
            AI Performance Report
          </h3>
          <p className="mt-2 text-xs text-center max-w-sm" style={{ color: "#888" }}>
            Select a date range and click &ldquo;Generate Report&rdquo; to get an AI-powered analysis of this client&apos;s performance across all data sources.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label, accent = false, color }: { value: string; label: string; accent?: boolean; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm px-3 py-4" style={{ backgroundColor: "#111111" }}>
      <span className="text-2xl font-bold" style={{ color: color || (accent ? "#c8a882" : "#ffffff") }}>{value}</span>
      <span className="mt-1 text-[9px] tracking-widest uppercase" style={{ color: "#888" }}>{label}</span>
    </div>
  );
}

// Simple markdown to HTML renderer
function renderMarkdown(md: string): string {
  if (!md) return "";
  let html = md
    // Headers
    .replace(/^## (.*$)/gm, '<h2 style="color:#f0ede8;font-size:16px;font-weight:700;margin-top:24px;margin-bottom:8px;letter-spacing:0.05em">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 style="color:#C8A882;font-size:13px;font-weight:600;margin-top:16px;margin-bottom:6px">$1</h3>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f0ede8">$1</strong>')
    // Bullet points
    .replace(/^- (.*$)/gm, '<li style="margin-left:16px;margin-bottom:4px;list-style-type:disc;color:#ccc">$1</li>')
    // Numbered lists
    .replace(/^\d+\. (.*$)/gm, '<li style="margin-left:16px;margin-bottom:4px;list-style-type:decimal;color:#ccc">$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p style="margin-bottom:8px;color:#ccc">')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br/>');

  return `<p style="margin-bottom:8px;color:#ccc">${html}</p>`;
}
