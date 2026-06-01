// =============================================================
// requireRole — role-aware auth gate for workbook route handlers
// =============================================================
//
// Phase 1 PR C. Single entry point every protected route uses to
// check both authentication AND role-rank authorization before
// processing the request.
//
// Replaces the per-route inline `validateAdminToken(req)` checks
// scattered across the admin + onboarding + team-assignments
// routes, and adds belt-and-braces coverage to the proxy-gate-only
// routes (/api/google/*, /api/content, /api/meeting-prep,
// /api/ai-summary, /api/chat) which had no in-handler check.
//
// =============================================================
// Auth source order (the dual-cookie bridge — PR B carried this
// forward, PR C keeps it indefinitely per operator's decision)
// =============================================================
//
//   1. app_session cookie (PR B) — HMAC-signed payload carrying
//      verified { email, role, iat, exp }. Source of truth for
//      OAuth-signed-in users. Verified via verifyAppSession.
//
//   2. validateAdminToken(req) — Authorization: Bearer ${sha256}
//      header check (the workbook's pre-Phase-1 admin auth).
//      Password sign-in users still rely on this; the OAuth
//      callback also issues the matching cookie as the "belt"
//      half of the bridge so existing endpoints keep working
//      while we migrate them to requireRole.
//
// If neither check passes → 401 + audit event.
// If a check passes but the role rank is too low → 403 + audit event.
//
// Password users (validateAdminToken-via-header path) synthesize
// role='admin' + email='(password)'. They have always had full
// admin access; we don't lower their rank.
//
// =============================================================
// Audit log discipline — pure function returns the event to log
// =============================================================
//
// requireRole does NOT write to auth_audit_events directly. On
// rejection it returns an `audit` field describing the event the
// caller should log via the centralized logAuthAudit helper. This
// keeps requireRole a pure function (testable without stubbing
// the Supabase write path) while preserving the established
// after()-based discipline.
//
// Standard call-site shape:
//
//   const auth = requireRole(req, "admin", "/api/admin/clients");
//   if (!auth.ok) {
//     logAuthAudit(auth.audit);
//     return NextResponse.json(
//       { ok: false, reason: auth.reason },
//       { status: auth.status },
//     );
//   }
//   // auth.ctx.email + auth.ctx.role available below.
//
// Two event types this module produces (per migration 011's header
// comment + Phase 1 PR C plan):
//
//   - requireRole_rejected_unauthenticated
//       payload: { method, endpoint }
//   - requireRole_rejected_forbidden
//       payload: { method, endpoint, user_role, required_role, email }
//
// The HTTP method is captured in both so log queries can
// differentiate "blocked on GET" vs "blocked on POST" of the same
// endpoint.

import type { NextRequest } from "next/server";
import {
  APP_SESSION_COOKIE_NAME,
  verifyAppSession,
  type AppSessionRole,
} from "./app-session";
import { validateAdminToken } from "./admin-auth";
import type { AuthAuditEventType } from "./auth-audit";

export type Role = AppSessionRole; // 'super_admin' | 'admin' | 'viewer'

export type AuthCtx = {
  email: string;
  role: Role;
  via: "app_session" | "admin_token";
};

export type RejectionAudit = {
  eventType: AuthAuditEventType;
  actorEmail: string | null;
  payload: Record<string, unknown>;
};

export type RequireRoleResult =
  | { ok: true; ctx: AuthCtx }
  | {
      ok: false;
      status: 401 | 403;
      reason: "unauthenticated" | "forbidden";
      audit: RejectionAudit;
    };

// Rank order: higher number = more permissive role superset.
const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  admin: 2,
  super_admin: 3,
};

function hasRank(actual: Role, minimum: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

/**
 * Gate a route handler on authentication + role rank.
 *
 * `endpoint` is the route's canonical URL path (e.g.
 * "/api/admin/clients/[id]") — passed in by the caller rather
 * than derived from req.url so the audit log carries the canonical
 * route shape with [param] placeholders intact, rather than the
 * realised URL with the actual id baked in.
 */
export function requireRole(
  req: NextRequest,
  minRole: Role,
  endpoint: string,
): RequireRoleResult {
  const method = req.method;

  // Layer 1: app_session cookie (OAuth sign-in path).
  const sessionCookie = req.cookies.get(APP_SESSION_COOKIE_NAME)?.value;
  const verified = verifyAppSession(sessionCookie);
  if (verified.ok) {
    const { email, role } = verified.payload;
    if (!hasRank(role, minRole)) {
      return {
        ok: false,
        status: 403,
        reason: "forbidden",
        audit: {
          eventType: "requireRole_rejected_forbidden",
          actorEmail: email,
          payload: {
            method,
            endpoint,
            user_role: role,
            required_role: minRole,
            email,
          },
        },
      };
    }
    return {
      ok: true,
      ctx: { email, role, via: "app_session" },
    };
  }

  // Layer 2: Authorization: Bearer <admin_token> fallback (password sign-in path).
  const adminCheck = validateAdminToken(req);
  if (adminCheck.ok) {
    // Password sign-in synthesises admin. They've always had full
    // admin access; no role distinction available from the bearer
    // header alone.
    const passwordRole: Role = "admin";
    if (!hasRank(passwordRole, minRole)) {
      // Only fires for minRole === 'super_admin' (since password
      // role is admin). Current PR C call sites don't request
      // super_admin; PR D will.
      return {
        ok: false,
        status: 403,
        reason: "forbidden",
        audit: {
          eventType: "requireRole_rejected_forbidden",
          actorEmail: "(password)",
          payload: {
            method,
            endpoint,
            user_role: passwordRole,
            required_role: minRole,
            email: "(password)",
          },
        },
      };
    }
    return {
      ok: true,
      ctx: { email: "(password)", role: passwordRole, via: "admin_token" },
    };
  }

  // Neither layer accepted.
  return {
    ok: false,
    status: 401,
    reason: "unauthenticated",
    audit: {
      eventType: "requireRole_rejected_unauthenticated",
      actorEmail: null,
      payload: { method, endpoint },
    },
  };
}
