// =============================================================
// Workbook auth gate — Phase 8 redirect-loop FIX
// =============================================================
//
// Closes the same PII exposure the reverted PR #17 targeted (nine
// workbook routes returning client PII to unauthenticated callers,
// per phase-8-discovery.md §A), without the redirect-loop regression
// that locked /admin out of production.
//
// =============================================================
// Why PR #17 looped
// =============================================================
//
// PR #17 exported the matcher as `proxyConfig`. Next.js 16's static
// analyser only reads the export literally named `config`
// (verified in node_modules/next/dist/build/analysis/
// get-page-static-info.js:456 — it calls
// `extractExportedConstValue(ast, 'config')`). With no matcher
// recognised, the proxy ran on every request including /admin →
// no admin_token cookie → redirect to /admin → loop.
//
// This file fixes that two ways:
//   1. The matcher export below is named `config` (the name Next.js
//      actually reads).
//   2. The function ALSO does an explicit in-function allowlist
//      check, so if the matcher ever silently fails again the
//      function defends itself. Belt-and-braces — matcher
//      misconfigurations don't surface as build errors.
//   3. A loop-detection assertion throws if /admin would ever reach
//      the redirect branch. Hard guarantee against this exact bug
//      class reoccurring.
//
// =============================================================
// Auth shape
// =============================================================
//
// The gate accepts EITHER of two cookies (Phase 1 PR B introduced
// the second one alongside Google OAuth):
//
//   1. `admin_token` — sha256(ADMIN_PASSWORD:ADMIN_SESSION_SECRET).
//      Set by `app/api/admin/auth/route.ts` (POST password sign-in)
//      and by the OAuth callback (dual-cookie bridge).
//
//   2. `app_session` — HMAC-SHA256 signed payload carrying
//      { email, role, iat, exp }. Set by `/admin/auth/callback`
//      when a Google OAuth sign-in succeeds against app_users.
//      Verified via app/lib/app-session.ts.
//
// Either cookie passing the check is sufficient. The dual-cookie
// state is transitional — PR C will remove the admin_token
// shadow-issue once requireRole() rolls across the protected
// endpoints.

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { validateReturnPath } from "./app/lib/return-url";
import {
  APP_SESSION_COOKIE_NAME,
  verifyAppSession,
} from "./app/lib/app-session";

// Matcher tells Next.js which paths to invoke the proxy on. We opt
// IN only the nine PII-exposing surfaces. Anything not listed here
// — including /admin, /, /_next/*, /api/admin/*, /share/* — never
// hits the proxy at all.
//
// IMPORTANT: This export MUST be named `config`. Next.js 16's
// static analyser ignores any other name (e.g. `proxyConfig`),
// which would silently make the proxy run on every path.
export const config = {
  matcher: [
    "/client/:path*",
    "/api/onboarding/:path*",
    "/api/task-summaries/:path*",
    "/api/meeting-prep/:path*",
    "/api/content/:path*",
    "/api/chat/:path*",
    "/api/ai-summary/:path*",
    "/api/google/:path*",
    "/api/team-assignments/:path*",
  ],
};

// =============================================================
// In-function allowlist
// =============================================================
//
// Belt-and-braces against matcher misconfiguration. Even if the
// `config` export above is mis-named or the matcher fails to
// register, these paths short-circuit to NextResponse.next() at
// the top of the function before any auth check runs.
//
// Walkthrough with `/admin` as input:
//   path === "/admin"  →  ALLOW_EXACT.has(path) is true  →  return next()
// → /admin never reaches the redirect branch, no loop possible.
//
// Walkthrough with `/admin/whatever` as input:
//   ALLOW_PREFIXES.some(p => path.startsWith(p)) matches "/admin/"
// → return next()
//
// Walkthrough with `/client/40435636` as input:
//   not in ALLOW_EXACT, no ALLOW_PREFIXES match → falls through to
//   the gate check.
const ALLOW_EXACT = new Set<string>([
  "/",
  "/admin",
  "/favicon.ico",
]);

const ALLOW_PREFIXES: readonly string[] = [
  "/admin/",
  "/api/admin/",
  "/api/auth/",
  "/api/sync/",
  "/share/",
  "/api/share/",
  "/_next/",
];

function isAllowListed(path: string): boolean {
  if (ALLOW_EXACT.has(path)) return true;
  for (const prefix of ALLOW_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function computeExpectedToken(): string {
  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret = process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  return createHash("sha256").update(`${correct}:${secret}`).digest("hex");
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Layer 1: explicit allowlist short-circuit. Authoritative even
  // if the matcher misfires.
  if (isAllowListed(path)) {
    return NextResponse.next();
  }

  // Layer 2: auth check. Either cookie is sufficient.
  //
  // admin_token = password sign-in (existing path), sha256 hash
  // compared to ADMIN_PASSWORD:ADMIN_SESSION_SECRET.
  //
  // app_session = Google OAuth sign-in (Phase 1 PR B), HMAC-signed
  // payload carrying email + role + expiry. Verified by
  // app/lib/app-session.ts.
  //
  // After PR B's callback the user has BOTH cookies set (the
  // dual-cookie bridge). The OR here is forward-looking for PR C
  // when admin_token shadow-issue is dropped.
  const adminToken = req.cookies.get("admin_token")?.value;
  const expected = computeExpectedToken();
  if (adminToken && adminToken === expected) {
    return NextResponse.next();
  }
  const appSessionCookie = req.cookies.get(APP_SESSION_COOKIE_NAME)?.value;
  if (appSessionCookie && verifyAppSession(appSessionCookie).ok) {
    return NextResponse.next();
  }

  // Unauthorized API calls return 401 JSON — fetch clients can
  // surface the error inline rather than chasing a redirect.
  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Layer 3: loop-detection assertion. If we somehow reach the
  // redirect branch with /admin as the path, the allowlist failed
  // — refuse to ship the redirect rather than send the user into a
  // /admin → /admin loop. Surfaces the bug as a 500 (visible) instead
  // of a silent infinite redirect (invisible until a user complains).
  if (path === "/admin" || path.startsWith("/admin/")) {
    throw new Error(
      `proxy.ts loop-detection: ${path} reached the redirect-to-/admin branch. ` +
      `The allowlist should have short-circuited this path. Refusing to redirect ` +
      `to prevent a /admin → /admin loop.`,
    );
  }

  // Phase 8 proper PR A: carry the original path through sign-in so
  // AMs clicking a Slack /client/<id> link end up on the right page
  // after auth. The path is strictly validated by the shared helper
  // — only paths under one of the gated prefixes (the matcher list)
  // are appended as ?return=. Query string + fragment are dropped
  // upstream (we never set them on the redirect target).
  //
  // Open-redirect defence:
  //   1. Path-only (no query, no fragment) — we never put them in
  //      the param, and the validator rejects any input that does.
  //   2. The validator's whitelist + encoding checks (see
  //      app/lib/return-url.ts §3.2 of the plan) reject any
  //      attempt to forge //evil.com, http://..., javascript:, etc.
  //   3. /admin re-validates the param after sign-in before
  //      router.replace'ing — neither side trusts the other.
  const adminUrl = new URL("/admin", req.url);
  const returnCandidate = validateReturnPath(path);
  if (returnCandidate.ok) {
    adminUrl.searchParams.set("return", returnCandidate.path);
  }
  return NextResponse.redirect(adminUrl);
}
