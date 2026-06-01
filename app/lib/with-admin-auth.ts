// =============================================================
// withAdminAuth — canonical admin-route wrapper
// =============================================================
//
// Phase 1 PR D-1. Every route under app/api/admin/** exports its
// handler wrapped with this HOF. The wrapper runs the four-layer
// admin stack:
//
//   1. assertSameOrigin (CSRF)            — 403 origin_rejected
//   2. requireRole (auth + session_version) — 401/403/503
//   3. enforceRateLimit (30/min/actor)    — 429 rate_limited
//   4. Inner handler with the verified AuthCtx
//
// Layers 1, 2, 3 audit themselves on rejection. The inner handler
// is responsible for its own audit on success (typically via the
// RPC the route calls — RPCs write their own audit row in the
// same transaction).
//
// The CI ESLint rule (.eslintrc.json custom rule) asserts every
// file under app/api/admin/**/route.ts uses this HOF. Bypass = CI
// failure. This is the load-bearing defence against a future
// route forgetting requireRole.

import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin } from "./csrf";
import { requireRole, type AuthCtx, type Role } from "./require-role";
import { enforceRateLimit, type ActionClass } from "./rate-limit";
import { logAuthAudit } from "./auth-audit";
import { auditHandlerRejection, buildRequestMetadata } from "./audit-metadata";

export type AdminRouteContext = {
  auth: AuthCtx;
  requestMetadata: ReturnType<typeof buildRequestMetadata>;
};

export type AdminRouteOptions = {
  /** Canonical route path with [param] placeholders. Used in audit endpoint field. */
  endpoint: string;
  /** Minimum role required. Routes that mutate require super_admin; reads can allow admin. */
  minRole: Role;
  /** Rate-limit action class. Mutation routes share users_mutation; reads can skip rate-limit. */
  actionClass?: ActionClass;
};

/**
 * Wrap an admin route handler with the four-layer canonical stack.
 *
 * Inner-handler signature matches Next.js route handler params, with
 * an added `ctx` carrying the auth context and request metadata.
 */
export function withAdminAuth<TParams extends Record<string, string | string[]> = Record<string, never>>(
  options: AdminRouteOptions,
  handler: (
    req: NextRequest,
    routeArgs: { params: Promise<TParams> },
    ctx: AdminRouteContext,
  ) => Promise<NextResponse>,
): (req: NextRequest, routeArgs: { params: Promise<TParams> }) => Promise<NextResponse> {
  return async (req, routeArgs) => {
    const requestMetadata = buildRequestMetadata(req);

    // Layer 1: CSRF / Origin
    const csrf = assertSameOrigin(req);
    if (!csrf.ok) {
      auditHandlerRejection({
        eventType: "handler_origin_rejected",
        actorEmail: null,
        endpoint: options.endpoint,
        method: req.method,
        reason: "origin_rejected",
        additional: {
          observed_origin: csrf.observed_origin,
          observed_sec_fetch_site: csrf.observed_sec_fetch_site,
          csrf_subreason: csrf.reason,
        },
        requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "origin_rejected" },
        { status: 403 },
      );
    }

    // Layer 2: requireRole
    const auth = await requireRole(req, options.minRole, options.endpoint);
    if (!auth.ok) {
      logAuthAudit(auth.audit);
      const headers: Record<string, string> = {};
      if (auth.status === 503) {
        headers["Retry-After"] = "5";
      }
      return NextResponse.json(
        { ok: false, reason: auth.reason },
        { status: auth.status, headers },
      );
    }

    // Layer 3: rate-limit (only if actionClass specified — reads skip).
    if (options.actionClass) {
      const actorKey = `email:${auth.ctx.email.toLowerCase()}`;
      const rl = await enforceRateLimit(actorKey, options.actionClass);
      if (!rl.ok && rl.reason === "limit_exceeded") {
        auditHandlerRejection({
          eventType: "handler_rate_limited",
          actorEmail: auth.ctx.email,
          endpoint: options.endpoint,
          method: req.method,
          reason: "rate_limited",
          additional: { count: rl.count, retry_after_seconds: rl.retry_after_seconds },
          requestMetadata,
        });
        return NextResponse.json(
          { ok: false, reason: "rate_limited" },
          {
            status: 429,
            headers: { "Retry-After": String(rl.retry_after_seconds) },
          },
        );
      }
      if (!rl.ok && rl.reason === "transient_error") {
        // Supabase blip on the rate-limit hit. Fail SOFT (let the request
        // through) — the alternative (503) would mass-block legitimate
        // admins during a Supabase blip, which is the wrong tradeoff for
        // the limit's purpose (abuse prevention, not safety-critical).
        // The mutation RPC behind this route still runs its own checks.
        console.warn(
          `[withAdminAuth] rate-limit transient_error on ${options.endpoint}; proceeding`,
        );
      }
      if (rl.ok && rl.transitioned_to_throttled) {
        // Audit the boundary crossing once — useful for noticing actors
        // sustaining at the limit. (Most calls past this point will 429
        // on the NEXT request; we only audit the transition.)
        auditHandlerRejection({
          eventType: "handler_rate_limited",
          actorEmail: auth.ctx.email,
          endpoint: options.endpoint,
          method: req.method,
          reason: "rate_limited",
          additional: { count: rl.count, transitioned: true },
          requestMetadata,
        });
      }
    }

    // Layer 4: hand off to inner handler.
    return handler(req, routeArgs, { auth: auth.ctx, requestMetadata });
  };
}
