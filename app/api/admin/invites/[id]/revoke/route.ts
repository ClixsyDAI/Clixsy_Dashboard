// =============================================================
// POST /api/admin/invites/[id]/revoke
// =============================================================
//
// Phase 1 PR D-1. Marks a pending invite as revoked. super_admin
// only. Idempotent on already-revoked. Refuses already-accepted.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAdminAuth, type AdminRouteContext } from "@/app/lib/with-admin-auth";
import { revokeInvite } from "@/app/lib/app-users";
import { auditHandlerRejection } from "@/app/lib/audit-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UuidSchema = z.string().uuid();

export const POST = withAdminAuth<{ id: string }>(
  {
    endpoint: "/api/admin/invites/[id]/revoke",
    minRole: "super_admin",
    actionClass: "users_mutation",
  },
  async (req: NextRequest, routeArgs, ctx: AdminRouteContext) => {
    const params = await routeArgs.params;
    const parse = UuidSchema.safeParse(params.id);
    if (!parse.success) {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/invites/[id]/revoke",
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

    if (ctx.auth.session_version === null) {
      return NextResponse.json(
        { ok: false, reason: "forbidden" },
        { status: 403 },
      );
    }

    const result = await revokeInvite({
      inviteId: parse.data,
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

    return NextResponse.json({ ok: true, noop: result.noop ?? false });
  },
);
