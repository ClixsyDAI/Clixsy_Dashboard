import "server-only";
// =============================================================
// app_session cookie — mint + verify
// =============================================================
//
// Phase 1 PR B. The OAuth-signed-in identity layer.
//
// app_session is the cookie issued by /admin/auth/callback when
// a Google OAuth sign-in succeeds AND the email is in app_users
// (not disabled). It carries the verified email + role so
// downstream code (PR C's requireRole, PR D's Users tab) knows
// who the request is from without re-querying Supabase on every
// call.
//
// Payload format:
//   base64url(json) + "." + base64url(hmac-sha256(json, secret))
//
// Why HMAC and not a JWT library:
//   - No new dependency. HMAC-SHA256 lives in Node's built-in
//     crypto module already.
//   - Single secret (ADMIN_SESSION_SECRET) we already use for
//     admin_token derivation. One key rotation rotates both.
//   - Self-contained — no key-id resolution, no JWKS, nothing
//     to fetch at verify time.
//   - The whole token only needs to survive a same-origin
//     round trip, not interop with external relying parties.
//     JWT's flexibility is unused.
//
// Coexistence with admin_token:
//   The OAuth callback issues BOTH admin_token (sha256 hash,
//   matching the existing password-sign-in posture) AND
//   app_session (this token, with email + role). This is the
//   transitional dual-cookie bridge that lets OAuth-signed-in
//   users use the existing protected endpoints without those
//   endpoints needing to learn about app_session. PR C removes
//   the admin_token shadow-issue once requireRole() lands on
//   every protected endpoint.

import { createHmac, timingSafeEqual } from "node:crypto";

export const APP_SESSION_COOKIE_NAME = "app_session";
export const APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type AppSessionRole = "super_admin" | "admin" | "viewer";

export type AppSessionPayload = {
  email: string;
  role: AppSessionRole;
  iat: number; // issued-at, unix seconds
  exp: number; // expiry, unix seconds
};

function getSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET || "clixsy-admin-default-secret"
  );
}

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payloadEncoded: string): string {
  return base64urlEncode(
    createHmac("sha256", getSecret()).update(payloadEncoded).digest(),
  );
}

export function mintAppSession(
  base: Pick<AppSessionPayload, "email" | "role">,
): { token: string; payload: AppSessionPayload } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + APP_SESSION_MAX_AGE_SECONDS;
  const payload: AppSessionPayload = {
    email: base.email,
    role: base.role,
    iat,
    exp,
  };
  const payloadEncoded = base64urlEncode(JSON.stringify(payload));
  const signature = sign(payloadEncoded);
  return { token: `${payloadEncoded}.${signature}`, payload };
}

export type VerifyResult =
  | { ok: true; payload: AppSessionPayload }
  | { ok: false; reason: string };

export function verifyAppSession(token: string | undefined | null): VerifyResult {
  if (!token) return { ok: false, reason: "missing" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadEncoded = token.slice(0, dot);
  const signatureProvided = token.slice(dot + 1);
  const signatureExpected = sign(payloadEncoded);

  // Constant-time comparison. Both buffers must be the same length
  // for timingSafeEqual; bail explicitly if they aren't (treat as
  // invalid signature rather than throwing).
  const a = Buffer.from(signatureProvided);
  const b = Buffer.from(signatureExpected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(payloadEncoded).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (!isPayload(parsed)) {
    return { ok: false, reason: "bad_payload_shape" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp < now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: parsed };
}

function isPayload(v: unknown): v is AppSessionPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.email === "string" &&
    (o.role === "super_admin" || o.role === "admin" || o.role === "viewer") &&
    typeof o.iat === "number" &&
    typeof o.exp === "number"
  );
}
