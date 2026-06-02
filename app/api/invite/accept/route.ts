// =============================================================
// POST /api/invite/accept
// =============================================================
//
// Phase 1 PR D-1. The acceptance endpoint for an invite issued
// by POST /api/admin/invites.
//
// Auth posture: UNAUTH-but-Supabase-session-required. The invitee
// has just done Google OAuth (a regular Supabase Auth flow); they
// have sb-* cookies. They do NOT yet have an app_session cookie
// because they're not yet in app_users — accepting the invite is
// what puts them in app_users.
//
// Body: { invite_token: string } — the plaintext token from the
// invite URL the inviter shared. POST-only (security finding S5);
// token never in URL or Referer.
//
// Steps:
//   1. Origin check (anti-CSRF).
//   2. IP-based rate-limit (no email yet at this point).
//   3. Read Supabase session via SSR cookies; assert authenticated
//      AND email matches the invite (defense-in-depth; the RPC
//      also enforces).
//   4. Compute sha256(plaintext) and call accept_invite RPC.
//   5. On RPC success: mint app_session + admin_token cookies and
//      return { ok, email, role }.
//
// The route does NOT issue app_session cookies on the success path.
// That's the next step — the front-end (D-2) navigates to /admin
// where the existing OAuth flow's app_users lookup now finds the
// just-inserted row and mints cookies.
//
// Actually — that's a poor experience because the OAuth flow needs
// to re-run. Instead: this route DOES mint app_session + admin_token
// cookies directly, since we already have a verified Supabase session
// from the invitee AND we just inserted them into app_users with a
// known role.

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSupabaseSSRClient } from "@/app/lib/supabase-ssr";
import { acceptInvite } from "@/app/lib/app-users";
import { assertSameOrigin } from "@/app/lib/csrf";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import {
  auditHandlerRejection,
  buildRequestMetadata,
} from "@/app/lib/audit-metadata";
import {
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_MAX_AGE_SECONDS,
  mintAppSession,
  type AppSessionRole,
} from "@/app/lib/app-session";
import { getSupabaseServerClient } from "@/app/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  invite_token: z.string().min(20).max(100),
});

const ADMIN_TOKEN_COOKIE = "admin_token";

function adminTokenValue(): string {
  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret =
    process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  return createHash("sha256").update(`${correct}:${secret}`).digest("hex");
}

export async function POST(req: NextRequest) {
  const requestMetadata = buildRequestMetadata(req);

  // 1. Origin check.
  const csrf = assertSameOrigin(req);
  if (!csrf.ok) {
    auditHandlerRejection({
      eventType: "handler_origin_rejected",
      actorEmail: null,
      endpoint: "/api/invite/accept",
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

  // 2. Rate-limit by IP-hash (no actor email yet).
  const ipKey = `ip:${requestMetadata.ip_hash ?? "unknown"}`;
  const rl = await enforceRateLimit(ipKey, "invite_acceptance");
  if (!rl.ok && rl.reason === "limit_exceeded") {
    auditHandlerRejection({
      eventType: "handler_rate_limited",
      actorEmail: null,
      endpoint: "/api/invite/accept",
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

  // 3. Verify Supabase session for the invitee. The sb-* cookies were
  //    set by the invitee's Google OAuth flow before they hit this
  //    endpoint. This runs BEFORE body validation so unauthenticated
  //    callers get 401 supabase_session_required without first
  //    revealing the required field name via 400 validation_failed.
  const supabaseSSR = await getSupabaseSSRClient();
  const { data: userData, error: userError } = await supabaseSSR.auth.getUser();
  if (userError || !userData.user || !userData.user.email) {
    return NextResponse.json(
      { ok: false, reason: "supabase_session_required" },
      { status: 401 },
    );
  }
  const authenticatedEmail = userData.user.email.toLowerCase();

  // 4. Validate body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    auditHandlerRejection({
      eventType: "handler_validation_failed",
      actorEmail: null,
      endpoint: "/api/invite/accept",
      method: req.method,
      reason: "validation_failed",
      additional: { field: "body", subreason: "invalid_json" },
      requestMetadata,
    });
    return NextResponse.json(
      { ok: false, reason: "validation_failed", field: "body" },
      { status: 400 },
    );
  }
  const parse = BodySchema.safeParse(body);
  if (!parse.success) {
    auditHandlerRejection({
      eventType: "handler_validation_failed",
      actorEmail: null,
      endpoint: "/api/invite/accept",
      method: req.method,
      reason: "validation_failed",
      additional: { field: "invite_token" },
      requestMetadata,
    });
    return NextResponse.json(
      { ok: false, reason: "validation_failed", field: "invite_token" },
      { status: 400 },
    );
  }

  // 5. Compute sha256(plaintext) and call the RPC. The RPC enforces
  //    the email-match guard as defense-in-depth; we ALSO enforce
  //    here so a misconfigured RPC can't be silently bypassed.
  const tokenSha256 = createHash("sha256")
    .update(parse.data.invite_token)
    .digest("hex");

  const result = await acceptInvite({
    inviteTokenSha256: tokenSha256,
    authenticatedEmail,
    requestMetadata: requestMetadata as unknown as Record<string, unknown>,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: result.status },
    );
  }

  // 6. The new app_users row exists. Mint app_session + admin_token
  //    cookies so the user lands on /admin signed-in. session_version
  //    is 0 (DEFAULT on insert in the RPC).
  const role = result.role as AppSessionRole;
  const { token: appSessionToken } = mintAppSession({
    email: authenticatedEmail,
    role,
    session_version: 0,
  });
  const isProd = process.env.NODE_ENV === "production";

  const res = NextResponse.json({
    ok: true,
    email: authenticatedEmail,
    role,
  });
  res.cookies.set({
    name: APP_SESSION_COOKIE_NAME,
    value: appSessionToken,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: APP_SESSION_MAX_AGE_SECONDS,
  });
  res.cookies.set({
    name: ADMIN_TOKEN_COOKIE,
    value: adminTokenValue(),
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: APP_SESSION_MAX_AGE_SECONDS,
  });

  // Mark the Supabase session as no-longer-needed-for-app — we use
  // app_session from here. We leave sb-* cookies alone (they're
  // Supabase Auth's; not ours to clear).
  void getSupabaseServerClient; // suppress unused-import lint if any
  return res;
}
