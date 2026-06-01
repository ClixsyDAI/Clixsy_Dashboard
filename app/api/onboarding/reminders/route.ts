// =============================================================
// POST /api/onboarding/reminders
// =============================================================
//
// Phase 6 PR A step A5 per phase-6-plan.md §5.5.
//
// Writes a row to `onboarding_reminders` (migration 008). Handles
// both reminder kinds in one route:
//   - "form_reminder"   → Send Form Reminder modal (spec §6.5)
//   - "access_request"  → Request Missing Access modal (spec §6.6)
//
// The workbook itself owns this write — no cross-repo hop. We
// already have service-role access to the same Supabase project
// from Phase 1, and `onboarding_reminders` is the workbook-owned
// table conceptually (the onboarding repo doesn't read it).
//
// Phase 6 stores the body but does NOT send any email. Outbound
// delivery is deferred to Phase 9 per spec.
//
// Idempotency / debounce (plan §4.4):
//   The client disables Send while in flight. The server also
//   debounces: if the last reminder of the same kind for the
//   same session was written within the last 10 seconds, return
//   that row's id without inserting a duplicate. Catches the
//   accidental double-click / multi-tab race case without
//   adding an idempotency-key column.
//
// Auth: workbook admin token via lib/admin-auth.ts.
// Body validation: zod.
// Response on success:
//   { id: string, sent_at: string, debounced: boolean }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "../../../lib/supabase-server";
import { requireRole } from "../../../lib/require-role";
import { logAuthAudit } from "../../../lib/auth-audit";

const DEBOUNCE_WINDOW_MS = 10_000;

const RequestBodySchema = z.object({
  session_id: z.string().uuid(),
  kind: z.enum(["form_reminder", "access_request"]),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
});

const SENT_BY_LABEL = "Workbook (Admin)";

export async function POST(req: NextRequest) {
  // 1. Auth.
  const auth = await requireRole(req, "admin", "/api/onboarding/reminders");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  // 2. Parse + validate body.
  let parsed;
  try {
    parsed = RequestBodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: err instanceof Error ? err.message : "parse error",
      },
      { status: 400 },
    );
  }
  const { session_id, kind, subject, body } = parsed;

  // 3. Supabase client.
  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    console.error("[reminders] supabase client init failed:", err);
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // 4. Debounce check — most recent reminder of same kind for this
  //    session. If within DEBOUNCE_WINDOW_MS, return its id.
  const debounceCutoffIso = new Date(
    Date.now() - DEBOUNCE_WINDOW_MS,
  ).toISOString();
  const recentRes = await supabase
    .from("onboarding_reminders")
    .select("id, sent_at")
    .eq("session_id", session_id)
    .eq("kind", kind)
    .gte("sent_at", debounceCutoffIso)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentRes.error) {
    console.error("[reminders] debounce lookup failed:", recentRes.error);
    return NextResponse.json(
      { error: `Debounce lookup failed: ${recentRes.error.message}` },
      { status: 500 },
    );
  }
  if (recentRes.data) {
    return NextResponse.json({
      id: recentRes.data.id,
      sent_at: recentRes.data.sent_at,
      debounced: true,
    });
  }

  // 5. Insert new row.
  const insertRes = await supabase
    .from("onboarding_reminders")
    .insert({
      session_id,
      kind,
      sent_by_label: SENT_BY_LABEL,
      email_subject: subject,
      email_body: body,
    })
    .select("id, sent_at")
    .single();

  if (insertRes.error || !insertRes.data) {
    console.error("[reminders] insert failed:", insertRes.error);
    return NextResponse.json(
      {
        error: `Insert failed: ${insertRes.error?.message ?? "unknown"}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: insertRes.data.id,
    sent_at: insertRes.data.sent_at,
    debounced: false,
  });
}
