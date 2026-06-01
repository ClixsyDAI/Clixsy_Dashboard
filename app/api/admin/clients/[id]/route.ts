// =============================================================
// POST /api/admin/clients/[id]
// =============================================================
//
// AM-facing edit endpoint for projects.json entries — the
// workbook-side companion to the GHL pivot. Lets an AM assign a
// J-number, fix the client display name, and add a description
// after the webhook receiver creates a fresh entry (those arrive
// j_number=null / description=null and need human input).
//
// Only the three AM-editable fields are accepted: name, j_number,
// description. Read-only fields (id, vertical, ghl_contact_id,
// am_ghl_user_id, website_url) are preserved by
// updateProjectInManifest, never touched by this route.
//
// Auth: requireRole('admin') via app_session OR admin_token bearer.
// PR C migrated from the bare validateAdminToken call to the
// role-aware helper so future viewer-tier users can't edit
// manifest entries.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/app/lib/require-role";
import { logAuthAudit } from "@/app/lib/auth-audit";
import { updateProjectInManifest } from "@/app/lib/projects";

export const runtime = "nodejs";

// j_number is a stringified positive integer (no leading + or -),
// or null when an AM hasn't claimed the J-tag yet. Empty string from
// the form is coerced to null at the schema boundary so the rest of
// the codebase only ever sees null | "\d+".
//
// description allows null and empty strings — many existing entries
// hold real service-mix metadata, but for fresh GHL-created entries
// it's expected to stay null until an AM fills it in.
const PatchSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  j_number: z
    .union([z.string().regex(/^\d+$/, "j_number must be digits only"), z.null()])
    .nullable(),
  description: z.union([z.string(), z.null()]).nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(req, "admin", "/api/admin/clients/[id]");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing client id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid payload",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  // Normalize empty strings on the optional fields → null so the
  // committed JSON stays clean (matches what the webhook receiver
  // writes for new GHL entries).
  const patch = {
    name: parsed.data.name,
    j_number:
      parsed.data.j_number === null || parsed.data.j_number === ""
        ? null
        : parsed.data.j_number,
    description:
      parsed.data.description === null || parsed.data.description === ""
        ? null
        : parsed.data.description,
  };

  try {
    const result = await updateProjectInManifest(id, patch);
    if (!result.found) {
      return NextResponse.json(
        { error: "Client not found", id },
        { status: 404 },
      );
    }
    console.log(
      `[admin-clients] updated id=${id} name="${result.updated.name}" j_number=${result.updated.j_number}`,
    );
    return NextResponse.json({ ok: true, updated: result.updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[admin-clients] update failed id=${id} error=${message}`,
    );
    return NextResponse.json(
      { error: "Failed to update client", details: message },
      { status: 500 },
    );
  }
}
