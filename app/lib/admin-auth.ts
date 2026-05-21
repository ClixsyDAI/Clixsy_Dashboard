// =============================================================
// admin-auth — shared bearer-token check for workbook admin routes
// =============================================================
//
// Phase 6 PR A per phase-6-plan.md §5.5 step (4).
//
// The workbook's admin auth pattern: an admin password is hashed
// with a server-side secret (sha256(`${ADMIN_PASSWORD}:${SECRET}`))
// and the resulting hex digest is the session token. The token
// rides in an Authorization: Bearer ${token} header on each
// protected request. Today the validation logic is inlined in
// `app/api/team-assignments/route.ts` and the GET handler at
// `app/api/admin/auth/route.ts`.
//
// Phase 6 adds two more protected routes
// (`/api/onboarding/reminders`, `/api/onboarding/regenerate-pin`)
// which both need the same check. Extract once so the four
// call sites can converge on the same helper as drift becomes
// likely. The two existing routes are NOT retrofitted in this PR
// (out of Phase 6 scope); the helper sits ready for them when
// touched next.

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Validate the workbook admin bearer token on a NextRequest.
 * Reads `Authorization: Bearer <token>` and compares against the
 * expected sha256 digest. Returns a discriminated union so the
 * caller composes its own response (with whatever extra fields
 * the route needs in the body).
 *
 * On Production both `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`
 * are set. The defaults exist so local dev / preview keeps working
 * without an env-var dance — matches the behaviour of the existing
 * `/api/admin/auth` route.
 */
export function validateAdminToken(req: NextRequest): AdminAuthResult {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return { ok: false, status: 401, error: "Missing Authorization header" };
  }
  const token = authHeader.replace(/^Bearer\s+/, "");
  if (!token) {
    return { ok: false, status: 401, error: "Empty bearer token" };
  }

  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret =
    process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  const expected = createHash("sha256")
    .update(`${correct}:${secret}`)
    .digest("hex");

  if (token !== expected) {
    return { ok: false, status: 401, error: "Invalid admin token" };
  }
  return { ok: true };
}
