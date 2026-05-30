// =============================================================
// GET /api/admin/auth/me
// =============================================================
//
// Reads the httpOnly admin_token cookie and, if valid, returns
// the token in the response body so the client can populate
// sessionStorage. Used by the useAdminAuth hook on mount to sync
// cookie → sessionStorage when a fresh tab inherits a valid 7-day
// cookie but has no sessionStorage entry.
//
// Cookie is httpOnly (set by /api/admin/auth POST) so the client
// can't read it directly. This endpoint is the supported bridge:
// the server reads the cookie, validates the hash, and echoes the
// value back through a same-origin response that the calling page
// is allowed to see.
//
// Auth posture: no separate gate — the cookie IS the credential.
// If the cookie matches the expected hash, the caller is signed
// in by definition.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "admin_token";

export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookieToken) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret =
    process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  const expected = createHash("sha256")
    .update(`${correct}:${secret}`)
    .digest("hex");

  if (cookieToken !== expected) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  return NextResponse.json({ token: cookieToken });
}
