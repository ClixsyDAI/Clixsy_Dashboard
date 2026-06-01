// =============================================================
// POST /api/admin/access-requests/[id]/resolve
// =============================================================
//
// Phase 1 PR D-1. Resolves a pending access_request as granted
// (creates app_users row) OR denied (no-op beyond updating
// resolved_at + resolution). super_admin only.
//
// Body: { resolution: 'granted', role: Role } | { resolution: 'denied' }
//
// Approve fails closed if email_verified_at_request_time is NULL
// on the row — defense against attacker-inserted requests.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAdminAuth, type AdminRouteContext } from "@/app/lib/with-admin-auth";
import {
  approveAccessRequest,
  denyAccessRequest,
} from "@/app/lib/app-users";
import { auditHandlerRejection } from "@/app/lib/audit-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UuidSchema = z.string().uuid();

const BodySchema = z.discriminatedUnion("resolution", [
  z.object({
    resolution: z.literal("granted"),
    role: z.enum(["super_admin", "admin", "viewer"]),
  }),
  z.object({
    resolution: z.literal("denied"),
  }),
]);

export const POST = withAdminAuth<{ id: string }>(
  {
    endpoint: "/api/admin/access-requests/[id]/resolve",
    minRole: "super_admin",
    actionClass: "access_request",
  },
  async (req: NextRequest, routeArgs, ctx: AdminRouteContext) => {
    const params = await routeArgs.params;
    const idParse = UuidSchema.safeParse(params.id);
    if (!idParse.success) {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/access-requests/[id]/resolve",
        method: req.method,
        reason: "validation_failed",
        additional: { field: "id", attempted_value: params.id },
        requestMetadata: ctx.requestMetadata,
      });
      return NextResponse.json(
        { ok: false, reason: "validation_failed", field: "id" },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/access-requests/[id]/resolve",
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
        endpoint: "/api/admin/access-requests/[id]/resolve",
        method: req.method,
        reason: "validation_failed",
        additional: { issues: bodyParse.error.issues.map((i) => i.path.join(".")) },
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

    const requestMetadata = ctx.requestMetadata as unknown as Record<string, unknown>;

    if (bodyParse.data.resolution === "granted") {
      const result = await approveAccessRequest({
        requestId: idParse.data,
        role: bodyParse.data.role,
        actorEmail: ctx.auth.email,
        actorSessionVersion: ctx.auth.session_version,
        requestMetadata,
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
    }

    // denied
    const result = await denyAccessRequest({
      requestId: idParse.data,
      actorEmail: ctx.auth.email,
      actorSessionVersion: ctx.auth.session_version,
      requestMetadata,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true });
  },
);
