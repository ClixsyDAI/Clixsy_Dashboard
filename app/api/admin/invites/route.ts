// =============================================================
// /api/admin/invites — GET list, POST create
// =============================================================
//
// Phase 1 PR D-1.
//
// GET: list pending invites (super_admin OR admin can read).
// POST: create an invite (super_admin only).
//
// Plaintext token is returned EXACTLY ONCE in the POST response.
// It is NEVER stored (only sha256 hash is). It is NEVER audited.
// The admin copies it from the response and shares it manually
// (operator's Q4 answer — no email delivery in D-1).

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { withAdminAuth, type AdminRouteContext } from "@/app/lib/with-admin-auth";
import { createInvite, listPendingInvites } from "@/app/lib/app-users";
import { auditHandlerRejection } from "@/app/lib/audit-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_TTL_HOURS = 24;

const PostBodySchema = z.object({
  email: z.string().email().min(3).max(254),
  role: z.enum(["super_admin", "admin", "viewer"]),
});

// =============================================================
// GET — list pending invites
// =============================================================

export const GET = withAdminAuth(
  { endpoint: "/api/admin/invites", minRole: "admin" },
  async () => {
    const invites = await listPendingInvites();
    if (invites === null) {
      return NextResponse.json(
        { ok: false, reason: "service_unavailable" },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    return NextResponse.json({ ok: true, invites });
  },
);

// =============================================================
// POST — create invite
// =============================================================

export const POST = withAdminAuth(
  {
    endpoint: "/api/admin/invites",
    minRole: "super_admin",
    actionClass: "users_mutation",
  },
  async (req: NextRequest, _routeArgs, ctx: AdminRouteContext) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/invites",
        method: req.method,
        reason: "validation_failed",
        additional: { field: "body", subreason: "invalid_json" },
        requestMetadata: ctx.requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "validation_failed", field: "body" },
        { status: 400 },
      );
    }

    const parse = PostBodySchema.safeParse(body);
    if (!parse.success) {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/invites",
        method: req.method,
        reason: "validation_failed",
        additional: { issues: parse.error.issues.map((i) => i.path.join(".")) },
        requestMetadata: ctx.requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "validation_failed" },
        { status: 400 },
      );
    }

    if (ctx.auth.session_version === null) {
      return NextResponse.json(
        { ok: false, reason: "forbidden" },
        { status: 403 },
      );
    }

    // Generate the plaintext token + its sha256 hash. Plaintext stays
    // on this server frame; only the hash goes to the DB (via the RPC).
    // 32 random bytes = 256 bits of entropy. base64url encoding =
    // 43 chars (no padding).
    const plaintextToken = randomBytes(32).toString("base64url");
    const tokenSha256 = createHash("sha256")
      .update(plaintextToken)
      .digest("hex");

    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    const result = await createInvite({
      email: parse.data.email,
      role: parse.data.role,
      inviteTokenSha256: tokenSha256,
      expiresAt,
      actorEmail: ctx.auth.email,
      actorSessionVersion: ctx.auth.session_version,
      requestMetadata: ctx.requestMetadata as unknown as Record<string, unknown>,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: result.status },
      );
    }

    // PR D-1 §11 (credential discipline): plaintext token returned
    // ONCE here. NEVER stored. NEVER logged. The admin copies + shares
    // the resulting URL manually.
    return NextResponse.json({
      ok: true,
      invite_id: result.invite_id,
      email: parse.data.email,
      role: parse.data.role,
      expires_at: result.expires_at,
      // The plaintext token — caller's responsibility to handle. Embed
      // as ?token=<plaintext> on the accept URL the admin shares.
      invite_token: plaintextToken,
    });
  },
);
