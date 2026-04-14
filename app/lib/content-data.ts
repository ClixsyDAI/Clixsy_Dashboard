/**
 * Content Data Loader — server-side helper around the public Content
 * Management Tracker sheet.
 *
 * Extracted from app/api/content/route.ts so the same fetch/parse/match
 * logic can be reused by other server-side consumers (e.g. the Account
 * Health calculator), with a shared in-memory cache so we hit Google
 * Sheets at most once every CACHE_TTL_MS regardless of which path
 * triggered the load.
 *
 * The sheet is published with "Anyone with the link" and fetched via the
 * public CSV export URL — no auth, no service account, no env vars.
 */

import {
  ContentArticle,
  mapSheetStatus,
  normalizeClientName,
} from "./content-types";

const DEFAULT_SHEET_ID = "165thTBYgb_9B5nkmPCtgNxn4l8hReBK_ru_9Q-nwMLo";
const DEFAULT_GID = "492097253";
const CACHE_TTL_MS = 5 * 60 * 1000;

function csvUrl(sheetId: string, gid: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

/** Robust CSV parser: handles quoted fields, doubled quotes, embedded newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type CacheEntry = { ts: number; rows: string[][] };
let cache: CacheEntry | null = null;

/**
 * Fetch the full sheet as parsed CSV rows. Result is cached for CACHE_TTL_MS
 * across all callers (API route, health summary, etc.). Pass force=true to
 * bypass the cache.
 */
export async function fetchContentRows(force = false): Promise<string[][]> {
  if (!force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.rows;
  }
  const sheetId = process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
  const gid = process.env.GOOGLE_SHEET_GID || DEFAULT_GID;
  const res = await fetch(csvUrl(sheetId, gid), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sheet CSV fetch failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  const rows = parseCsv(text);
  cache = { ts: Date.now(), rows };
  return rows;
}

export function isContentCached(): boolean {
  return !!cache && Date.now() - cache.ts < CACHE_TTL_MS;
}

function hash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function extractProjectCode(name: string): string | null {
  const m = (name || "").trim().match(/^J(\d+)/i);
  return m ? `J${m[1]}`.toUpperCase() : null;
}

/**
 * Match a sheet client name to a dashboard client name. Handles:
 *   - exact (case-insensitive)
 *   - J-code match ("J257 Reimer" ↔ "J257 Reimer Home Services")
 *   - substring of the J-stripped normalized name
 */
export function clientMatches(sheetClient: string, target: string): boolean {
  const a = (sheetClient || "").trim();
  const b = (target || "").trim();
  if (!a || !b) return false;

  if (a.toLowerCase() === b.toLowerCase()) return true;

  const codeA = extractProjectCode(a);
  const codeB = extractProjectCode(b);
  if (codeA && codeB && codeA === codeB) return true;

  const aNorm = normalizeClientName(a).toLowerCase();
  const bNorm = normalizeClientName(b).toLowerCase();
  if (aNorm === bNorm) return true;
  if (aNorm && bNorm && (aNorm.includes(bNorm) || bNorm.includes(aNorm))) return true;

  return false;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseDueMonth(raw: string): { month: string; year: number | null; ym: string | null } {
  const v = (raw || "").trim();
  if (!v) return { month: "", year: null, ym: null };
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

function cleanUrl(v: string): string {
  return (v || "").trim().replace(/[↗\s]+$/, "");
}

/** Turn a single parsed sheet row into a ContentArticle, or null if unusable. */
function rowToArticle(row: string[], rowIdx: number): { article: ContentArticle; rawClient: string } | null {
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

  if (!client || !title || !title.trim()) return null;

  const { status, mapped } = mapSheetStatus(statusRaw);
  const due = parseDueMonth(dueMonthRaw || "");
  const publishDate = parsePublishDate(publishDateRaw || "");

  let ym = due.ym;
  if (!ym && publishDate) {
    const d = new Date(publishDate);
    ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!ym) {
    const d = new Date();
    ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  return {
    rawClient: client.trim(),
    article: {
      id: `gs-${rowIdx}-${hash((title || "") + (client || ""))}`,
      month: ym,
      title: title.trim(),
      type: (type || "").trim() || "Blog Post",
      status,
      rawStatus: mapped ? (statusRaw || "").trim() : (statusRaw || "").trim(),
      contentLink: cleanUrl(docLink) || undefined,
      liveUrl: cleanUrl(finalUrl) || undefined,
      brief: (notes || "").trim() || undefined,
      writer: (writer || "").trim() || null,
      publishDate,
      dueMonth: due.month || null,
      dueYear: due.year,
      domain: (domain || "").trim() || null,
      source: "google_sheets",
    },
  };
}

/**
 * Load all articles that match a single client name. Uses the shared cache.
 * Returns an empty array if the sheet has no matching rows (not an error —
 * many clients have no content pipeline).
 */
export async function loadContentArticlesForClient(
  clientName: string,
  force = false
): Promise<ContentArticle[]> {
  if (!clientName) return [];
  const rows = await fetchContentRows(force);
  if (rows.length < 2) return [];
  const out: ContentArticle[] = [];
  rows.slice(1).forEach((row, idx) => {
    const parsed = rowToArticle(row, idx);
    if (!parsed) return;
    if (!clientMatches(parsed.rawClient, clientName)) return;
    out.push(parsed.article);
  });
  return out;
}

/**
 * Load the full sheet, grouped by the raw client name used in the sheet.
 * Callers can then match whichever dashboard clients they care about. Used
 * by the Account Health summary which iterates all 54 projects at once so
 * we avoid re-filtering rows 54 times (same cache, cheaper CPU).
 */
export async function loadAllContentArticles(
  force = false
): Promise<{ byRawClient: Map<string, ContentArticle[]>; articles: ContentArticle[] }> {
  const rows = await fetchContentRows(force);
  const byRawClient = new Map<string, ContentArticle[]>();
  const all: ContentArticle[] = [];
  if (rows.length < 2) return { byRawClient, articles: all };
  rows.slice(1).forEach((row, idx) => {
    const parsed = rowToArticle(row, idx);
    if (!parsed) return;
    all.push(parsed.article);
    const existing = byRawClient.get(parsed.rawClient) || [];
    existing.push(parsed.article);
    byRawClient.set(parsed.rawClient, existing);
  });
  return { byRawClient, articles: all };
}

/** Match a dashboard client to its articles using the grouped map. */
export function articlesForClient(
  byRawClient: Map<string, ContentArticle[]>,
  clientName: string
): ContentArticle[] {
  const out: ContentArticle[] = [];
  for (const [raw, arts] of byRawClient.entries()) {
    if (clientMatches(raw, clientName)) out.push(...arts);
  }
  return out;
}
