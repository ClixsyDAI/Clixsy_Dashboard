// =============================================================
// POST /api/admin/users/[email]/disable
// =============================================================
//
// Phase 1 PR D-1. Disables a user (sets disabled_at = now()).
// super_admin only. Bumps session_version on the target.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAdminAuth, type AdminRouteContext } from "@/app/lib/with-admin-auth";
import { disableUser } from "@/app/lib/app-users";
import { auditHandlerRejection } from "@/app/lib/audit-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EmailSchema = z.string().email().min(3).max(254);

export const POST = withAdminAuth<{ email: string }>(
  {
    endpoint: "/api/admin/users/[email]/disable",
    minRole: "super_admin",
    actionClass: "users_mutation",
  },
  async (req: NextRequest, routeArgs, ctx: AdminRouteContext) => {
    const params = await routeArgs.params;
    const rawEmail = decodeURIComponent(params.email);
    const emailParse = EmailSchema.safeParse(rawEmail);
    if (!emailParse.success) {
      auditHandlerRejection({
        eventType: "handler_validation_failed",
        actorEmail: ctx.auth.email,
        endpoint: "/api/admin/users/[email]/disable",
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

    if (ctx.auth.session_version === null) {
      return NextResponse.json(
        { ok: false, reason: "forbidden" },
        { status: 403 },
      );
    }

    const result = await disableUser({
      targetEmail: emailParse.data,
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

    return NextResponse.json({ ok: true });
  },
);
