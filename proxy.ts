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
// Auth shape (unchanged from PR #17)
// =============================================================
//
// Reads `req.cookies.get("admin_token")` and compares to
// `sha256(ADMIN_PASSWORD + ":" + ADMIN_SESSION_SECRET)`. Same
// computation as `app/lib/admin-auth.ts` and the
// `/api/admin/auth` route. Cookie issuance happens in
// `app/api/admin/auth/route.ts` (POST sign-in + GET validate).

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

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

  // Layer 2: auth check.
  const token = req.cookies.get("admin_token")?.value;
  const expected = computeExpectedToken();
  if (token && token === expected) {
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

  const adminUrl = new URL("/admin", req.url);
  return NextResponse.redirect(adminUrl);
}
