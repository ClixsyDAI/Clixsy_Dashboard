"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts";

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

interface Ga4Channel {
  channel: string;
  sessions: number;
  users: number;
}

interface GoogleSearchChartsProps {
  gscDaily: GscDailyRow[] | null;
  gscTopQueries: GscQuery[] | null;
  gscTopPages: GscPage[] | null;
  gscTotals: { clicks: number; impressions: number; ctr: number; position: number } | null;
  ga4Daily: Ga4DailyRow[] | null;
  ga4Channels: Ga4Channel[] | null;
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
    // Get Monday of the week
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

function aggregateGa4Weekly(
  data: Ga4DailyRow[]
): Array<{ week: string; sessions: number; users: number; pageViews: number }> {
  const weekMap = new Map<string, { sessions: number; users: number; pageViews: number }>();

  data.forEach((row) => {
    const d = new Date(row.date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const key = monday.toISOString().split("T")[0];

    if (!weekMap.has(key)) {
      weekMap.set(key, { sessions: 0, users: 0, pageViews: 0 });
    }
    const entry = weekMap.get(key)!;
    entry.sessions += row.sessions;
    entry.users += row.users;
    entry.pageViews += row.screenPageViews;
  });

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({
      week: new Date(week).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sessions: v.sessions,
      users: v.users,
      pageViews: v.pageViews,
    }));
}

function truncateUrl(url: string, maxLen: number = 45): string {
  if (!url) return "";
  // Strip protocol and trailing slash
  let clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen - 3) + "...";
}

export default function GoogleSearchCharts({
  gscDaily,
  gscTopQueries,
  gscTopPages,
  gscTotals,
  ga4Daily,
  ga4Channels,
  ga4Totals,
}: GoogleSearchChartsProps) {
  const hasGsc = gscDaily && gscDaily.length > 0;
  const hasGa4 = ga4Daily && ga4Daily.length > 0;

  if (!hasGsc && !hasGa4) return null;

  const weeklyGsc = hasGsc ? aggregateWeekly(gscDaily) : [];
  const weeklyGa4 = hasGa4 ? aggregateGa4Weekly(ga4Daily) : [];

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

      {/* GSC Clicks & Impressions Chart */}
      {hasGsc && (
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-sm p-4" style={{ backgroundColor: "#111111" }}>
            <h3 className="mb-3 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
              CLICKS & IMPRESSIONS (Weekly)
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

      {/* GA4 Sessions Chart */}
      {hasGa4 && (
        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-sm p-4" style={{ backgroundColor: "#111111" }}>
            <h3 className="mb-3 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
              SESSIONS & USERS (Weekly)
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={weeklyGa4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="week" tick={{ fill: "#888", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#888", fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#888" }} />
                <Area type="monotone" dataKey="sessions" fill="rgba(96,165,250,0.15)" stroke="#60a5fa" strokeWidth={2} name="Sessions" />
                <Area type="monotone" dataKey="users" fill="rgba(200,168,130,0.1)" stroke="#C8A882" strokeWidth={1.5} name="Users" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {ga4Channels && ga4Channels.length > 0 && (
            <div className="rounded-sm p-4" style={{ backgroundColor: "#111111" }}>
              <h3 className="mb-3 text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                TRAFFIC CHANNELS
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={ga4Channels.slice(0, 8)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis type="number" tick={{ fill: "#888", fontSize: 10 }} />
                  <YAxis dataKey="channel" type="category" tick={{ fill: "#888", fontSize: 10 }} width={120} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="sessions" fill="#C8A882" name="Sessions" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}

      {/* Top Queries Table */}
      {gscTopQueries && gscTopQueries.length > 0 && (
        <section className="mt-8">
          <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
            TOP SEARCH QUERIES
          </h3>
          <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#1a1a1a" }}>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Query</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Clicks</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Impressions</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>CTR</th>
                  <th className="px-3 py-2 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8" }}>Position</th>
                </tr>
              </thead>
              <tbody>
                {gscTopQueries.slice(0, 20).map((q, i) => (
                  <tr key={q.query} style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}>
                    <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8" }}>{q.query}</td>
                    <td className="px-3 py-2 text-center font-bold" style={{ color: "#60a5fa" }}>{q.clicks}</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#888" }}>{q.impressions.toLocaleString()}</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#888" }}>{(q.ctr * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center" style={{ color: "#c8a882" }}>{q.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Top Pages Table */}
      {gscTopPages && gscTopPages.length > 0 && (
        <section className="mt-8">
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

function KpiBox({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm px-3 py-4" style={{ backgroundColor: "#111111" }}>
      <span className="text-2xl font-bold" style={{ color: accent ? "#c8a882" : "#ffffff" }}>{value}</span>
      <span className="mt-1 text-[9px] tracking-widest uppercase" style={{ color: "#888888" }}>{label}</span>
    </div>
  );
}
