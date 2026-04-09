/**
 * Content API Route — Google Sheets integration (READ-ONLY)
 *
 * ─────────────────────────────────────────────────────────────
 *  SETUP INSTRUCTIONS
 * ─────────────────────────────────────────────────────────────
 * 1. Google Cloud Console → create/select a project.
 * 2. Enable the "Google Sheets API" for that project.
 * 3. IAM & Admin → Service Accounts → Create service account.
 *    - Grant no project roles (Sheets access is granted at the
 *      sheet level via Share).
 * 4. On the service account, Keys → Add Key → JSON. Download.
 * 5. Open the Google Sheet and click Share. Add the service
 *    account email (client_email from the JSON) as a Viewer.
 * 6. Add the following environment variables (local .env.local
 *    and Vercel Project Settings → Environment Variables):
 *
 *    GOOGLE_SERVICE_ACCOUNT_EMAIL  — client_email from JSON
 *    GOOGLE_PRIVATE_KEY            — private_key from JSON
 *                                    (keep the literal \n in the
 *                                    Vercel UI — we normalize it)
 *    GOOGLE_SHEET_ID               — (optional) override default
 *
 * 7. Deploy. The route will fetch on demand and cache for 5 min.
 * ─────────────────────────────────────────────────────────────
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";
import {
  ContentArticle,
  mapSheetStatus,
  normalizeClientName,
} from "../../lib/content-types";

const DEFAULT_SHEET_ID = "165thTBYgb_9B5nkmPCtgNxn4l8hReBK_ru_9Q-nwMLo";
const CANDIDATE_TAB_NAMES = ["Content Sheet", "Content", "Sheet1"];
const CACHE_TTL_MS = 5 * 60 * 1000;

// Simple in-memory cache (per serverless instance)
type CacheEntry = { ts: number; rows: string[][]; tab: string };
let cache: CacheEntry | null = null;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env var");
  }
  // Vercel env vars store `\n` as literal backslash-n; normalize to real newlines.
  const key = rawKey.replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

async function fetchSheetRows(forceRefresh: boolean): Promise<{ rows: string[][]; tab: string }> {
  if (!forceRefresh && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return { rows: cache.rows, tab: cache.tab };
  }
  const sheetId = process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Figure out which tab to use
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabTitles = (meta.data.sheets || [])
    .map((s) => s.properties?.title || "")
    .filter(Boolean);
  let chosen =
    CANDIDATE_TAB_NAMES.find((n) => tabTitles.includes(n)) ||
    tabTitles.find((t) => /content/i.test(t)) ||
    tabTitles[0];
  if (!chosen) throw new Error("Spreadsheet has no tabs");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${chosen}!A1:K10000`,
  });
  const rows = (res.data.values || []) as string[][];
  cache = { ts: Date.now(), rows, tab: chosen };
  return { rows, tab: chosen };
}

/** Stable-ish hash for deterministic IDs */
function hash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/** Match sheet client name to dashboard client name. */
function clientMatches(sheetClient: string, target: string): boolean {
  const a = (sheetClient || "").trim().toLowerCase();
  const b = (target || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  // strip J### prefix from both
  const bNorm = normalizeClientName(b);
  const aNorm = normalizeClientName(a);
  if (aNorm === bNorm) return true;
  // fuzzy: one contains the other
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return true;
  return false;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseDueMonth(raw: string): { month: string; year: number | null; ym: string | null } {
  const v = (raw || "").trim();
  if (!v) return { month: "", year: null, ym: null };
  // Try "January 2026" or "Jan 2026"
  const m = v.match(/([A-Za-z]+)\s*(\d{4})?/);
  if (m) {
    const monthWord = m[1].slice(0, 3).toLowerCase();
    const idx = MONTH_NAMES.findIndex((mn) => mn.toLowerCase().startsWith(monthWord));
    if (idx >= 0) {
      const year = m[2] ? Number(m[2]) : new Date().getFullYear();
      return {
        month: MONTH_NAMES[idx],
        year,
        ym: `${year}-${String(idx + 1).padStart(2, "0")}`,
      };
    }
  }
  return { month: v, year: null, ym: null };
}

function parsePublishDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientName = url.searchParams.get("client") || "";
  const refresh = url.searchParams.get("refresh") === "1";

  if (!clientName) {
    return NextResponse.json({ error: "Missing client query parameter" }, { status: 400 });
  }

  try {
    const { rows, tab } = await fetchSheetRows(refresh);
    if (rows.length < 2) {
      return NextResponse.json({ articles: [], tab, syncedAt: new Date().toISOString() });
    }
    // Skip header row
    const dataRows = rows.slice(1);
    const articles: ContentArticle[] = [];

    dataRows.forEach((row, idx) => {
      const [
        domain,
        client,
        title,
        docLink,
        finalUrl,
        statusRaw,
        type,
        writer,
        publishDateRaw,
        dueMonthRaw,
        notes,
      ] = row;

      if (!client || !clientMatches(client, clientName)) return;
      if (!title || !title.trim()) return;

      const { status, mapped } = mapSheetStatus(statusRaw);
      const due = parseDueMonth(dueMonthRaw || "");
      const publishDate = parsePublishDate(publishDateRaw || "");

      // Derive month YYYY-MM: prefer parsed Due Month, fall back to publishDate, fall back to current
      let ym = due.ym;
      if (!ym && publishDate) {
        const d = new Date(publishDate);
        ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      if (!ym) {
        const d = new Date();
        ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }

      articles.push({
        id: `gs-${idx}-${hash((title || "") + (client || ""))}`,
        month: ym,
        title: title.trim(),
        type: (type || "").trim() || "Blog Post",
        status,
        rawStatus: mapped ? statusRaw || "" : (statusRaw || "").trim(),
        contentLink: (docLink || "").trim() || undefined,
        liveUrl: (finalUrl || "").trim() || undefined,
        brief: (notes || "").trim() || undefined,
        writer: (writer || "").trim() || null,
        publishDate,
        dueMonth: due.month || null,
        dueYear: due.year,
        domain: (domain || "").trim() || null,
        source: "google_sheets",
      });
    });

    return NextResponse.json({
      articles,
      tab,
      syncedAt: new Date().toISOString(),
      cached: !refresh && !!cache,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/content] sheets fetch failed:", message);
    return NextResponse.json(
      { error: message, articles: [] },
      { status: 500 }
    );
  }
}
