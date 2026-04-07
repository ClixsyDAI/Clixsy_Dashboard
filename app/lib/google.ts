const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN!;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API = "https://www.googleapis.com/webmasters/v3";
const GA4_API = "https://analyticsdata.googleapis.com/v1beta";
const GA4_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

let cachedAccessToken: string | null = null;
let tokenExpiry = 0;

/** Get a valid Google OAuth2 access token, refreshing if needed */
export async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiry) {
    return cachedAccessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // refresh 60s early
  return data.access_token;
}

// ── GSC ──────────────────────────────────────────────────────────

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
}

/** List all GSC properties accessible to the account */
export async function listGscProperties(): Promise<GscProperty[]> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${GSC_API}/sites`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC list sites failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return (data.siteEntry || []).map((s: { siteUrl: string; permissionLevel: string }) => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel,
  }));
}

export interface GscQueryRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscSearchData {
  property: string;
  dateRange: { start: string; end: string };
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  dailyData: Array<{ date: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
  /** Same window one year earlier — used for non-branded YoY comparison. */
  yoyDateRange?: { start: string; end: string };
  yoyTopQueries?: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  fetchedAt: string;
}

/** Fetch GSC search analytics for a property */
export async function fetchGscData(
  siteUrl: string,
  days: number = 90
): Promise<GscSearchData> {
  const token = await getGoogleAccessToken();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3); // GSC data has ~3 day lag
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const baseBody = {
    startDate: fmt(startDate),
    endDate: fmt(endDate),
    dimensions: [] as string[],
    rowLimit: 25000,
  };

  // YoY window: same length, one year earlier
  const yoyEndDate = new Date(endDate);
  yoyEndDate.setFullYear(yoyEndDate.getFullYear() - 1);
  const yoyStartDate = new Date(startDate);
  yoyStartDate.setFullYear(yoyStartDate.getFullYear() - 1);

  const yoyBody = {
    startDate: fmt(yoyStartDate),
    endDate: fmt(yoyEndDate),
    dimensions: [] as string[],
    rowLimit: 25000,
  };

  // Fetch daily data, top queries, top pages, and YoY queries in parallel
  const [dailyRes, queriesRes, pagesRes, yoyQueriesRes] = await Promise.all([
    fetch(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, dimensions: ["date"] }),
    }),
    fetch(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, dimensions: ["query"], rowLimit: 200 }),
    }),
    fetch(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, dimensions: ["page"], rowLimit: 50 }),
    }),
    fetch(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...yoyBody, dimensions: ["query"], rowLimit: 200 }),
    }),
  ]);

  const [dailyJson, queriesJson, pagesJson, yoyQueriesJson] = await Promise.all([
    dailyRes.json(),
    queriesRes.json(),
    pagesRes.json(),
    yoyQueriesRes.json(),
  ]);

  const yoyQueryRows: GscQueryRow[] = yoyQueriesJson.rows || [];

  const dailyRows: GscQueryRow[] = dailyJson.rows || [];
  const queryRows: GscQueryRow[] = queriesJson.rows || [];
  const pageRows: GscQueryRow[] = pagesJson.rows || [];

  // Calculate totals from daily data
  const totals = dailyRows.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      impressions: acc.impressions + row.impressions,
      ctr: 0,
      position: 0,
    }),
    { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  );
  totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  totals.position =
    dailyRows.length > 0
      ? dailyRows.reduce((sum, r) => sum + r.position, 0) / dailyRows.length
      : 0;

  return {
    property: siteUrl,
    dateRange: { start: fmt(startDate), end: fmt(endDate) },
    totals,
    dailyData: dailyRows.map((r) => ({
      date: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
    topQueries: queryRows.map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
    topPages: pageRows.map((r) => ({
      page: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
    yoyDateRange: { start: fmt(yoyStartDate), end: fmt(yoyEndDate) },
    yoyTopQueries: yoyQueryRows.map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

// ── GA4 ─────────────────────────────────────────────────────────

export interface Ga4Property {
  name: string; // "properties/123456789"
  displayName: string;
  propertyType: string;
}

/** List all GA4 properties accessible to the account */
export async function listGa4Properties(): Promise<Ga4Property[]> {
  const token = await getGoogleAccessToken();
  return await listGa4PropertiesViaAccounts(token);
}

async function listGa4PropertiesViaAccounts(token: string): Promise<Ga4Property[]> {
  // First list accounts
  const accountsRes = await fetch(`${GA4_ADMIN_API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!accountsRes.ok) {
    const text = await accountsRes.text();
    throw new Error(`GA4 list accounts failed (${accountsRes.status}): ${text}`);
  }

  const accountsData = await accountsRes.json();
  const accounts: Array<{ name: string }> = accountsData.accounts || [];

  const allProperties: Ga4Property[] = [];

  for (const account of accounts) {
    const filter = encodeURIComponent(`parent:${account.name}`);
    const res = await fetch(`${GA4_ADMIN_API}/properties?filter=${filter}&pageSize=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.properties) {
        for (const p of data.properties) {
          allProperties.push({
            name: p.name,
            displayName: p.displayName,
            propertyType: p.propertyType || "PROPERTY_TYPE_ORDINARY",
          });
        }
      }
    }
  }

  return allProperties;
}

export interface Ga4ReportData {
  propertyId: string;
  displayName: string;
  dateRange: { start: string; end: string };
  totals: {
    sessions: number;
    users: number;
    screenPageViews: number;
    organicSessions: number;
    bounceRate: number;
    avgSessionDuration: number;
  };
  dailyData: Array<{
    date: string;
    sessions: number;
    users: number;
    screenPageViews: number;
  }>;
  channelData: Array<{
    channel: string;
    sessions: number;
    users: number;
  }>;
  /**
   * Key events (conversions) per channel — excludes engagement noise
   * (page_view, session_start, first_visit, user_engagement).
   */
  keyEventsByChannel?: Array<{
    channel: string;
    sessions: number;
    keyEvents: number;
    conversionRate: number;
  }>;
  topPages: Array<{
    page: string;
    screenPageViews: number;
    sessions: number;
  }>;
  fetchedAt: string;
}

const EXCLUDED_KEY_EVENTS = new Set([
  "page_view",
  "session_start",
  "first_visit",
  "user_engagement",
]);

/** Fetch GA4 analytics data for a property */
export async function fetchGa4Data(
  propertyId: string, // e.g. "properties/123456789" or just "123456789"
  displayName: string,
  days: number = 90
): Promise<Ga4ReportData> {
  const token = await getGoogleAccessToken();
  const propId = propertyId.startsWith("properties/")
    ? propertyId
    : `properties/${propertyId}`;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  // Run reports in parallel: daily overview, channel breakdown, top pages, key events by channel+event
  const [dailyRes, channelRes, pagesRes, eventsRes] = await Promise.all([
    // Daily overview
    fetch(`${GA4_API}/${propId}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
        limit: 100000,
      }),
    }),
    // Channel breakdown
    fetch(`${GA4_API}/${propId}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 20,
      }),
    }),
    // Top pages
    fetch(`${GA4_API}/${propId}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "sessions" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 30,
      }),
    }),
    // Events by channel + event name (for key events / conversion rate)
    fetch(`${GA4_API}/${propId}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
        dimensions: [
          { name: "sessionDefaultChannelGroup" },
          { name: "eventName" },
        ],
        metrics: [{ name: "eventCount" }],
        limit: 5000,
      }),
    }),
  ]);

  const [dailyJson, channelJson, pagesJson, eventsJson] = await Promise.all([
    dailyRes.json(),
    channelRes.json(),
    pagesRes.json(),
    eventsRes.json(),
  ]);

  // Parse daily data
  const dailyRows = (dailyJson.rows || []).map((r: { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }) => ({
    date: r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
    sessions: parseInt(r.metricValues[0].value) || 0,
    users: parseInt(r.metricValues[1].value) || 0,
    screenPageViews: parseInt(r.metricValues[2].value) || 0,
    bounceRate: parseFloat(r.metricValues[3].value) || 0,
    avgSessionDuration: parseFloat(r.metricValues[4].value) || 0,
  }));

  // Calculate totals
  const totals = {
    sessions: dailyRows.reduce((s: number, r: { sessions: number }) => s + r.sessions, 0),
    users: dailyRows.reduce((s: number, r: { users: number }) => s + r.users, 0),
    screenPageViews: dailyRows.reduce((s: number, r: { screenPageViews: number }) => s + r.screenPageViews, 0),
    organicSessions: 0,
    bounceRate: dailyRows.length > 0
      ? dailyRows.reduce((s: number, r: { bounceRate: number }) => s + r.bounceRate, 0) / dailyRows.length
      : 0,
    avgSessionDuration: dailyRows.length > 0
      ? dailyRows.reduce((s: number, r: { avgSessionDuration: number }) => s + r.avgSessionDuration, 0) / dailyRows.length
      : 0,
  };

  // Parse channel data
  const channelData = (channelJson.rows || []).map((r: { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }) => ({
    channel: r.dimensionValues[0].value,
    sessions: parseInt(r.metricValues[0].value) || 0,
    users: parseInt(r.metricValues[1].value) || 0,
  }));

  // Find organic sessions
  const organicRow = channelData.find((c: { channel: string }) =>
    c.channel.toLowerCase().includes("organic")
  );
  totals.organicSessions = organicRow ? organicRow.sessions : 0;

  // Parse top pages
  const topPages = (pagesJson.rows || []).map((r: { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }) => ({
    page: r.dimensionValues[0].value,
    screenPageViews: parseInt(r.metricValues[0].value) || 0,
    sessions: parseInt(r.metricValues[1].value) || 0,
  }));

  // Aggregate key events by channel (excluding noisy engagement events)
  const keyEventCountByChannel = new Map<string, number>();
  for (const r of (eventsJson.rows || []) as Array<{
    dimensionValues: Array<{ value: string }>;
    metricValues: Array<{ value: string }>;
  }>) {
    const channel = r.dimensionValues[0]?.value || "(unknown)";
    const eventName = r.dimensionValues[1]?.value || "";
    if (EXCLUDED_KEY_EVENTS.has(eventName)) continue;
    const count = parseInt(r.metricValues[0]?.value || "0") || 0;
    keyEventCountByChannel.set(
      channel,
      (keyEventCountByChannel.get(channel) || 0) + count
    );
  }

  const keyEventsByChannel = channelData
    .map((c: { channel: string; sessions: number }) => {
      const keyEvents = keyEventCountByChannel.get(c.channel) || 0;
      return {
        channel: c.channel,
        sessions: c.sessions,
        keyEvents,
        conversionRate: c.sessions > 0 ? keyEvents / c.sessions : 0,
      };
    })
    .sort((a: { sessions: number }, b: { sessions: number }) => b.sessions - a.sessions);

  return {
    propertyId: propId,
    displayName,
    dateRange: { start: fmt(startDate), end: fmt(endDate) },
    totals,
    dailyData: dailyRows.map((r: { date: string; sessions: number; users: number; screenPageViews: number }) => ({
      date: r.date,
      sessions: r.sessions,
      users: r.users,
      screenPageViews: r.screenPageViews,
    })),
    channelData,
    keyEventsByChannel,
    topPages,
    fetchedAt: new Date().toISOString(),
  };
}
