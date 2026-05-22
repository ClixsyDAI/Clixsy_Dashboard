import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

// Phase 8 follow-up: re-adds the cookie-issuance that PR #17 originally
// bundled with proxy.ts. PR #18's revert removed both; PR #19 only
// re-added the proxy, leaving signed-in users unable to pass the gate
// because nothing was writing the cookie the proxy reads.
//
// Cookie name MUST stay "admin_token" — that's the literal proxy.ts
// reads at req.cookies.get("admin_token"). If you rename here, rename
// there in the same commit.
//
// SameSite: "lax" (not "strict") so the cookie is sent on top-level
// cross-site navigations from /admin to /client/[id]. "strict" would
// drop the cookie on those navigations and the proxy would still
// redirect signed-in users back to /admin.
//
// Max-Age: 7 days. Long enough that AMs don't re-auth daily; short
// enough that the proper Phase 8 work can introduce a refresh pattern
// without months of stale long-lived cookies to migrate.
const COOKIE_NAME = "admin_token";
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function setAdminCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

/**
 * POST /api/admin/auth
 * Body: { password: string }
 *
 * Validates the admin password and returns a session token.
 * Password is checked against the ADMIN_PASSWORD env var.
 * Default password: "clixsy2024"
 *
 * On success: also sets the admin_token cookie (Phase 8 gate).
 */
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const correct = process.env.ADMIN_PASSWORD || "clixsy2024";

    if (password !== correct) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 }
      );
    }

    const secret = process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
    const token = createHash("sha256")
      .update(`${correct}:${secret}`)
      .digest("hex");

    const response = NextResponse.json({ token });
    return setAdminCookie(response, token);
  } catch {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400 }
    );
  }
}

/**
 * GET /api/admin/auth?token=...
 * Validates an existing session token.
 *
 * On valid: refreshes the admin_token cookie. Lets users who already
 * have a sessionStorage token from before the cookie existed get
 * silently cookied on next /admin mount-effect validate.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret = process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  const expected = createHash("sha256")
    .update(`${correct}:${secret}`)
    .digest("hex");

  const valid = token === expected;
  const response = NextResponse.json({ valid });
  if (valid) {
    setAdminCookie(response, token);
  }
  return response;
}
