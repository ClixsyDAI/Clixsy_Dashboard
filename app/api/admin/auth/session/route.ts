// =============================================================
// GET /api/admin/auth/session
// =============================================================
//
// Phase 1 PR B's silent re-auth endpoint for OAuth-signed-in
// users. Counterpart to /api/admin/auth/me (which reads the
// admin_token cookie, set by password sign-in).
//
// Reads the app_session cookie, verifies the HMAC signature +
// expiry via app/lib/app-session.ts, and returns the verified
// payload's email + role. The useAdminAuth hook calls this on
// mount BEFORE falling back to /api/admin/auth/me — OAuth
// sessions take precedence over the password fallback when
// both are present (which is the post-OAuth-sign-in state until
// PR C lands).
//
// The response also echoes `token` matching the admin_token
// shape (sha256 of ADMIN_PASSWORD:ADMIN_SESSION_SECRET) so
// useAdminAuth's existing sessionStorage protocol works
// unchanged. This is part of PR B's dual-cookie bridge: the
// OAuth callback issues admin_token alongside app_session, so a
// valid app_session ALWAYS implies a valid admin_token sits next
// to it. Computing the same hash here saves a separate cookie
// read.
//
// Auth posture: the cookie IS the credential — no separate gate.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { APP_SESSION_COOKIE_NAME, verifyAppSession } from "../../../../lib/app-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function computeAdminToken(): string {
  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret =
    process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  return createHash("sha256").update(`${correct}:${secret}`).digest("hex");
}

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get(APP_SESSION_COOKIE_NAME)?.value;
  const result = verifyAppSession(sessionCookie);
  if (!result.ok) {
    return NextResponse.json(
      { valid: false, reason: result.reason },
      { status: 401 },
    );
  }

  return NextResponse.json({
    token: computeAdminToken(),
    email: result.payload.email,
    role: result.payload.role,
  });
}
