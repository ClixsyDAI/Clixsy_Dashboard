// =============================================================
// GET /api/admin/users
// =============================================================
//
// Phase 1 PR D-1. Returns the app_users list for the Users tab.
// Includes disabled rows (UI displays them grayed out).
//
// Auth: super_admin OR admin via withAdminAuth (minRole='admin').
// Read-only — no rate-limit (the actionClass option is omitted on
// the wrapper).
//
// Response shape:
//   200 { ok: true, users: AppUser[] }
//   401 / 403 / 503 — handled by withAdminAuth
//   500 — Supabase error during list query

import { NextResponse } from "next/server";
import { withAdminAuth } from "@/app/lib/with-admin-auth";
import { listAppUsers } from "@/app/lib/app-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdminAuth(
  { endpoint: "/api/admin/users", minRole: "admin" },
  async () => {
    const users = await listAppUsers();
    if (users === null) {
      return NextResponse.json(
        { ok: false, reason: "service_unavailable" },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    return NextResponse.json({ ok: true, users });
  },
);
