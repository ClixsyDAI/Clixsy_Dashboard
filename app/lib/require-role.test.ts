// =============================================================
// require-role tests — colocated with the helper
// =============================================================
//
// Run from the workbook repo root:
//   node --experimental-strip-types --test app/lib/require-role.test.ts
//
// PR D-0 update: requireRole became async because session-version
// revocation requires a per-request Supabase read. Tests inject a
// stub reader via _setReadCurrentSessionVersionForTests so the
// helper is exercised without a real Supabase connection.
//
// PR D-0 posture change tested below: a PRESENT-BUT-INVALID
// app_session cookie no longer falls through to admin_token bearer.
// PR C let bearer cover any cookie failure; PR D-0 treats a present-
// but-invalid cookie as a stale OAuth session that must re-sign-in,
// not as a reason to attribute the request to the password path.

process.env.ADMIN_PASSWORD = "test-password-xyz";
process.env.ADMIN_SESSION_SECRET = "test-session-secret-abc";

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac } from "node:crypto";
import {
  requireRole,
  _setReadCurrentSessionVersionForTests,
  _resetReadCurrentSessionVersionForTests,
  type Role,
} from "./require-role.ts";
import { APP_SESSION_COOKIE_NAME } from "./app-session.ts";

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function mintTestSession(args: {
  email: string;
  role: Role;
  iat: number;
  exp: number;
  session_version: number;
}): string {
  const payloadEncoded = base64urlEncode(JSON.stringify(args));
  const signature = base64urlEncode(
    createHmac("sha256", "test-session-secret-abc")
      .update(payloadEncoded)
      .digest(),
  );
  return `${payloadEncoded}.${signature}`;
}

function expectedAdminToken(): string {
  return createHash("sha256")
    .update(`test-password-xyz:test-session-secret-abc`)
    .digest("hex");
}

function makeReq(args: {
  method?: string;
  cookies?: Record<string, string>;
  authorization?: string;
}): unknown {
  const cookies = args.cookies ?? {};
  const authorization = args.authorization;
  return {
    method: args.method ?? "POST",
    cookies: {
      get(name: string) {
        const value = cookies[name];
        return value === undefined ? undefined : { value };
      },
    },
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "authorization") return authorization ?? null;
        return null;
      },
    },
  };
}

const NOW = Math.floor(Date.now() / 1000);
const FUTURE = NOW + 60 * 60 * 24 * 7;
const PAST = NOW - 60;

/**
 * Default test fixture: app_users row exists with session_version=N
 * for every queried email. Individual tests override.
 *
 * Returns the SessionVersionLookup discriminated union shape PR D-1
 * introduced (cache_hit always false in test fixtures).
 */
function stubAllUsersAtSessionVersion(version: number) {
  _setReadCurrentSessionVersionForTests(async () => ({
    ok: true,
    session_version: version,
    cache_hit: false,
  }));
}

function stubUserNotFound() {
  _setReadCurrentSessionVersionForTests(async () => ({
    ok: false,
    reason: "user_not_in_app_users",
  }));
}

function stubTransientSupabaseError() {
  _setReadCurrentSessionVersionForTests(async () => ({
    ok: false,
    reason: "transient_error",
  }));
}

beforeEach(() => {
  _resetReadCurrentSessionVersionForTests();
});

describe("requireRole — app_session path (session_version match)", () => {
  it("accepts a valid super_admin session at minRole=viewer", async () => {
    stubAllUsersAtSessionVersion(0);
    const token = mintTestSession({
      email: "johan@clixsy.com",
      role: "super_admin",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ctx.email, "johan@clixsy.com");
      assert.equal(r.ctx.role, "super_admin");
      assert.equal(r.ctx.via, "app_session");
      assert.equal(r.ctx.session_version, 0);
    }
  });

  it("accepts a valid admin session at minRole=admin", async () => {
    stubAllUsersAtSessionVersion(0);
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ctx.role, "admin");
  });

  it("accepts a valid viewer session at minRole=viewer", async () => {
    stubAllUsersAtSessionVersion(0);
    const token = mintTestSession({
      email: "bob@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ctx.role, "viewer");
  });

  it("rejects 403 + audit when viewer tries minRole=admin", async () => {
    stubAllUsersAtSessionVersion(0);
    const token = mintTestSession({
      email: "bob@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: token },
      method: "POST",
    });
    const r = await requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 403);
      assert.equal(r.reason, "forbidden");
      assert.equal(r.audit.eventType, "requireRole_rejected_forbidden");
      assert.equal(r.audit.actorEmail, "bob@clixsy.com");
      assert.deepEqual(r.audit.payload, {
        method: "POST",
        endpoint: "/api/onboarding/field-edits",
        user_role: "viewer",
        required_role: "admin",
        email: "bob@clixsy.com",
      });
    }
  });

  it("rejects 403 when viewer tries minRole=super_admin", async () => {
    stubAllUsersAtSessionVersion(0);
    const token = mintTestSession({
      email: "bob@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "super_admin", "/api/admin/users");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });

  it("rejects 403 when admin tries minRole=super_admin", async () => {
    stubAllUsersAtSessionVersion(0);
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "super_admin", "/api/admin/users");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });

  it("accepts when super_admin tries minRole=viewer (rank cascades down)", async () => {
    stubAllUsersAtSessionVersion(0);
    const token = mintTestSession({
      email: "johan@clixsy.com",
      role: "super_admin",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
  });
});

describe("requireRole — session_version mismatch (PR D-0)", () => {
  it("rejects 401 session_revoked when cookie session_version < db session_version", async () => {
    // Cookie minted at session_version=0; user was later mutated, bumping
    // app_users.session_version to 1. Cookie is stale.
    stubAllUsersAtSessionVersion(1);
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "session_revoked");
      assert.equal(r.audit.eventType, "requireRole_rejected_session_revoked");
      assert.equal(r.audit.actorEmail, "alice@clixsy.com");
      const payload = r.audit.payload as Record<string, unknown>;
      assert.equal(payload.reason, "session_version_mismatch");
      assert.equal(payload.cookie_session_version, 0);
      assert.equal(payload.current_session_version, 1);
    }
  });

  it("rejects 401 session_revoked when app_users row is gone (user removed post-sign-in)", async () => {
    stubUserNotFound();
    const token = mintTestSession({
      email: "deleted@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "session_revoked");
      const payload = r.audit.payload as Record<string, unknown>;
      assert.equal(payload.reason, "user_not_in_app_users");
    }
  });

  it("accepts when cookie session_version matches db (multiple bumps later)", async () => {
    stubAllUsersAtSessionVersion(5);
    const token = mintTestSession({
      email: "carla@clixsy.com",
      role: "admin",
      iat: NOW,
      exp: FUTURE,
      session_version: 5,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "admin", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ctx.session_version, 5);
  });
});

describe("requireRole — transient Supabase error (PR D-1)", () => {
  it("rejects 503 service_unavailable when cache miss + Supabase unreachable", async () => {
    stubTransientSupabaseError();
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 503);
      assert.equal(r.reason, "service_unavailable");
      const payload = r.audit.payload as Record<string, unknown>;
      assert.equal(payload.reason, "transient_error");
    }
  });
});

describe("requireRole — invalid cookie does NOT fall through to bearer (PR D-0)", () => {
  it("expired cookie rejects 401 session_revoked, no bearer fallback", async () => {
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: PAST - 60,
      exp: PAST,
      session_version: 0,
    });
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: token },
      authorization: `Bearer ${expectedAdminToken()}`, // valid bearer present
    });
    const r = await requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "session_revoked");
      const payload = r.audit.payload as Record<string, unknown>;
      assert.equal(payload.reason, "expired");
    }
  });

  it("bad-signature cookie rejects 401 session_revoked, no bearer fallback (PR D-0 posture change vs PR C)", async () => {
    const payload = base64urlEncode(
      JSON.stringify({
        email: "evil@clixsy.com",
        role: "super_admin",
        iat: NOW,
        exp: FUTURE,
        session_version: 0,
      }),
    );
    const wrongSignature = base64urlEncode(
      createHmac("sha256", "wrong-secret").update(payload).digest(),
    );
    const token = `${payload}.${wrongSignature}`;
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: token },
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "session_revoked");
      const payloadOut = r.audit.payload as Record<string, unknown>;
      assert.equal(payloadOut.reason, "bad_signature");
    }
  });

  it("malformed cookie (no dot) rejects 401 session_revoked", async () => {
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: "not-a-valid-token" },
    });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "session_revoked");
    }
  });

  it("payload missing session_version (pre-PR-D-0 cookie shape) rejects 401 session_revoked", async () => {
    // Hand-craft a cookie WITHOUT session_version. Mimics an OAuth cookie
    // minted before PR D-0 deployed. Should fail isPayload check.
    const payload = base64urlEncode(
      JSON.stringify({
        email: "alice@clixsy.com",
        role: "admin",
        iat: NOW,
        exp: FUTURE,
      }),
    );
    const signature = base64urlEncode(
      createHmac("sha256", "test-session-secret-abc").update(payload).digest(),
    );
    const token = `${payload}.${signature}`;
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "session_revoked");
      const payloadOut = r.audit.payload as Record<string, unknown>;
      assert.equal(payloadOut.reason, "bad_payload_shape");
    }
  });

  it("empty-string cookie rejects 401 session_revoked", async () => {
    // verifyAppSession returns reason='missing' for empty/undefined cookie.
    // PR D-0 then tries bearer fallback. With no bearer either, returns
    // unauthenticated. Empty string is treated as missing (same as undefined).
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: "" } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "unauthenticated");
    }
  });
});

describe("requireRole — admin_token (password) fallback path", () => {
  it("accepts a valid bearer token at minRole=admin (no cookie)", async () => {
    const req = makeReq({
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = await requireRole(req as never, "admin", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ctx.email, "(password)");
      assert.equal(r.ctx.role, "admin");
      assert.equal(r.ctx.via, "admin_token");
      assert.equal(r.ctx.session_version, null);
    }
  });

  it("accepts a valid bearer token at minRole=viewer (admin >= viewer)", async () => {
    const req = makeReq({
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ctx.role, "admin");
  });

  it("rejects 403 + audit when password caller tries minRole=super_admin", async () => {
    const req = makeReq({
      method: "PUT",
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = await requireRole(req as never, "super_admin", "/api/admin/users");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 403);
      assert.equal(r.reason, "forbidden");
      assert.equal(r.audit.eventType, "requireRole_rejected_forbidden");
      assert.equal(r.audit.actorEmail, "(password)");
      assert.deepEqual(r.audit.payload, {
        method: "PUT",
        endpoint: "/api/admin/users",
        user_role: "admin",
        required_role: "super_admin",
        email: "(password)",
      });
    }
  });

  it("rejects 401 when bearer token is wrong (no cookie)", async () => {
    const req = makeReq({ authorization: "Bearer not-the-right-hash" });
    const r = await requireRole(req as never, "admin", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  });

  it("rejects 401 unauthenticated when neither cookie nor header present", async () => {
    const req = makeReq({ method: "GET" });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "unauthenticated");
      assert.equal(r.audit.eventType, "requireRole_rejected_unauthenticated");
      assert.equal(r.audit.actorEmail, null);
      assert.deepEqual(r.audit.payload, {
        method: "GET",
        endpoint: "/api/admin/clients",
      });
    }
  });
});

describe("requireRole — cookie precedence (PR D-0)", () => {
  it("uses app_session when present-and-valid even if admin_token also valid", async () => {
    // Cookie is for viewer (rank 1). Bearer would be admin (rank 2) if used.
    // PR D-0 picks cookie; admin minRole fails with 403 (viewer can't admin).
    stubAllUsersAtSessionVersion(0);
    const sessionToken = mintTestSession({
      email: "carla@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
      session_version: 0,
    });
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: sessionToken },
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = await requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 403);
      assert.equal(r.reason, "forbidden");
    }
  });
});

describe("requireRole — never throws on weird input", () => {
  it("handles a single-dot session cookie", async () => {
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: "." } });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
  });

  it("handles a session cookie with only the signature half", async () => {
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: ".signature" },
    });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
  });

  it("handles a session cookie with only the payload half", async () => {
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: "payload." },
    });
    const r = await requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
  });
});

describe("requireRole — captures HTTP method in audit payload", () => {
  it("GET rejected -> audit.payload.method === 'GET'", async () => {
    const req = makeReq({ method: "GET" });
    const r = await requireRole(req as never, "admin", "/api/admin/clients");
    if (!r.ok) {
      assert.equal((r.audit.payload as { method: string }).method, "GET");
    } else {
      assert.fail("expected rejection");
    }
  });

  it("POST rejected -> audit.payload.method === 'POST'", async () => {
    const req = makeReq({ method: "POST" });
    const r = await requireRole(req as never, "admin", "/api/admin/clients");
    if (!r.ok) {
      assert.equal((r.audit.payload as { method: string }).method, "POST");
    } else {
      assert.fail("expected rejection");
    }
  });

  it("PUT rejected -> audit.payload.method === 'PUT'", async () => {
    const req = makeReq({ method: "PUT" });
    const r = await requireRole(req as never, "admin", "/api/team-assignments");
    if (!r.ok) {
      assert.equal((r.audit.payload as { method: string }).method, "PUT");
    } else {
      assert.fail("expected rejection");
    }
  });
});
