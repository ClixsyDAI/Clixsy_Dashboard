import { NextRequest, NextResponse } from "next/server";
import { listGscProperties, listGa4Properties } from "../../../lib/google";
import { requireRole } from "../../../lib/require-role";
import { logAuthAudit } from "../../../lib/auth-audit";

/**
 * GET /api/google/discover
 * Lists all GSC and GA4 properties accessible to tempclixsyreports@gmail.com.
 * Used to build the client-to-property mapping.
 *
 * Auth: requireRole('admin') added in PR C as defence-in-depth.
 * Previously proxy-gate-only.
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "admin", "/api/google/discover");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  const result: {
    gsc: { count: number; properties: unknown[]; error?: string };
    ga4: { count: number; properties: unknown[]; error?: string };
  } = {
    gsc: { count: 0, properties: [] },
    ga4: { count: 0, properties: [] },
  };

  try {
    const gscProperties = await listGscProperties();
    result.gsc = { count: gscProperties.length, properties: gscProperties };
  } catch (error) {
    result.gsc.error = error instanceof Error ? error.message : String(error);
  }

  try {
    const ga4Properties = await listGa4Properties();
    result.ga4 = { count: ga4Properties.length, properties: ga4Properties };
  } catch (error) {
    result.ga4.error = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json(result);
}
