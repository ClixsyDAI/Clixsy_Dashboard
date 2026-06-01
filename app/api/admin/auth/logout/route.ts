// =============================================================
// POST /api/admin/auth/logout
// =============================================================
//
// Clears the admin_token + app_session cookies server-side. Needed
// because the /admin page's handleLogout previously only cleared
// sessionStorage — adequate before the mount-effect's cookie-bridge
// fix because the post-reload mount-effect saw empty sessionStorage
// and rendered LoginScreen. After the fix, the mount-effect reads
// /api/admin/auth/session and /api/admin/auth/me which re-authenticate
// from the still-present cookies, so the user-visible Sign Out button
// would loop back to AdminDashboard. This endpoint closes the gap.
//
// Both cookies are httpOnly so JS can't clear them directly; clearing
// them requires a server response with Set-Cookie max-age=0.
//
// Auth posture: no separate gate — sign-out is unauthenticated. The
// endpoint just expires the cookies; if the caller had none, the
// Set-Cookie headers are a no-op.

import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE_NAME } from "../../../../lib/app-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN_COOKIE = "admin_token";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const isProd = process.env.NODE_ENV === "production";
  // Match the path + sameSite + secure of the original Set-Cookie so
  // the browser identifies the cookie correctly and overwrites it.
  for (const name of [APP_SESSION_COOKIE_NAME, ADMIN_TOKEN_COOKIE]) {
    res.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}
