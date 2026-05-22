// =============================================================
// Workbook auth gate — Phase 8 emergency hotfix
// =============================================================
//
// Phase 8 hotfix per phase-8-discovery.md. Closes the PII-exposure
// gap surfaced 2026-05-22: nine read routes (and the `/client/[id]`
// page) were returning client PII to unauthenticated callers.
//
// This proxy is the **entire fix.** None of the nine vulnerable
// routes themselves are touched — keeping the change atomic and
// reversible. If the proxy causes any regression in production,
// reverting just this file restores the prior (open) behaviour.
//
// =============================================================
// File name & Next.js 16 conventions
// =============================================================
//
// **Next.js 16 renamed `middleware.ts` → `proxy.ts`** with three
// matching changes:
//   - function name:   `middleware()` → `proxy()`
//   - config export:   `config`       → `proxyConfig`
//   - default runtime: Edge           → Node.js
//
// The repo runs Next.js 16.1.7 (per build output across Phases 5–7).
// Using the old `middleware.ts` name would not be picked up by the
// router and the gate would silently never fire. The operator's
// brief said `app/middleware.ts`; the actual location for Next.js
// is the project root (sibling to `app/`), and the file name follows
// the v16 convention.
//
// Node.js runtime (now default) lets us use `node:crypto.createHash`
// — same primitive `app/lib/admin-auth.ts` and `app/api/admin/auth`
// use, so the token comparison stays consistent across the auth
// surface.
//
// =============================================================
// Auth shape
// =============================================================
//
// The gate reads `req.cookies.get("admin_token")` and compares to
// `sha256(ADMIN_PASSWORD + ":" + ADMIN_SESSION_SECRET)`. Identical
// computation to `app/lib/admin-auth.ts` and the `/api/admin/auth`
// route — single source of truth for what counts as a valid token.
//
// =============================================================
// Cookie issuance (NOT in this file)
// =============================================================
//
// The cookie this proxy reads is issued by
// `app/api/admin/auth/route.ts` — both the POST (sign-in) and the
// GET (?token=... validate) paths set `Set-Cookie: admin_token=…;
// HttpOnly; ...` on success. The existing sessionStorage write
// continues unchanged so the Phase 6/7 Bearer-header API call paths
// keep working — the cookie is additive, not a replacement.
//
// =============================================================
// Allow-through surfaces
// =============================================================
//
// The matcher below opts INTO gating for the nine vulnerable
// surfaces only. Everything else is allowed unconditionally:
//
//   /                   — public landing page
//   /admin              — sign-in form (self-gating client-side)
//   /admin/*            — admin dashboard pages
//   /api/admin/*        — auth + admin endpoints
//   /api/auth/*         — Google OAuth callback flow
//   /api/sync/*         — Basecamp sync (uses SYNC_API_KEY when set)
//   /share/*            — client-facing report (HMAC-signed token gate)
//   /_next/*            — Next.js static assets
//   /favicon.ico        — favicon
//
// =============================================================
// Gated surfaces (from phase-8-discovery.md §A)
// =============================================================
//
//   /client/:path*
//   /api/onboarding/:path*
//   /api/task-summaries/:path*
//   /api/meeting-prep/:path*
//   /api/content/:path*
//   /api/chat/:path*
//   /api/ai-summary/:path*
//   /api/google/:path*
//   /api/team-assignments/:path*

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const proxyConfig = {
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

function computeExpectedToken(): string {
  // Mirrors `/api/admin/auth/route.ts` and `app/lib/admin-auth.ts`
  // — same fallback defaults so local-dev behaviour is identical.
  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret = process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  return createHash("sha256").update(`${correct}:${secret}`).digest("hex");
}

export function proxy(req: NextRequest) {
  const token = req.cookies.get("admin_token")?.value;
  const expected = computeExpectedToken();

  if (token && token === expected) {
    return NextResponse.next();
  }

  // Unauthorized. Branch by request kind.
  const path = req.nextUrl.pathname;

  if (path.startsWith("/api/")) {
    // JSON 401 for API callers (no redirect — they're typically
    // fetch() calls, not browser navigations).
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Browser navigation: redirect to /admin. No return-URL handling
  // yet — that's proper Phase 8 work. The AM has to navigate back
  // manually after signing in (existing /admin behaviour drops
  // them on the admin dashboard).
  const adminUrl = new URL("/admin", req.url);
  return NextResponse.redirect(adminUrl);
}
