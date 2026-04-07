"use client";

import {
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
  ComposedChart,
} from "recharts";
import { buildBrandedMatcher } from "../lib/branded";

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

interface GscPage {
  page: string;
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

interface Ga4KeyEventChannel {
  channel: string;
  sessions: number;
  keyEvents: number;
  conversionRate: number;
}

interface GoogleSearchChartsProps {
  gscProperty?: string | null;
  projectName?: string | null;
  gscDaily: GscDailyRow[] | null;
  gscTopQueries: GscQuery[] | null;
  gscYoyTopQueries?: GscQuery[] | null;
  gscYoyDateRange?: { start: string; end: string } | null;
  gscDateRange?: { start: string; end: string } | null;
  gscTopPages: GscPage[] | null;
  gscTotals: { clicks: number; impressions: number; ctr: number; position: number } | null;
  ga4Daily: Ga4DailyRow[] | null;
  ga4KeyEventsByChannel?: Ga4KeyEventChannel[] | null;
  ga4Totals: {
    sessions: number;
    users: number;
    screenPageViews: number;
    organicSessions: number;
    bounceRate: number;
    avgSessionDuration: number;
  } | null;
}

const tooltipStyle = {
  backgroundColor: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: "4px",
  color: "#f0ede8",
  fontSize: 12,
};

// Aggregate daily data to weekly for cleaner charts
function aggregateWeekly(
  data: GscDailyRow[]
): Array<{ week: string; clicks: number; impressions: number; position: number }> {
  const weekMap = new Map<string, { clicks: number; impressions: number; posSum: number; count: number }>();

  data.forEach((row) => {
    const d = new Date(row.date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const key = monday.toISOString().split("T")[0];

    if (!weekMap.has(key)) {
      weekMap.set(key, { clicks: 0, impressions: 0, posSum: 0, count: 0 });
    }
    const entry = weekMap.get(key)!;
    entry.clicks += row.clicks;
    entry.impressions += row.impressions;
    entry.posSum += row.position;
    entry.count++;
  });

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({
      week: new Date(week).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      clicks: v.clicks,
      impressions: v.impressions,
      position: Math.round((v.posSum / v.count) * 10) / 10,
    }));
}

function truncateUrl(url: string, maxLen: number = 45): string {
  if (!url) return "";
  const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen - 3) + "...";
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function deltaCell(curr: number, prev: number, opts: { invert?: boolean; isPct?: boolean } = {}): React.ReactNode {
  if (prev === 0 && curr === 0) return <span style={{ color: "#666" }}>—</span>;
  if (prev === 0) return <span style={{ color: "#2d6a4f" }}>NEW</span>;
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const positive = opts.invert ? diff < 0 : diff > 0;
  const color = diff === 0 ? "#888" : positive ? "#2d6a4f" : "#e74c3c";
  const arrow = diff === 0 ? "" : positive ? "▲" : "▼";
  return (
    <span style={{ color, fontSize: 11 }}>
      {arrow} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export default function GoogleSearchCharts({
  gscProperty,
  projectName,
  gscDaily,
  gscTopQueries,
  gscYoyTopQueries,
  gscYoyDateRange,
  gscDateRange,
  gscTopPages,
  gscTotals,
  ga4Daily,
  ga4KeyEventsByChannel,
  ga4Totals,
}: GoogleSearchChartsProps) {
  const hasGsc = gscDaily && gscDaily.length > 0;
  const hasGa4 = ga4Daily && ga4Daily.length > 0;

  if (!hasGsc && !hasGa4) return null;

  const weeklyGsc = hasGsc ? aggregateWeekly(gscDaily) : [];

  // ── Branded / Non-branded split ──────────────────────────────
  const matcher = buildBrandedMatcher(gscProperty, projectName);
  const allQueries = gscTopQueries || [];
  const branded = allQueries
    .filter((q) => matcher.isBranded(q.query))
    .slice(0, 20);
  const nonBranded = allQueries
    .filter((q) => !matcher.isBranded(q.query))
    .slice(0, 20);

  // ── Non-branded YoY ──────────────────────────────────────────
  const yoyAll = gscYoyTopQueries || [];
  const yoyByQuery = new Map(yoyAll.map((q) => [q.query.toLowerCase(), q]));
  const yoyNonBranded = (gscTopQueries || [])
    .filter((q) => !matcher.isBranded(q.query))
    .slice(0, 20)
    .map((q) => {
      const prior = yoyByQuery.get(q.query.toLowerCase());
      return {
        query: q.query,
        currClicks: q.clicks,
        currImpr: q.impressions,
        currPos: q.position,
        prevClicks: prior?.clicks || 0,
        prevImpr: prior?.impressions || 0,
        prevPos: prior?.position || 0,
      };
    });

  return (
    <>
      {/* Google KPIs */}
      <section className="mt-12">
        <h2
          className="text-lg font-bold tracking-wide"
          style={{ color: "#ffffff" }}
        >
          SEARCH PERFORMANCE
        </h2>
        <div className="mt-1 h-[2px] w-full" style={{ backgroundColor: "#c8a882" }} />

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          {gscTotals && (
            <>
              <KpiBox value={gscTotals.clicks.toLocaleString()} label="GSC CLICKS" />
              <KpiBox value={gscTotals.impressions.toLocaleString()} label="IMPRESSIONS" />
              <KpiBox value={`${(gscTotals.ctr * 100).toFixed(1)}%`} label="AVG CTR" />
              <KpiBox value={gscTotals.position.toFixed(1)} label="AVG POSITION" />
            </>
          )}
          {ga4Totals && (
            <>
              <KpiBox value={ga4Totals.sessions.toLocaleString()} label="SESSIONS" accent />
              <KpiBox value={ga4Totals.organicSessions.toLocaleString()} label="ORGANIC SESSIONS" accent />
            </>
          )}
        </div>
      </section>

      {/* GSC Clicks/Impressions + Position */}
      {hasGsc && (
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-sm p-4" style={{ backgroundColor: "#111111" }}>
            <h3 className="mb-3 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
              CLICKS &amp; IMPRESSIONS (Weekly)
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={weeklyGsc}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="week" tick={{ fill: "#888", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fill: "#888", fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#888", fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#888" }} />
                <Area yAxisId="right" type="monotone" dataKey="impressions" fill="rgba(200,168,130,0.1)" stroke="#C8A882" strokeWidth={1.5} name="Impressions" />
                <Area yAxisId="left" type="monotone" dataKey="clicks" fill="rgba(96,165,250,0.15)" stroke="#60a5fa" strokeWidth={2} name="Clicks" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-sm p-4" style={{ backgroundColor: "#111111" }}>
            <h3 className="mb-3 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
              AVG POSITION (Weekly)
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weeklyGsc}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="week" tick={{ fill: "#888", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis reversed tick={{ fill: "#888", fontSize: 10 }} domain={["dataMin - 1", "dataMax + 1"]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="position" stroke="#34d399" strokeWidth={2} dot={false} name="Position" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Branded vs Non-Branded — top 20 each, side by side */}
      {(branded.length > 0 || nonBranded.length > 0) && (
        <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <QueryTable title="TOP 20 BRANDED QUERIES" rows={branded} />
          <QueryTable title="TOP 20 NON-BRANDED QUERIES" rows={nonBranded} />
        </section>
      )}

      {/* Non-branded 3-month YoY */}
      {yoyNonBranded.length > 0 && (
        <section className="mt-10">
          <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
            NON-BRANDED 3-MONTH YoY
          </h3>
          {gscDateRange && gscYoyDateRange && (
            <p className="mt-1 text-[11px]" style={{ color: "#666" }}>
              {gscDateRange.start} → {gscDateRange.end} vs {gscYoyDateRange.start} → {gscYoyDateRange.end}
            </p>
          )}
          <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#1a1a1a" }}>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Query</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Clicks</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#888" }}>YoY</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Impressions</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#888" }}>YoY</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Position</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#888" }}>YoY</th>
                </tr>
              </thead>
              <tbody>
                {yoyNonBranded.map((q, i) => (
                  <tr key={q.query} style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}>
                    <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8" }}>{q.query}</td>
                    <td className="px-3 py-2 text-center font-bold" style={{ color: "#60a5fa" }}>{q.currClicks}</td>
                    <td className="px-3 py-2 text-center">{deltaCell(q.currClicks, q.prevClicks)}</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#f0ede8" }}>{q.currImpr.toLocaleString()}</td>
                    <td className="px-3 py-2 text-center">{deltaCell(q.currImpr, q.prevImpr)}</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#c8a882" }}>{q.currPos.toFixed(1)}</td>
                    <td className="px-3 py-2 text-center">{deltaCell(q.currPos, q.prevPos, { invert: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Key Events by Channel */}
      {ga4KeyEventsByChannel && ga4KeyEventsByChannel.length > 0 && (
        <section className="mt-10">
          <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
            KEY EVENTS BY CHANNEL
          </h3>
          <p className="mt-1 text-[11px]" style={{ color: "#666" }}>
            Excludes page_view, session_start, first_visit, user_engagement
          </p>
          <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />

          <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Chart */}
            <div className="rounded-sm p-4" style={{ backgroundColor: "#111111" }}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={ga4KeyEventsByChannel.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis dataKey="channel" tick={{ fill: "#888", fontSize: 10 }} angle={-20} textAnchor="end" height={70} />
                  <YAxis yAxisId="left" tick={{ fill: "#888", fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: "#888", fontSize: 10 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) => {
                      const num = typeof value === "number" ? value : Number(value);
                      if (name === "Conversion Rate") return fmtPct(num);
                      return num.toLocaleString();
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#888" }} />
                  <Bar yAxisId="left" dataKey="sessions" fill="rgba(96,165,250,0.5)" name="Sessions" />
                  <Bar yAxisId="left" dataKey="keyEvents" fill="#C8A882" name="Key Events" />
                  <Line yAxisId="right" type="monotone" dataKey="conversionRate" stroke="#34d399" strokeWidth={2} name="Conversion Rate" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ backgroundColor: "#1a1a1a" }}>
                    <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Channel</th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Sessions</th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Key Events</th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Conv. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {ga4KeyEventsByChannel.slice(0, 12).map((c, i) => (
                    <tr key={c.channel} style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}>
                      <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8" }}>{c.channel}</td>
                      <td className="px-3 py-2 text-center" style={{ color: "#60a5fa" }}>{c.sessions.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center font-bold" style={{ color: "#C8A882" }}>{c.keyEvents.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center" style={{ color: "#34d399" }}>{fmtPct(c.conversionRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Top Pages Table */}
      {gscTopPages && gscTopPages.length > 0 && (
        <section className="mt-10">
          <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
            TOP PAGES BY CLICKS
          </h3>
          <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#1a1a1a" }}>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Page</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Clicks</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Impressions</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>CTR</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Position</th>
                </tr>
              </thead>
              <tbody>
                {gscTopPages.slice(0, 15).map((p, i) => (
                  <tr key={p.page} style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}>
                    <td className="px-3 py-2" style={{ color: "#f0ede8" }}>{truncateUrl(p.page)}</td>
                    <td className="px-3 py-2 text-center font-bold" style={{ color: "#60a5fa" }}>{p.clicks}</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#888" }}>{p.impressions.toLocaleString()}</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#888" }}>{(p.ctr * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#c8a882" }}>{p.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function QueryTable({ title, rows }: { title: string; rows: GscQuery[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
        {title}
      </h3>
      <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: "#1a1a1a" }}>
              <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Query</th>
              <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Clicks</th>
              <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Impr.</th>
              <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-xs" colSpan={4} style={{ color: "#666" }}>
                  No queries in this category
                </td>
              </tr>
            )}
            {rows.map((q, i) => (
              <tr key={q.query} style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}>
                <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8" }}>{q.query}</td>
                <td className="px-3 py-2 text-center font-bold" style={{ color: "#60a5fa" }}>{q.clicks}</td>
                <td className="px-3 py-2 text-center" style={{ color: "#888" }}>{q.impressions.toLocaleString()}</td>
                <td className="px-3 py-2 text-center" style={{ color: "#c8a882" }}>{q.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiBox({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm px-3 py-4" style={{ backgroundColor: "#111111" }}>
      <span className="text-2xl font-bold" style={{ color: accent ? "#c8a882" : "#ffffff" }}>{value}</span>
      <span className="mt-1 text-[9px] tracking-widest uppercase" style={{ color: "#888888" }}>{label}</span>
    </div>
  );
}
