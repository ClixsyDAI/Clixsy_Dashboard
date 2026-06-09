// =============================================================
// CSRF — Origin allowlist check (server-side)
// =============================================================
//
// Phase 1 PR D-1. Defence-in-depth against cross-origin POSTs:
//
//   1. SameSite=lax on app_session + admin_token cookies (set
//      in the OAuth callback / password sign-in). Already in
//      place from PR B. SameSite=lax means top-level cross-site
//      GETs send the cookie, but cross-site POSTs do not.
//
//   2. This module — Origin header allowlist on every state-
//      changing route. SameSite is the browser's defence;
//      Origin allowlist is the server's defence. Either one
//      alone is sufficient against unsophisticated attackers;
//      together they raise the bar.
//
//   3. Sec-Fetch-Site header check — modern browsers send this
//      header on every request. cross-site = explicit reject.
//      Older browsers omit the header; we don't fall back to
//      "allow" — Origin check carries the load.
//
// =============================================================
// Allowlist construction
// =============================================================
//
// Production canonical URL:
//   https://workbook.clixsy.com
// Vercel domain:
//   https://clixsy-dashboard.vercel.app
// Project alias:
//   https://clixsy-dashboard-clixsys-projects.vercel.app
// Per-deployment + branch URLs (preview):
//   https://clixsy-dashboard-<slug>-clixsys-projects.vercel.app
// Local dev (NODE_ENV !== 'production'):
//   http://localhost:3000
//   http://localhost:3001
//
// The regex below matches any Vercel preview URL under the
// clixsys-projects team scope. This is intentional — preview
// URLs are deliberately at the project's discretion, and CSRF
// from one preview to another is not a relevant threat model
// (they're all under the same Vercel project = same code).
//
// Anything else is rejected.

import type { NextRequest } from "next/server";

const PRODUCTION_ORIGINS = new Set<string>([
  "https://workbook.clixsy.com",
  "https://clixsy-dashboard.vercel.app",
  "https://clixsy-dashboard-clixsys-projects.vercel.app",
]);

const PREVIEW_ORIGIN_PATTERN =
  /^https:\/\/clixsy-dashboard-[a-z0-9-]+-clixsys-projects\.vercel\.app$/;

const DEV_ORIGINS = new Set<string>([
  "http://localhost:3000",
  "http://localhost:3001",
]);

const STATE_CHANGING_METHODS = new Set<string>([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export type CsrfResult =
  | { ok: true }
  | {
      ok: false;
      reason: "origin_missing" | "origin_disallowed" | "sec_fetch_cross_site";
      observed_origin: string | null;
      observed_sec_fetch_site: string | null;
    };

/**
 * Assert that the request's Origin (and Sec-Fetch-Site, if present)
 * is in the allowlist. GETs are allowed without an Origin header —
 * SameSite=lax on the cookie is sufficient for top-level GET.
 *
 * State-changing methods (POST/PUT/PATCH/DELETE) require:
 *   - Origin header present
 *   - Origin matches production OR preview allowlist
 *   - Sec-Fetch-Site is NOT 'cross-site' (if header is present)
 *
 * Note: this check is intentionally strict. The operator accepts a
 * narrow allowlist over a permissive one — adding new origins is a
 * deliberate scope expansion.
 */
export function assertSameOrigin(req: NextRequest): CsrfResult {
  // Non-state-changing methods skip the check (covered by SameSite=lax).
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return { ok: true };
  }

  const origin = req.headers.get("origin");
  const secFetchSite = req.headers.get("sec-fetch-site");

  // Modern browsers always set Sec-Fetch-Site. 'cross-site' is an explicit
  // signal that the request came from a different site — reject regardless
  // of what Origin says.
  if (secFetchSite === "cross-site") {
    return {
      ok: false,
      reason: "sec_fetch_cross_site",
      observed_origin: origin,
      observed_sec_fetch_site: secFetchSite,
    };
  }

  if (!origin) {
    return {
      ok: false,
      reason: "origin_missing",
      observed_origin: null,
      observed_sec_fetch_site: secFetchSite,
    };
  }

  const allowed =
    PRODUCTION_ORIGINS.has(origin) ||
    PREVIEW_ORIGIN_PATTERN.test(origin) ||
    (process.env.NODE_ENV !== "production" && DEV_ORIGINS.has(origin));

  if (!allowed) {
    return {
      ok: false,
      reason: "origin_disallowed",
      observed_origin: origin,
      observed_sec_fetch_site: secFetchSite,
    };
  }

  return { ok: true };
}

/** @internal Test helpers — not part of the production API. */
export const __testing__ = {
  PRODUCTION_ORIGINS,
  PREVIEW_ORIGIN_PATTERN,
  DEV_ORIGINS,
};
