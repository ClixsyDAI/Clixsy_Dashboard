import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

/**
 * Cookie issuance helper. Phase 8 hotfix added the cookie so the
 * project-root `proxy.ts` (Next.js 16's renamed middleware) can
 * read it server-side and gate the PII-exposing routes. The cookie
 * carries the exact same `sha256(password:secret)` digest the
 * existing sessionStorage flow uses — both stay in lockstep.
 *
 * HttpOnly so client JS can't read it; the sessionStorage write
 * in `/admin/page.tsx` continues unchanged for the
 * `Authorization: Bearer` API-call path. The cookie is additive,
 * not a replacement.
 *
 * Session-cookie lifetime (no maxAge): dies on browser close.
 * Matches the spirit of sessionStorage's per-session lifetime;
 * the proper Phase 8 plan can introduce a longer-lived refresh
 * pattern if needed.
 */
function setAdminCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set("admin_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
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
 * Phase 8 hotfix: on success, also sets an HttpOnly `admin_token`
 * cookie carrying the same token value. The cookie is what
 * `proxy.ts` reads to gate the PII-exposing routes.
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

    // Generate a simple session token (hash of password + a server-side secret)
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
 * Phase 8 hotfix: on success-validate, ALSO sets the
 * `admin_token` cookie. This smoothly upgrades users who already
 * have a sessionStorage token from before the hotfix — when the
 * `/admin` page mount-effect calls this with their existing token,
 * they get auto-cookied without re-entering their password.
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
