// =============================================================
// POST /api/admin/users/[email]/role
// =============================================================
//
// Phase 1 PR D-1. Changes a user's role. super_admin only.
//
// Body: { role: 'super_admin' | 'admin' | 'viewer' }
// Response:
//   200 { ok: true, before: { role }, after: { role } }
//   400 invalid_role / validation_failed
//   401 actor_session_stale (TOCTOU)
//   403 origin_rejected / forbidden
//   404 target_not_found
//   409 self_action_forbidden / cannot_remove_last_super_admin
//   429 rate_limited
//   503 service_unavailable (transient)
//
// Self-action guard at the RPC layer; this handler doesn't pre-check.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAdminAuth, type AdminRouteContext } from "@/app/lib/with-admin-auth";
import { setUserRole } from "@/app/lib/app-users";
import { auditHandlerRejection } from "@/app/lib/audit-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  role: z.enum(["super_admin", "admin", "viewer"]),
});

const EmailSchema = z.string().email().min(3).max(254);

export const POST = withAdminAuth<{ email: string }>(
  {
    endpoint: "/api/admin/users/[email]/role",
    minRole: "super_admin",
    actionClass: "users_mutation",
  },
  async (req: NextRequest, routeArgs, ctx: AdminRouteContext) => {
    // Validate path param.
    const params = await routeArgs.params;
    const rawEmail = decodeURIComponent(params.email);
    const emailParse = EmailSchema.safeParse(rawEmail);
    if (!emailParse.success) {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/users/[email]/role",
        method: req.method,
        reason: "validation_failed",
        additional: { field: "email", attempted_value: rawEmail },
        requestMetadata: ctx.requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "validation_failed", field: "email" },
        { status: 400 },
      );
    }

    // Validate body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/users/[email]/role",
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
        endpoint: "/api/admin/users/[email]/role",
        method: req.method,
        reason: "validation_failed",
        additional: { field: "body.role" },
        requestMetadata: ctx.requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "validation_failed", field: "body.role" },
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
        endpoint: "/api/admin/users/[email]/role",
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

    const result = await setUserRole({
      targetEmail: emailParse.data,
      newRole: bodyParse.data.role,
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
      before: result.before,
      after: result.after,
    });
  },
);
