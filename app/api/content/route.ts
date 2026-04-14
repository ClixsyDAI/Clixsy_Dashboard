/**
 * Content API Route — thin wrapper around app/lib/content-data.ts.
 *
 * The fetch/parse/match logic lives in the lib so the server-side Account
 * Health calculator can reuse it with a shared cache. Keep this route
 * focused on HTTP shape (query params, response envelope, debug helpers).
 */

import { NextResponse } from "next/server";
import {
  fetchContentRows,
  loadContentArticlesForClient,
  isContentCached,
} from "../../lib/content-data";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientName = url.searchParams.get("client") || "";
  const refresh = url.searchParams.get("refresh") === "1";
  const debug = url.searchParams.get("debug") === "1";

  if (!clientName) {
    return NextResponse.json({ error: "Missing client query parameter" }, { status: 400 });
  }

  try {
    const wasCached = isContentCached() && !refresh;
    const articles = await loadContentArticlesForClient(clientName, refresh);

    let debugPayload: Record<string, unknown> = {};
    if (debug) {
      const rows = await fetchContentRows(false);
      const sampledClients = new Set<string>();
      rows.slice(1).forEach((r) => {
        if (r[1]) sampledClients.add(r[1].trim());
      });
      debugPayload = {
        totalRows: Math.max(0, rows.length - 1),
        matchedRows: articles.length,
        distinctClientsInSheet: Array.from(sampledClients).sort(),
        queryClient: clientName,
      };
    }

    return NextResponse.json({
      articles,
      syncedAt: new Date().toISOString(),
      cached: wasCached,
      ...debugPayload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/content] fetch failed:", message);
    return NextResponse.json({ error: message, articles: [] }, { status: 500 });
  }
}
