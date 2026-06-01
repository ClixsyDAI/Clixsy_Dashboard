import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import defaultData from "../../data/team-assignments.json";
import { requireRole } from "../../lib/require-role";
import { logAuthAudit } from "../../lib/auth-audit";

const BLOB_KEY = "team-assignments.json";

// Phase 1 PR C: this file used to carry an inline `validateToken`
// duplicating the sha256(ADMIN_PASSWORD:ADMIN_SESSION_SECRET) dance
// from app/lib/admin-auth.ts. requireRole now wraps that helper for
// the password-fallback path AND adds app_session support, so the
// inline copy is gone. PUT below calls requireRole('admin').

/**
 * Load assignments: try Vercel Blob first, fall back to the bundled JSON.
 */
async function loadAssignments() {
  // Only try Blob if the token is configured
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { blobs } = await list({ prefix: BLOB_KEY });
      if (blobs.length > 0) {
        const res = await fetch(blobs[0].url);
        if (res.ok) {
          return await res.json();
        }
      }
    } catch (err) {
      console.warn("[team-assignments] Blob read failed, using default:", err);
    }
  }
  return defaultData;
}

/**
 * GET /api/team-assignments
 * Returns the current team assignment data (public, no auth required).
 */
export async function GET() {
  try {
    const data = await loadAssignments();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[team-assignments] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to load assignments" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/team-assignments
 * Updates assignments. Requires admin token in Authorization header.
 * Body: { assignments: Record<string, string[]>, employees?: string[] }
 *
 * Persists to Vercel Blob if BLOB_READ_WRITE_TOKEN is set; otherwise
 * returns an error instructing the admin to configure Blob storage.
 */
export async function PUT(req: NextRequest) {
  const auth = requireRole(req, "admin", "/api/team-assignments");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  try {
    const body = await req.json();
    const { assignments, employees } = body;

    if (!assignments || typeof assignments !== "object") {
      return NextResponse.json(
        { error: "Invalid payload: assignments object required" },
        { status: 400 }
      );
    }

    // Validate: each assignment must be an array of <=3 strings
    for (const [projectId, team] of Object.entries(assignments)) {
      if (!Array.isArray(team)) {
        return NextResponse.json(
          { error: `Invalid assignment for project ${projectId}` },
          { status: 400 }
        );
      }
      if (team.length > 3) {
        return NextResponse.json(
          { error: `Max 3 members per client (project ${projectId})` },
          { status: 400 }
        );
      }
    }

    const updated = {
      employees: employees || defaultData.employees,
      assignments,
    };

    // Persist to Vercel Blob
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          error:
            "BLOB_READ_WRITE_TOKEN not configured. Set it in Vercel environment variables to enable saving.",
        },
        { status: 503 }
      );
    }

    await put(BLOB_KEY, JSON.stringify(updated), {
      access: "public",
      addRandomSuffix: false,
    });

    console.log("[team-assignments] Assignments saved to Vercel Blob");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[team-assignments] PUT failed:", err);
    return NextResponse.json(
      { error: "Failed to save assignments" },
      { status: 500 }
    );
  }
}
