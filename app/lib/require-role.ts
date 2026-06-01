// =============================================================
// requireRole — role-aware auth gate for workbook route handlers
// =============================================================
//
// Phase 1 PR C introduced this helper as a synchronous function.
// Phase 1 PR D-0 makes it ASYNC because session-version revocation
// requires a per-request read of app_users.session_version from
// Supabase. See migration 012 for the column definition.
//
// =============================================================
// Auth source order (PR D-0 makes the cookie authoritative for
// OAuth-signed-in users; bearer fallback only when no cookie is
// present at all)
// =============================================================
//
// Layer 1 — app_session cookie (PR B Google OAuth path):
//   verify HMAC + payload shape via verifyAppSession()
//   read app_users.session_version for the cookie's email
//   compare against the cookie's session_version claim
//   - mismatch (or app_users row gone) -> 401 session_revoked
//   - match -> role-rank check against minRole
//
// Layer 2 — Authorization: Bearer <admin_token> (password path):
//   ONLY consulted when verifyAppSession returns reason='missing'.
//   A present-but-invalid app_session cookie (bad shape, bad
//   signature, expired) is treated as a stale OAuth session that
//   must be re-established, NOT as a reason to fall back to the
//   password path. Rationale: cookies are minted by the OAuth
//   callback; their presence means the user IS an OAuth user;
//   bearer fallback synthesises role='admin' which is the wrong
//   posture for users who should be re-authenticated. This is a
//   deliberate posture change from PR C, which fell back on any
//   cookie failure.
//
// Layer 3 — neither: 401 unauthenticated.
//
// =============================================================
// Audit log discipline — pure-return-shape preserved
// =============================================================
//
// requireRole still does not write to auth_audit_events directly.
// On rejection it returns the event the caller should log via the
// after()-based logAuthAudit helper. Three rejection event types:
//
//   - requireRole_rejected_unauthenticated
//       payload: { method, endpoint }
//   - requireRole_rejected_forbidden
//       payload: { method, endpoint, user_role, required_role, email }
//   - requireRole_rejected_session_revoked
//       payload: { method, endpoint, reason }
//         where reason is one of:
//           'malformed' | 'bad_signature' | 'bad_payload'
//         | 'bad_payload_shape' | 'expired'
//         | 'user_not_in_app_users' | 'session_version_mismatch'
//
// =============================================================
// Caller pattern (unchanged signature for the caller)
// =============================================================
//
//   const auth = await requireRole(req, "admin", "/api/admin/clients");
//   if (!auth.ok) {
//     logAuthAudit(auth.audit);
//     return NextResponse.json(
//       { ok: false, reason: auth.reason },
//       { status: auth.status },
//     );
//   }
//   // auth.ctx.email + auth.ctx.role + auth.ctx.session_version available below.

import type { NextRequest } from "next/server";
import {
  APP_SESSION_COOKIE_NAME,
  verifyAppSession,
  type AppSessionRole,
} from "./app-session";
import { validateAdminToken } from "./admin-auth";
import type { AuthAuditEventType } from "./auth-audit";
import { getSupabaseServerClient } from "./supabase-server";

export type Role = AppSessionRole; // 'super_admin' | 'admin' | 'viewer'

export type AuthCtx = {
  email: string;
  role: Role;
  via: "app_session" | "admin_token";
  // The session_version from the cookie at request time. Cookie path: a
  // positive integer (or 0 for users whose app_users row has never been
  // mutated). Bearer path: null (the password-sign-in flow has no cookie
  // and no concept of session_version).
  session_version: number | null;
};

export type RejectionAudit = {
  eventType: AuthAuditEventType;
  actorEmail: string | null;
  payload: Record<string, unknown>;
};

export type RejectionReason =
  | "unauthenticated"
  | "forbidden"
  | "session_revoked";

export type RequireRoleResult =
  | { ok: true; ctx: AuthCtx }
  | {
      ok: false;
      status: 401 | 403;
      reason: RejectionReason;
      audit: RejectionAudit;
    };

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  admin: 2,
  super_admin: 3,
};

function hasRank(actual: Role, minimum: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

/**
 * Read the current session_version for an email from app_users.
 * Returns null if the row doesn't exist (treat as session_revoked).
 *
 * Per-request DB hit on every protected route. The cost (~5-50ms per
 * call against the workbook's Supabase region) is the unavoidable price
 * of cookie-revocation semantics — a demoted user must lose access on
 * the NEXT request, not after up-to-7-days cookie expiry. See PR D-0's
 * description for the design rationale.
 *
 * Disabled users: the callback already refuses sign-in for users whose
 * disabled_at is non-null (PR B layer 4). If a user is disabled AFTER
 * sign-in (via PR D-1's RPCs), session_version is bumped, so the next
 * requireRole call mismatches and the session is revoked. Direct-SQL
 * disables that don't bump session_version leave the user with stale
 * access until cookie expiry — known gap, parked.
 */
type SessionVersionReader = (email: string) => Promise<number | null>;

const realReadCurrentSessionVersion: SessionVersionReader = async (email) => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("session_version")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    // Log + treat as revoked. A DB error during requireRole is an
    // unauthenticated state from the user's perspective — fail closed.
    console.warn(
      `[require-role] readCurrentSessionVersion failed for ${email}: ${error.message}`,
    );
    return null;
  }
  if (!data) return null;
  return data.session_version;
};

// Module-level reference so the colocated test file can swap in a stub
// without depending on a mocking framework. Production code calls
// requireRole() with no options; the default reader hits Supabase.
let _readCurrentSessionVersion: SessionVersionReader =
  realReadCurrentSessionVersion;

/** @internal Test seam — swap the session_version reader. */
export function _setReadCurrentSessionVersionForTests(
  fn: SessionVersionReader,
): void {
  _readCurrentSessionVersion = fn;
}

/** @internal Restore the production session_version reader. */
export function _resetReadCurrentSessionVersionForTests(): void {
  _readCurrentSessionVersion = realReadCurrentSessionVersion;
}

export async function requireRole(
  req: NextRequest,
  minRole: Role,
  endpoint: string,
): Promise<RequireRoleResult> {
  const method = req.method;

  // ───────────────────────────────────────────────────────────────
  // Layer 1: app_session cookie
  // ───────────────────────────────────────────────────────────────
  const sessionCookie = req.cookies.get(APP_SESSION_COOKIE_NAME)?.value;
  const verified = verifyAppSession(sessionCookie);

  if (verified.ok) {
    const { email, role, session_version: cookieSV } = verified.payload;
    const currentSV = await _readCurrentSessionVersion(email);
    if (currentSV === null) {
      // Cookie outlived the app_users row, OR a DB error occurred. Either
      // way, the session can no longer be considered authoritative.
      return {
        ok: false,
        status: 401,
        reason: "session_revoked",
        audit: {
          eventType: "requireRole_rejected_session_revoked",
          actorEmail: email,
          payload: { method, endpoint, reason: "user_not_in_app_users" },
        },
      };
    }
    if (currentSV !== cookieSV) {
      return {
        ok: false,
        status: 401,
        reason: "session_revoked",
        audit: {
          eventType: "requireRole_rejected_session_revoked",
          actorEmail: email,
          payload: {
            method,
            endpoint,
            reason: "session_version_mismatch",
            cookie_session_version: cookieSV,
            current_session_version: currentSV,
          },
        },
      };
    }
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
      ctx: { email, role, via: "app_session", session_version: cookieSV },
    };
  }

  // ───────────────────────────────────────────────────────────────
  // Layer 1 reject: cookie present but invalid
  // ───────────────────────────────────────────────────────────────
  // If the cookie was set but its HMAC / payload-shape / expiry failed,
  // treat as a stale OAuth session that must be re-established — DO NOT
  // fall through to bearer. A present-but-invalid cookie means the user
  // is an OAuth user whose session is stale; bearer fallback synthesises
  // role='admin' which is the wrong identity attribution.
  //
  // PR D-0 posture change vs PR C: PR C fell through on any failure.
  if (verified.reason !== "missing") {
    return {
      ok: false,
      status: 401,
      reason: "session_revoked",
      audit: {
        eventType: "requireRole_rejected_session_revoked",
        actorEmail: null,
        payload: { method, endpoint, reason: verified.reason },
      },
    };
  }

  // ───────────────────────────────────────────────────────────────
  // Layer 2: Authorization: Bearer <admin_token> (password path)
  // ───────────────────────────────────────────────────────────────
  // Reached only when verified.reason === 'missing' — no cookie at all.
  // The password sign-in flow has no app_session cookie; bearer is the
  // sole identity carrier. Synthesise role='admin'; session_version=null
  // because there's nothing to revoke per-request (the bearer hash is
  // its own revocation key — rotating ADMIN_PASSWORD or ADMIN_SESSION_
  // SECRET invalidates every existing bearer).
  const adminCheck = validateAdminToken(req);
  if (adminCheck.ok) {
    const passwordRole: Role = "admin";
    if (!hasRank(passwordRole, minRole)) {
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
      ctx: {
        email: "(password)",
        role: passwordRole,
        via: "admin_token",
        session_version: null,
      },
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
