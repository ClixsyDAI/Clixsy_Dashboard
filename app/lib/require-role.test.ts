// =============================================================
// require-role tests — colocated with the helper
// =============================================================
//
// Run from the workbook repo root:
//   node --experimental-strip-types --test app/lib/require-role.test.ts
//
// Same pattern as oauth-email-guards.test.ts and return-url.test.ts
// — Node's built-in test runner via --experimental-strip-types so
// no new dependency is needed.
//
// Coverage:
//   - app_session path: missing / malformed / expired / wrong-role / right-role
//   - admin_token fallback path: missing header / wrong token / right token
//   - role rank: viewer < admin < super_admin (each tier vs each tier)
//   - audit event shape on every rejection (method, endpoint, user_role,
//     required_role, email captured per the operator's spec)
//   - never throws (every input shape returns a structured result)
//
// requireRole is a pure function in PR C — it does NOT write to
// auth_audit_events itself. The caller is responsible for taking
// the returned `audit` field and logging it. So this test file
// doesn't need to stub Supabase / next/server / after() — it just
// asserts on the returned shape.

// Set deterministic env BEFORE importing require-role / app-session
// since those modules read process.env at evaluation time.
process.env.ADMIN_PASSWORD = "test-password-xyz";
process.env.ADMIN_SESSION_SECRET = "test-session-secret-abc";

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac } from "node:crypto";
import { requireRole, type Role } from "./require-role.ts";
import { APP_SESSION_COOKIE_NAME } from "./app-session.ts";

// Re-implement the HMAC + base64url shape app-session.ts uses, so
// we can mint test tokens with custom expiry / role without
// depending on the production mintAppSession (which always sets
// iat=now, complicating the expired branch).
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

// Minimal NextRequest stand-in with the surface requireRole reads.
// requireRole uses: req.method, req.cookies.get(name)?.value,
// req.headers.get(name).
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
const FUTURE = NOW + 60 * 60 * 24 * 7; // +7 days
const PAST = NOW - 60; // -1 minute

describe("requireRole — app_session path", () => {
  it("accepts a valid super_admin session at minRole=viewer", () => {
    const token = mintTestSession({
      email: "johan@clixsy.com",
      role: "super_admin",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ctx.email, "johan@clixsy.com");
      assert.equal(r.ctx.role, "super_admin");
      assert.equal(r.ctx.via, "app_session");
    }
  });

  it("accepts a valid admin session at minRole=admin", () => {
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ctx.role, "admin");
  });

  it("accepts a valid viewer session at minRole=viewer", () => {
    const token = mintTestSession({
      email: "bob@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ctx.role, "viewer");
  });

  it("rejects 403 + audit when viewer tries minRole=admin", () => {
    const token = mintTestSession({
      email: "bob@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: token },
      method: "POST",
    });
    const r = requireRole(req as never, "admin", "/api/onboarding/field-edits");
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

  it("rejects 403 when viewer tries minRole=super_admin", () => {
    const token = mintTestSession({
      email: "bob@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "super_admin", "/api/admin/users");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });

  it("rejects 403 when admin tries minRole=super_admin", () => {
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "super_admin", "/api/admin/users");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });

  it("accepts when super_admin tries minRole=viewer (rank cascades down)", () => {
    const token = mintTestSession({
      email: "johan@clixsy.com",
      role: "super_admin",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
  });

  it("falls through to 401 when session is expired", () => {
    const token = mintTestSession({
      email: "alice@clixsy.com",
      role: "admin",
      iat: PAST - 60,
      exp: PAST,
    });
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.equal(r.reason, "unauthenticated");
    }
  });

  it("falls through to 401 when session has bad signature", () => {
    const payload = base64urlEncode(
      JSON.stringify({
        email: "evil@clixsy.com",
        role: "super_admin",
        iat: NOW,
        exp: FUTURE,
      }),
    );
    const wrongSignature = base64urlEncode(
      createHmac("sha256", "wrong-secret").update(payload).digest(),
    );
    const token = `${payload}.${wrongSignature}`;
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: token } });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  });

  it("rejects when session cookie is malformed (no dot)", () => {
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: "not-a-valid-token" },
    });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  });

  it("rejects when session cookie is empty string", () => {
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: "" } });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  });
});

describe("requireRole — admin_token (password) fallback path", () => {
  it("accepts a valid bearer token at minRole=admin", () => {
    const req = makeReq({
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = requireRole(req as never, "admin", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ctx.email, "(password)");
      assert.equal(r.ctx.role, "admin");
      assert.equal(r.ctx.via, "admin_token");
    }
  });

  it("accepts a valid bearer token at minRole=viewer (admin >= viewer)", () => {
    const req = makeReq({
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ctx.role, "admin");
  });

  it("rejects 403 + audit when password caller tries minRole=super_admin", () => {
    const req = makeReq({
      method: "PUT",
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = requireRole(req as never, "super_admin", "/api/admin/users");
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

  it("rejects 401 when bearer token is wrong", () => {
    const req = makeReq({ authorization: "Bearer not-the-right-hash" });
    const r = requireRole(req as never, "admin", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  });

  it("rejects 401 when Authorization header is missing", () => {
    const req = makeReq({});
    const r = requireRole(req as never, "admin", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  });

  it("rejects 401 when Authorization header has empty bearer", () => {
    const req = makeReq({ authorization: "Bearer " });
    const r = requireRole(req as never, "admin", "/api/admin/clients");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  });
});

describe("requireRole — both layers absent", () => {
  it("returns 401 unauthenticated + audit when neither cookie nor header present", () => {
    const req = makeReq({ method: "GET" });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
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

describe("requireRole — combined paths (app_session takes priority)", () => {
  it("uses app_session even when admin_token is also present", () => {
    // Valid app_session with role=viewer (rank 1).
    // Valid admin_token in header (rank would be admin=2 if used).
    // requireRole should pick app_session (layer 1) — meaning
    // minRole=admin should REJECT even though admin_token by itself
    // would have passed.
    const sessionToken = mintTestSession({
      email: "carla@clixsy.com",
      role: "viewer",
      iat: NOW,
      exp: FUTURE,
    });
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: sessionToken },
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 403);
      assert.equal(r.reason, "forbidden");
    }
  });

  it("falls through to admin_token when app_session is bad-signature", () => {
    const payload = base64urlEncode(
      JSON.stringify({
        email: "evil@clixsy.com",
        role: "super_admin",
        iat: NOW,
        exp: FUTURE,
      }),
    );
    const wrongSignature = base64urlEncode(
      createHmac("sha256", "wrong-secret").update(payload).digest(),
    );
    const sessionToken = `${payload}.${wrongSignature}`;

    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: sessionToken },
      authorization: `Bearer ${expectedAdminToken()}`,
    });
    const r = requireRole(req as never, "admin", "/api/onboarding/field-edits");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ctx.via, "admin_token");
      assert.equal(r.ctx.role, "admin");
    }
  });
});

describe("requireRole — never throws on weird input", () => {
  it("handles a single-dot session cookie", () => {
    const req = makeReq({ cookies: { [APP_SESSION_COOKIE_NAME]: "." } });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
  });

  it("handles a session cookie with only the signature half", () => {
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: ".signature" },
    });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
  });

  it("handles a session cookie with only the payload half", () => {
    const req = makeReq({
      cookies: { [APP_SESSION_COOKIE_NAME]: "payload." },
    });
    const r = requireRole(req as never, "viewer", "/api/admin/clients");
    assert.equal(r.ok, false);
  });
});

describe("requireRole — captures HTTP method in audit payload", () => {
  it("GET rejected -> audit.payload.method === 'GET'", () => {
    const req = makeReq({ method: "GET" });
    const r = requireRole(req as never, "admin", "/api/admin/clients");
    if (!r.ok) {
      assert.equal((r.audit.payload as { method: string }).method, "GET");
    } else {
      assert.fail("expected rejection");
    }
  });

  it("POST rejected -> audit.payload.method === 'POST'", () => {
    const req = makeReq({ method: "POST" });
    const r = requireRole(req as never, "admin", "/api/admin/clients");
    if (!r.ok) {
      assert.equal((r.audit.payload as { method: string }).method, "POST");
    } else {
      assert.fail("expected rejection");
    }
  });

  it("PUT rejected -> audit.payload.method === 'PUT'", () => {
    const req = makeReq({ method: "PUT" });
    const r = requireRole(req as never, "admin", "/api/team-assignments");
    if (!r.ok) {
      assert.equal((r.audit.payload as { method: string }).method, "PUT");
    } else {
      assert.fail("expected rejection");
    }
  });
});
