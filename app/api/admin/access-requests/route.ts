// =============================================================
// GET /api/admin/access-requests
// =============================================================
//
// Phase 1 PR D-1. Lists pending access requests (resolved_at is
// null). super_admin OR admin can read.

import { NextResponse } from "next/server";
import { withAdminAuth } from "@/app/lib/with-admin-auth";
import { listPendingAccessRequests } from "@/app/lib/app-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdminAuth(
  { endpoint: "/api/admin/access-requests", minRole: "admin" },
  async () => {
    const requests = await listPendingAccessRequests();
    if (requests === null) {
      return NextResponse.json(
        { ok: false, reason: "service_unavailable" },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    return NextResponse.json({ ok: true, requests });
  },
);
