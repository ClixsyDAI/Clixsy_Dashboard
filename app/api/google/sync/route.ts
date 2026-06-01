import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchGscData, fetchGa4Data } from "../../../lib/google";
import { requireRole } from "../../../lib/require-role";
import { logAuthAudit } from "../../../lib/auth-audit";

interface ClientGoogleMapping {
  projectId: number;
  clientName: string;
  gscProperty?: string; // e.g. "sc-domain:sunsetheatingandcooling.com"
  ga4PropertyId?: string; // e.g. "properties/123456789"
  ga4DisplayName?: string;
}

function loadMappings(): ClientGoogleMapping[] {
  const path = join(process.cwd(), "app", "data", "google-properties.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * POST /api/google/sync
 * Syncs GSC and GA4 data for all mapped clients.
 * Optional body: { projectId: number } to sync a single client.
 *
 * Auth: requireRole('admin') added in PR C as defence-in-depth.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, "admin", "/api/google/sync");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const singleProjectId = body.projectId as number | undefined;

    let mappings = loadMappings();
    if (singleProjectId) {
      mappings = mappings.filter((m) => m.projectId === singleProjectId);
    }

    // Filter to only clients that have at least one property mapped
    const activeMappings = mappings.filter((m) => m.gscProperty || m.ga4PropertyId);

    if (activeMappings.length === 0) {
      return NextResponse.json({
        error: "No client-property mappings found. Run GET /api/google/discover first, then create app/data/google-properties.json",
      }, { status: 400 });
    }

    const dataDir = join(process.cwd(), "app", "data", "clients");
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const results: Array<{
      projectId: number;
      clientName: string;
      gsc: string;
      ga4: string;
    }> = [];

    // Process clients sequentially to respect rate limits
    for (const mapping of activeMappings) {
      let gscStatus = "skipped";
      let ga4Status = "skipped";

      try {
        if (mapping.gscProperty) {
          const gscData = await fetchGscData(mapping.gscProperty);
          const filePath = join(dataDir, `${mapping.projectId}-gsc.json`);
          writeFileSync(filePath, JSON.stringify(gscData, null, 2));
          gscStatus = `ok (${gscData.totals.clicks} clicks)`;
        }
      } catch (err) {
        gscStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
      }

      try {
        if (mapping.ga4PropertyId) {
          const ga4Data = await fetchGa4Data(
            mapping.ga4PropertyId,
            mapping.ga4DisplayName || mapping.clientName
          );
          const filePath = join(dataDir, `${mapping.projectId}-ga4.json`);
          writeFileSync(filePath, JSON.stringify(ga4Data, null, 2));
          ga4Status = `ok (${ga4Data.totals.sessions} sessions)`;
        }
      } catch (err) {
        ga4Status = `error: ${err instanceof Error ? err.message : String(err)}`;
      }

      results.push({
        projectId: mapping.projectId,
        clientName: mapping.clientName,
        gsc: gscStatus,
        ga4: ga4Status,
      });
    }

    return NextResponse.json({
      synced: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/google/sync
 * Returns the current state of synced Google data for all clients.
 *
 * Auth: requireRole('admin') added in PR C as defence-in-depth.
 */
export async function GET(req: NextRequest) {
  const auth = requireRole(req, "admin", "/api/google/sync");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  const mappings = loadMappings();
  const dataDir = join(process.cwd(), "app", "data", "clients");

  const status = mappings.map((m) => {
    const gscPath = join(dataDir, `${m.projectId}-gsc.json`);
    const ga4Path = join(dataDir, `${m.projectId}-ga4.json`);

    let gscLastSync: string | null = null;
    let ga4LastSync: string | null = null;

    if (existsSync(gscPath)) {
      const data = JSON.parse(readFileSync(gscPath, "utf-8"));
      gscLastSync = data.fetchedAt || null;
    }
    if (existsSync(ga4Path)) {
      const data = JSON.parse(readFileSync(ga4Path, "utf-8"));
      ga4LastSync = data.fetchedAt || null;
    }

    return {
      projectId: m.projectId,
      clientName: m.clientName,
      gscProperty: m.gscProperty || null,
      ga4PropertyId: m.ga4PropertyId || null,
      gscLastSync,
      ga4LastSync,
    };
  });

  return NextResponse.json({ clients: status });
}
