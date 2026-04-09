/**
 * Content API Route — Google Sheets integration (READ-ONLY, public CSV export)
 *
 * The Content Management Tracker sheet is shared as "Anyone with the link",
 * so we fetch it directly via Google Sheets' public CSV export endpoint and
 * parse it server-side. No auth, no service account, no env vars required.
 *
 * If the sheet is ever made private, switch back to a service-account flow.
 */

import { NextResponse } from "next/server";
import {
  ContentArticle,
  mapSheetStatus,
  normalizeClientName,
} from "../../lib/content-types";

const DEFAULT_SHEET_ID = "165thTBYgb_9B5nkmPCtgNxn4l8hReBK_ru_9Q-nwMLo";
// gid for the "Content Sheet" tab (discovered from the live sheet)
const DEFAULT_GID = "492097253";
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { ts: number; rows: string[][] };
let cache: CacheEntry | null = null;

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

async function fetchSheetRows(forceRefresh: boolean): Promise<string[][]> {
  if (!forceRefresh && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
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

function hash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/** Extract the J### project code if present at the start of a name. */
function extractProjectCode(name: string): string | null {
  const m = (name || "").trim().match(/^J(\d+)/i);
  return m ? `J${m[1]}`.toUpperCase() : null;
}

/** Match sheet client name to dashboard client name. */
function clientMatches(sheetClient: string, target: string): boolean {
  const a = (sheetClient || "").trim();
  const b = (target || "").trim();
  if (!a || !b) return false;

  // 1) exact (case-insensitive)
  if (a.toLowerCase() === b.toLowerCase()) return true;

  // 2) match by J### project code (strongest signal — "J257 Reimer" ↔ "J257 Reimer Home Services")
  const codeA = extractProjectCode(a);
  const codeB = extractProjectCode(b);
  if (codeA && codeB && codeA === codeB) return true;

  // 3) strip J### prefix from both and compare/substring
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

/** Clean stray trailing arrows etc. from URLs in the sheet. */
function cleanUrl(v: string): string {
  return (v || "").trim().replace(/[↗\s]+$/, "");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientName = url.searchParams.get("client") || "";
  const refresh = url.searchParams.get("refresh") === "1";
  const debug = url.searchParams.get("debug") === "1";

  if (!clientName) {
    return NextResponse.json({ error: "Missing client query parameter" }, { status: 400 });
  }

  try {
    const rows = await fetchSheetRows(refresh);
    if (rows.length < 2) {
      return NextResponse.json({ articles: [], syncedAt: new Date().toISOString() });
    }
    const dataRows = rows.slice(1);
    const articles: ContentArticle[] = [];
    const sampledClients = new Set<string>();

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

      if (client) sampledClients.add(client.trim());

      if (!client || !clientMatches(client, clientName)) return;
      if (!title || !title.trim()) return;

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

      articles.push({
        id: `gs-${idx}-${hash((title || "") + (client || ""))}`,
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
      });
    });

    return NextResponse.json({
      articles,
      syncedAt: new Date().toISOString(),
      cached: !refresh && !!cache,
      ...(debug
        ? {
            totalRows: dataRows.length,
            matchedRows: articles.length,
            distinctClientsInSheet: Array.from(sampledClients).sort(),
            queryClient: clientName,
          }
        : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/content] fetch failed:", message);
    return NextResponse.json({ error: message, articles: [] }, { status: 500 });
  }
}
