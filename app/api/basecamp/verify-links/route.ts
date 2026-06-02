// =============================================================
// app/api/basecamp/_verify_links/route.ts
// =============================================================
//
// TEMPORARY read-only verification endpoint. Hits Basecamp once per
// sample client to confirm the stored numeric project ids in
// projects.json still map to real Basecamp projects with matching
// names. No mutations.
//
// This route exists ONLY for the rebuild-step-1 verification job.
// Will be removed (or repurposed into the real sync surface) in a
// follow-up PR. The 5 IDs are HARDCODED to keep the attack surface
// zero — an arbitrary caller cannot probe other Basecamp projects.

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getValidAccessToken, getProjectById, findTodosetIdInDock } from "@/app/lib/basecamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5 sample IDs spread across the numeric-id range.
const SAMPLE_IDS: ReadonlyArray<string> = [
  "12208911", // Fielding Law (j_101)
  "25949341", // Sunset Heating (j_153)
  "35591615", // Christian HVAC SEO (j_282)
  "43339319", // Champion Plumbing (j_377)
  "47432392", // Demas Law Group (j_425)
];

interface ProjectsEntry {
  id: string;
  name: string;
  j_number: string | null;
  description: string | null;
  vertical: string;
  ghl_contact_id: string | null;
  am_ghl_user_id: string | null;
  website_url: string | null;
}

interface VerifyRow {
  stored_id: string;
  dashboard_name: string;
  basecamp_project_name: string | null;
  exists_in_basecamp: boolean;
  names_match: boolean;
  todoset_id_from_dock: number | null;
  todoset_found: boolean;
  error?: string;
}

export async function GET() {
  // Load projects.json to get the dashboard-side names.
  const projectsPath = join(process.cwd(), "app", "data", "projects.json");
  const projectsRaw = readFileSync(projectsPath, "utf-8");
  const projects: ProjectsEntry[] = JSON.parse(projectsRaw);

  // Get a working access token (refreshes if needed).
  let accessToken: string;
  try {
    const tokenResult = await getValidAccessToken();
    accessToken = tokenResult.accessToken;
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: "token_unavailable",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }

  const results: VerifyRow[] = [];

  for (const storedId of SAMPLE_IDS) {
    const dashEntry = projects.find((p) => p.id === storedId);
    const dashboardName = dashEntry?.name ?? "(NOT IN projects.json)";

    try {
      const project = await getProjectById(storedId, accessToken);
      if (project === null) {
        results.push({
          stored_id: storedId,
          dashboard_name: dashboardName,
          basecamp_project_name: null,
          exists_in_basecamp: false,
          names_match: false,
          todoset_id_from_dock: null,
          todoset_found: false,
        });
        continue;
      }

      const todosetId = findTodosetIdInDock(project);
      const basecampName = project.name ?? "(no name)";

      // Plausible-match check: case-insensitive substring either way,
      // OR a Jaccard-style word-overlap (>=1 common token >=3 chars).
      const nA = dashboardName.toLowerCase();
      const nB = basecampName.toLowerCase();
      const substringMatch =
        nA.includes(nB) || nB.includes(nA);
      const tokensA = new Set(nA.split(/\W+/).filter((t) => t.length >= 3));
      const tokensB = new Set(nB.split(/\W+/).filter((t) => t.length >= 3));
      const overlap = [...tokensA].some((t) => tokensB.has(t));
      const namesMatch = substringMatch || overlap;

      results.push({
        stored_id: storedId,
        dashboard_name: dashboardName,
        basecamp_project_name: basecampName,
        exists_in_basecamp: true,
        names_match: namesMatch,
        todoset_id_from_dock: todosetId,
        todoset_found: todosetId !== null,
      });
    } catch (err) {
      results.push({
        stored_id: storedId,
        dashboard_name: dashboardName,
        basecamp_project_name: null,
        exists_in_basecamp: false,
        names_match: false,
        todoset_id_from_dock: null,
        todoset_found: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    sample_count: SAMPLE_IDS.length,
    results,
  });
}
