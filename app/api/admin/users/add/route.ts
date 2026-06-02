// =============================================================
// POST /api/admin/users/add
// =============================================================
//
// Phase 1 PR D-2. Adds a user directly to app_users by email
// (admin-driven; bypasses the invite flow). super_admin only.
//
// Body: { email: string, role: 'super_admin' | 'admin' | 'viewer' }
// Response:
//   200 { ok: true, email, role }
//   400 validation_failed
//   401 actor_session_stale (TOCTOU)
//   403 origin_rejected / forbidden
//   409 user_already_exists / self_action_forbidden
//   429 rate_limited
//   503 service_unavailable (transient)
//
// The RPC layer enforces the actual business rules (existence
// check, self-action guard, last-super-admin guard if applicable);
// this handler only validates input shape and forwards.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAdminAuth, type AdminRouteContext } from "@/app/lib/with-admin-auth";
import { addUserByEmail } from "@/app/lib/app-users";
import { auditHandlerRejection } from "@/app/lib/audit-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().min(3).max(254),
  role: z.enum(["viewer", "admin", "super_admin"]),
});

export const POST = withAdminAuth(
  {
    endpoint: "/api/admin/users/add",
    minRole: "super_admin",
    actionClass: "users_mutation",
  },
  async (req: NextRequest, _routeArgs, ctx: AdminRouteContext) => {
    // Validate body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/users/add",
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
    const bodyParse = BodySchema.safeParse(body);
    if (!bodyParse.success) {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/users/add",
        method: req.method,
        reason: "validation_failed",
        additional: { field: "body" },
        requestMetadata: ctx.requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "validation_failed", field: "body" },
        { status: 400 },
      );
    }

    // session_version is required for this RPC — must come from cookie path.
    if (ctx.auth.session_version === null) {
      // Bearer-token (password) path: no session_version. Plan: super_admin
      // routes only accept cookie-path auth. Reject as forbidden.
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/users/add",
        method: req.method,
        reason: "validation_failed",
        additional: { subreason: "bearer_path_disallowed_for_super_admin_routes" },
        requestMetadata: ctx.requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "forbidden" },
        { status: 403 },
      );
    }

    // Lowercase the email (defense in depth — the RPC also lowercases).
    const targetEmail = bodyParse.data.email.toLowerCase();

    const result = await addUserByEmail({
      targetEmail,
      role: bodyParse.data.role,
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

    return NextResponse.json({
      ok: true,
      email: result.email,
      role: result.role,
    });
  },
);
