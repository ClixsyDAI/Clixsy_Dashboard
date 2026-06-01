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
  | "session_revoked"
  // PR D-1: cache miss + Supabase unreachable. Caller returns 503 with
  // Retry-After. Distinct from session_revoked because the user IS
  // authenticated by HMAC; we just can't confirm freshness right now.
  | "service_unavailable";

export type RequireRoleResult =
  | { ok: true; ctx: AuthCtx }
  | {
      ok: false;
      status: 401 | 403 | 503;
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
// PR D-1: session_version lookup result. `cache_hit` is true if the
// value came from the in-process LRU rather than a fresh Supabase read.
// `transient_error` is true if the lookup failed AND no cache entry was
// available — caller maps this to a 503 service_unavailable response.
export type SessionVersionLookup =
  | { ok: true; session_version: number; cache_hit: boolean }
  | { ok: false; reason: "user_not_in_app_users" }
  | { ok: false; reason: "transient_error" };

type SessionVersionReader = (email: string) => Promise<SessionVersionLookup>;

// =============================================================
// 30-second per-instance LRU cache (PR D-1)
// =============================================================
//
// Per the operator's Q2 answer: prefer 30s-stale-on-blip over the
// mass-503-on-blip default. A demoted user can retain access for at
// most 30 seconds; the typical Supabase blip is sub-second so this is
// a rare regression. The cache key is the lowercased email.
//
// The cache value is { session_version, fetched_at }. On every lookup:
//   - If a fresh (<30s) entry exists -> return it (no Supabase call).
//   - Else try Supabase. On success: update cache, return fresh value.
//   - On Supabase error: if cache has ANY entry (even stale) for the
//     email, return it as cache_hit=true. The caller treats this as
//     authoritative within the 30s window; beyond that, the cache
//     entry expires and the next blip becomes a 503.
//   - On Supabase error AND no cache entry: return transient_error.
//
// Cache is per Vercel function instance. Fluid Compute may reuse the
// instance across requests; cold starts begin empty. Bounded LRU with
// 1024 entries — small enough that eviction is rare for the workbook's
// scale (<100 admin users); large enough not to thrash.

const CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 1024;

type CacheEntry = { session_version: number; fetched_at: number };
const sessionVersionCache = new Map<string, CacheEntry>();

function cacheGet(email: string): CacheEntry | undefined {
  const key = email.toLowerCase();
  const entry = sessionVersionCache.get(key);
  if (!entry) return undefined;
  // Map's get does not refresh LRU order; we re-set to move-to-end.
  sessionVersionCache.delete(key);
  sessionVersionCache.set(key, entry);
  return entry;
}

function cacheSet(email: string, session_version: number): void {
  const key = email.toLowerCase();
  sessionVersionCache.delete(key);
  sessionVersionCache.set(key, { session_version, fetched_at: Date.now() });
  // Evict oldest if over capacity (Map iteration is insertion order).
  while (sessionVersionCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = sessionVersionCache.keys().next().value;
    if (oldestKey === undefined) break;
    sessionVersionCache.delete(oldestKey);
  }
}

/** @internal Test seam — clear the in-process cache between tests. */
export function _clearSessionVersionCacheForTests(): void {
  sessionVersionCache.clear();
}

const realReadCurrentSessionVersion: SessionVersionReader = async (email) => {
  // Fresh-cache fast path.
  const cached = cacheGet(email);
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return { ok: true, session_version: cached.session_version, cache_hit: true };
  }

  // Fetch from Supabase.
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_users")
      .select("session_version")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      // Supabase returned an error. Serve from stale cache if we have one
      // for this email — the value's at most 30s old (LRU TTL); beyond
      // that the entry would have been treated as stale on the path above.
      console.warn(
        `[require-role] readCurrentSessionVersion supabase error for ${email}: ${error.message}`,
      );
      if (cached) {
        return { ok: true, session_version: cached.session_version, cache_hit: true };
      }
      return { ok: false, reason: "transient_error" };
    }

    if (!data) {
      // Row genuinely missing — user was removed. Invalidate any cache
      // entry and report.
      sessionVersionCache.delete(email.toLowerCase());
      return { ok: false, reason: "user_not_in_app_users" };
    }

    cacheSet(email, data.session_version);
    return { ok: true, session_version: data.session_version, cache_hit: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[require-role] readCurrentSessionVersion threw for ${email}: ${message}`,
    );
    if (cached) {
      return { ok: true, session_version: cached.session_version, cache_hit: true };
    }
    return { ok: false, reason: "transient_error" };
  }
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
    const lookup = await _readCurrentSessionVersion(email);

    if (!lookup.ok && lookup.reason === "transient_error") {
      // Supabase unavailable AND no cache entry. Fail SOFT (503) so the
      // caller can retry, rather than 401-and-force-re-sign-in. The
      // cookie's HMAC still validates; we just can't confirm freshness
      // right now. Audit event still uses session_revoked event_type
      // because that's the closest existing category; reason in payload
      // distinguishes 'transient_error' from real revocations.
      return {
        ok: false,
        status: 503,
        reason: "service_unavailable",
        audit: {
          eventType: "requireRole_rejected_session_revoked",
          actorEmail: email,
          payload: { method, endpoint, reason: "transient_error" },
        },
      };
    }

    if (!lookup.ok && lookup.reason === "user_not_in_app_users") {
      // Cookie outlived the app_users row.
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

    // lookup.ok is true past this point
    const currentSV = lookup.ok ? lookup.session_version : null;
    if (currentSV === null) {
      // Defensive — shouldn't happen given the discriminated union above
      // but TypeScript doesn't narrow lookup.ok across the !lookup.ok
      // branches. Treat unknown as session_revoked.
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
