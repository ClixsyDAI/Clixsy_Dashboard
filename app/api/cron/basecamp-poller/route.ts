// =============================================================
// GET /api/cron/basecamp-poller
// =============================================================
//
// Vercel scheduled cron entry-point for the Basecamp-to-Workbook
// poller (Phase 3 Step 4). Runs every 15 minutes per vercel.json.
//
// Pipeline:
//   1. Bearer auth gate (CRON_SECRET). 401 on miss; 500 if the env
//      var itself isn't configured (fail-loud, not fail-open).
//   2. Read ?skip_basecamp_message=true off the query string. The
//      Vercel-scheduled invocation never passes a query string, so
//      the default (false → message posts) applies in production.
//      The flag is for operator-invoked backfill runs where messages
//      should be suppressed.
//   3. getValidAccessToken — exercises the Phase 2c refresh-preserves-
//      token fix if the access token has expired. Refreshed tokens
//      get written back to Vercel env vars via storeBasecampTokens
//      (same shape as the existing /api/sync routes).
//   4. listJProjects → getExistingProjectIds → filterNewProjects.
//   5. Sequentially process each new project. Sequential, not
//      parallel — projects.json commits would race on the SHA
//      otherwise (GitHub Contents API requires the prior SHA on
//      every PUT).
//   6. Aggregate { processed, succeeded, failed, skipped, details[] }
//      and return as 200 JSON. Always 200 if auth passed; per-project
//      failures are surfaced inside `details` so one bad project
//      doesn't block the rest.

import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/app/lib/basecamp";
import {
  filterNewProjects,
  getExistingProjectIds,
} from "@/app/lib/poller-dedupe";
import {
  listJProjects,
  processNewProject,
  type ProcessResult,
} from "@/app/lib/basecamp-poller";
import { storeBasecampTokens } from "@/app/lib/vercel-env";

// 5-minute window covers the worst-case "process every project in
// the J-list" run if multiple new projects arrive between cron ticks.
// Typical happy-path runs (zero or one new project) finish in seconds.
export const maxDuration = 300;
// Don't cache — this is a state-mutating endpoint that must run
// fresh on every invocation. The default-dynamic behaviour for
// route handlers covers this, but the explicit flag is defensive
// against Next.js caching heuristics drifting.
export const dynamic = "force-dynamic";

interface CronResponse {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  skip_basecamp_message: boolean;
  token_refreshed: boolean;
  details: ProcessResult[];
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1. Bearer auth — fail loud if the env var is missing, fail closed
  //    if the header doesn't match.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET not configured");
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET unset" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. ?skip_basecamp_message=true → pass through to processNewProject.
  const skipBasecampMessage =
    req.nextUrl.searchParams.get("skip_basecamp_message") === "true";

  // 3. Access token + opportunistic write-back of a refreshed pair.
  let accessToken: string;
  let tokenRefreshed = false;
  try {
    const result = await getValidAccessToken();
    accessToken = result.accessToken;
    tokenRefreshed = result.refreshed;
    if (
      result.refreshed &&
      result.newTokens &&
      process.env.VERCEL_API_TOKEN &&
      process.env.VERCEL_PROJECT_ID
    ) {
      try {
        await storeBasecampTokens(
          result.newTokens.access_token,
          result.newTokens.refresh_token,
        );
      } catch (err) {
        console.error("[cron] failed to write refreshed tokens to Vercel:", err);
      }
    }
  } catch (err) {
    console.error("[cron] getValidAccessToken failed:", err);
    return NextResponse.json(
      {
        error: "Basecamp token fetch failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // 4. List Basecamp + dedupe against the bundled projects.json.
  let toProcess;
  try {
    const allJ = await listJProjects(accessToken);
    const existing = new Set(getExistingProjectIds());
    toProcess = filterNewProjects(allJ, existing);
  } catch (err) {
    console.error("[cron] listing/dedup failed:", err);
    return NextResponse.json(
      {
        error: "Listing or dedup failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // 5. Sequential processing. Per-project failures are caught into
  //    the details array; the loop continues so a single broken
  //    project doesn't block the rest of the batch.
  const details: ProcessResult[] = [];
  for (const project of toProcess) {
    try {
      const result = await processNewProject(project, accessToken, {
        skipBasecampMessage,
      });
      details.push(result);
    } catch (err) {
      console.error(
        `[cron] processNewProject threw for project ${project.id}:`,
        err,
      );
      details.push({
        status: "failed_dock_fetch",
        project_id: project.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6. Aggregate. "failed" covers any details.status starting with
  //    "failed_", "skipped" covers skipped_409. processNewProject's
  //    discriminated-union shape makes this safe.
  const succeeded = details.filter((d) => d.status === "success").length;
  const failed = details.filter((d) => d.status.startsWith("failed_")).length;
  const skipped = details.filter((d) => d.status === "skipped_409").length;

  const response: CronResponse = {
    processed: details.length,
    succeeded,
    failed,
    skipped,
    skip_basecamp_message: skipBasecampMessage,
    token_refreshed: tokenRefreshed,
    details,
  };

  console.log(
    `[cron] basecamp-poller complete: processed=${response.processed} succeeded=${succeeded} failed=${failed} skipped=${skipped} skip_msg=${skipBasecampMessage}`,
  );

  return NextResponse.json(response);
}
