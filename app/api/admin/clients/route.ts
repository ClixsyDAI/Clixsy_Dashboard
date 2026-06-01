// =============================================================
// GET /api/admin/clients
// =============================================================
//
// Returns the live projects.json from the default branch (NOT the
// deployed bundle). Used by the admin client editor so an AM can
// see entries the GHL webhook just created without waiting for
// the next Vercel redeploy to bake them into the bundle.
//
// Admin-auth gated — the manifest contains GHL contact ids and
// AM user ids that shouldn't leak through an unauthenticated GET.
// (The dashboard's public read uses the deployed bundle, which is
// fine because the public surface is the home page card list, not
// the raw JSON.)

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/app/lib/require-role";
import { logAuthAudit } from "@/app/lib/auth-audit";
import { getFileContents } from "@/app/lib/github";
import type { Project } from "@/app/lib/projects";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireRole(req, "viewer", "/api/admin/clients");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  try {
    const file = await getFileContents("app/data/projects.json");
    if (!file) {
      return NextResponse.json(
        { error: "projects.json missing on default branch" },
        { status: 500 },
      );
    }
    const projects = JSON.parse(file.content) as Project[];
    return NextResponse.json({ projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin-clients] live read failed:", message);
    return NextResponse.json(
      { error: "Failed to read manifest", details: message },
      { status: 500 },
    );
  }
}
