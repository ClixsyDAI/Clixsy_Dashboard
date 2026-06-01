// =============================================================
// GET /admin/auth/callback
// =============================================================
//
// Phase 1 PR B. The redirect target after Google completes its
// OAuth handshake. Receives a `?code` PKCE auth code from
// Google, exchanges it for a Supabase session, verifies the
// resulting user against app_users, and either:
//
//   - Mints app_session + admin_token cookies and redirects to
//     the validated `?return=` path (default /admin).
//   - Inserts an app_access_requests row and redirects to
//     /admin/access-pending if the email is verified + on the
//     clixsy.com domain but not in app_users.
//   - Redirects back to /admin with an error reason for every
//     other failure mode.
//
// =============================================================
// Defence-in-depth layering (consent screen is External — see
// docs/phase1-oauth-setup.md):
// =============================================================
//
//   1. Google's `hd=clixsy.com` query parameter (set on the
//      signInWithOAuth call from the LoginScreen + SignInPrompt
//      components). Google enforces this server-side per their
//      OIDC spec: a non-clixsy.com account can't complete the
//      sign-in step at all.
//
//   2. email_verified === true on the Supabase user object.
//      Belt-and-braces — Google's id_token always sets this for
//      hosted-domain accounts, but a hostile id_token could in
//      principle claim a clixsy.com email without verification.
//
//   3. email.endsWith('@clixsy.com') check below. The strongest
//      layer. If somehow steps 1+2 were bypassed (crafted auth
//      URL without hd, malicious provider response), this
//      catches it. Audit-logged on rejection so we'd see the
//      attempt.
//
//   4. app_users lookup. Only emails on the explicit allow-list
//      are signed in; everything else goes to access-pending.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSupabaseSSRClient } from "../../../lib/supabase-ssr";
import { getSupabaseServerClient } from "../../../lib/supabase-server";
import { validateReturnPath } from "../../../lib/return-url";
import {
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_MAX_AGE_SECONDS,
  mintAppSession,
  type AppSessionRole,
} from "../../../lib/app-session";
import { logAuthAudit } from "../../../lib/auth-audit";
import { isClixsyEmail, isEmailVerified } from "../../../lib/oauth-email-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN_COOKIE = "admin_token";

function adminTokenValue(): string {
  const correct = process.env.ADMIN_PASSWORD || "clixsy2024";
  const secret =
    process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret";
  return createHash("sha256").update(`${correct}:${secret}`).digest("hex");
}

function buildRedirect(
  req: NextRequest,
  targetPath: string,
  errorReason?: string,
): NextResponse {
  const url = new URL(targetPath, req.url);
  if (errorReason) {
    url.searchParams.set("error", errorReason);
  }
  return NextResponse.redirect(url);
}

function resolveReturnPath(rawReturn: string | null): string {
  if (!rawReturn) return "/admin";
  const r = validateReturnPath(rawReturn);
  return r.ok ? r.path : "/admin";
}

function setAuthCookies(res: NextResponse, appSessionToken: string): void {
  const isProd = process.env.NODE_ENV === "production";
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
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const rawReturn = url.searchParams.get("return");

  if (!code) {
    logAuthAudit({
      eventType: "google_oauth_callback_error",
      actorEmail: null,
      payload: { stage: "no_code_param" },
    });
    return buildRedirect(req, "/admin", "oauth_no_code");
  }

  const supabaseSSR = await getSupabaseSSRClient();
  const exchange = await supabaseSSR.auth.exchangeCodeForSession(code);
  if (exchange.error) {
    logAuthAudit({
      eventType: "google_oauth_callback_error",
      actorEmail: null,
      payload: { stage: "exchange", error_message: exchange.error.message },
    });
    return buildRedirect(req, "/admin", "oauth_exchange_failed");
  }

  const user = exchange.data.user;
  const email = user?.email?.toLowerCase() ?? null;
  if (!email) {
    logAuthAudit({
      eventType: "google_oauth_callback_error",
      actorEmail: null,
      payload: { stage: "no_email_on_user" },
    });
    return buildRedirect(req, "/admin", "oauth_no_email");
  }

  // Layer 2: email_verified.
  // identities[].identity_data.email_verified is where Google's
  // verification flag lands. user.user_metadata.email_verified
  // also commonly carries it. Check both shapes.
  const emailVerified = isEmailVerified(user);
  if (!emailVerified) {
    logAuthAudit({
      eventType: "google_oauth_sign_in_rejected_email_not_verified",
      actorEmail: email,
      payload: { email },
    });
    return buildRedirect(req, "/admin", "oauth_email_unverified");
  }

  // Layer 3: hostname check. The primary clixsy.com enforcement
  // because the consent screen is External — see
  // docs/phase1-oauth-setup.md.
  if (!email.endsWith("@clixsy.com")) {
    logAuthAudit({
      eventType: "google_oauth_sign_in_rejected_non_clixsy_domain",
      actorEmail: email,
      payload: { email, reason: "email_domain_not_clixsy_com" },
    });
    return buildRedirect(req, "/admin", "oauth_wrong_domain");
  }

  // Layer 4: app_users lookup via service-role.
  // PR D-0: also select session_version so the cookie minted below
  // captures the user's current value. requireRole() compares the
  // cookie's session_version claim against app_users on every
  // protected request — a fresh sign-in must therefore mint with
  // the live value, not a constant.
  const supabase = getSupabaseServerClient();
  const { data: appUser, error: lookupError } = await supabase
    .from("app_users")
    .select("email, role, disabled_at, session_version")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) {
    logAuthAudit({
      eventType: "google_oauth_callback_error",
      actorEmail: email,
      payload: { stage: "app_users_lookup", error_message: lookupError.message },
    });
    return buildRedirect(req, "/admin", "oauth_lookup_failed");
  }

  if (!appUser) {
    // Email is clixsy.com and verified, but not on the allow-list.
    // Insert an access request row and surface the pending page.
    //
    // PR D-1: stamp email_verified_at_request_time so the approve_access_request
    // RPC can confirm provenance (it fails closed on NULL — defense-in-depth
    // against attacker-inserted rows that bypass this callback). We only
    // reach this branch AFTER the email_verified check above passed, so
    // setting now() here records the verification timestamp accurately.
    const { data: request, error: insertError } = await supabase
      .from("app_access_requests")
      .insert({ email, email_verified_at_request_time: new Date().toISOString() })
      .select("id")
      .single();
    if (insertError) {
      logAuthAudit({
        eventType: "google_oauth_callback_error",
        actorEmail: email,
        payload: {
          stage: "access_request_insert",
          error_message: insertError.message,
        },
      });
      return buildRedirect(req, "/admin", "access_request_insert_failed");
    }
    logAuthAudit({
      eventType: "access_request_created",
      actorEmail: email,
      payload: { email, request_id: request.id },
    });
    logAuthAudit({
      eventType: "google_oauth_sign_in_rejected_not_in_app_users",
      actorEmail: email,
      payload: { email, access_request_id: request.id },
    });
    const pendingUrl = new URL("/admin/access-pending", req.url);
    pendingUrl.searchParams.set("email", email);
    return NextResponse.redirect(pendingUrl);
  }

  if (appUser.disabled_at) {
    logAuthAudit({
      eventType: "google_oauth_sign_in_rejected_disabled",
      actorEmail: email,
      payload: { email },
    });
    const pendingUrl = new URL("/admin/access-pending", req.url);
    pendingUrl.searchParams.set("email", email);
    pendingUrl.searchParams.set("reason", "disabled");
    return NextResponse.redirect(pendingUrl);
  }

  // Authorized. Mint app_session + admin_token, redirect.
  // session_version comes from the row we just read; future mutations to
  // app_users (PR D-1's RPCs) increment this column and the next
  // requireRole() call observes the mismatch.
  const role = appUser.role as AppSessionRole;
  const sessionVersion = (appUser as { session_version: number }).session_version;
  const { token: appSessionToken } = mintAppSession({
    email,
    role,
    session_version: sessionVersion,
  });
  const returnPath = resolveReturnPath(rawReturn);

  const res = NextResponse.redirect(new URL(returnPath, req.url));
  setAuthCookies(res, appSessionToken);
  logAuthAudit({
    eventType: "google_oauth_sign_in_succeeded",
    actorEmail: email,
    payload: { email, role, return_path: returnPath },
  });
  return res;
}

// Layer-2 and layer-3 guard implementations live in
// app/lib/oauth-email-guards.ts so the colocated test there can
// exercise them without importing this route's server-only
// dependencies.
