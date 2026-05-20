// =============================================================
// GET /api/onboarding/by-workbook-id/[id]
// =============================================================
//
// Phase 1 of the Onboarding tab. Resolves a workbook integer id
// (the Basecamp project id from app/data/projects.json) to the
// joined Supabase payload:
//
//     workbook_id (integer)
//        → clients (UUID, by clients.workbook_id)
//          → onboarding_sessions (most recent first)
//            → onboarding_answers (all 12 step rows, if present)
//
// Returns 404 if no client row matches the workbook_id, or if the
// client has no onboarding session. The Onboarding tab in the
// workbook UI is hidden in both 404 cases (see app/client/[id]/page.tsx).
//
// Auth posture (discovery-notes.md §5 Q2): inherits the workbook's
// existing "internal pages have no gate" posture. Any request that
// can reach `/client/[id]` can reach this route. The service role
// key is consumed via app/lib/supabase-server.ts and never leaves
// the server.

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../../lib/supabase-server";
import type {
  ClientRow,
  OnboardingAnswerRow,
  OnboardingByWorkbookIdPayload,
  OnboardingSessionRow,
} from "../../../../lib/onboarding/types";

// Use the Node.js runtime; supabase-server imports node:crypto-adjacent
// code paths and `import "server-only"`, both Node-only.
export const runtime = "nodejs";
// Don't cache — the workbook expects fresh session data on every
// tab open.
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id: rawId } = await ctx.params;

  // The route param is the integer Basecamp project id, but URLs
  // can carry anything. Reject non-numerics fast.
  const workbookId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(workbookId) || workbookId <= 0) {
    return NextResponse.json(
      { error: "Invalid workbook id" },
      { status: 400 },
    );
  }

  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    // Configuration error (env vars missing). Surface 500 with a
    // signal-but-no-secrets message.
    console.error("[onboarding/by-workbook-id] supabase client init failed:", err);
    return NextResponse.json(
      {
        error: "Supabase client not configured",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }

  // ── 1. Resolve the workbook_id → clients row ────────────────
  const clientRes = await supabase
    .from("clients")
    .select(
      "id, agency_id, client_name, primary_contact_name, primary_contact_email, website_url, workbook_id, created_at",
    )
    .eq("workbook_id", workbookId)
    .maybeSingle<ClientRow>();

  if (clientRes.error) {
    console.error(
      `[onboarding/by-workbook-id] clients lookup failed for workbook_id=${workbookId}:`,
      clientRes.error,
    );
    return NextResponse.json(
      { error: "Supabase clients lookup failed", detail: clientRes.error.message },
      { status: 500 },
    );
  }
  if (!clientRes.data) {
    return NextResponse.json(
      { error: "No client mapped for this workbook id" },
      { status: 404 },
    );
  }
  const client = clientRes.data;

  // ── 2. Latest onboarding_sessions row for this client ───────
  const sessionRes = await supabase
    .from("onboarding_sessions")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<OnboardingSessionRow>();

  if (sessionRes.error) {
    console.error(
      `[onboarding/by-workbook-id] sessions lookup failed for client_id=${client.id}:`,
      sessionRes.error,
    );
    return NextResponse.json(
      {
        error: "Supabase sessions lookup failed",
        detail: sessionRes.error.message,
      },
      { status: 500 },
    );
  }
  if (!sessionRes.data) {
    return NextResponse.json(
      { error: "No onboarding session for this client" },
      { status: 404 },
    );
  }
  const session = sessionRes.data;

  // ── 3. All onboarding_answers rows for that session ─────────
  const answersRes = await supabase
    .from("onboarding_answers")
    .select("id, session_id, step_key, answers, completed, updated_at")
    .eq("session_id", session.id)
    .order("updated_at", { ascending: true });

  if (answersRes.error) {
    console.error(
      `[onboarding/by-workbook-id] answers lookup failed for session_id=${session.id}:`,
      answersRes.error,
    );
    return NextResponse.json(
      {
        error: "Supabase answers lookup failed",
        detail: answersRes.error.message,
      },
      { status: 500 },
    );
  }
  const answers = (answersRes.data ?? []) as OnboardingAnswerRow[];

  const payload: OnboardingByWorkbookIdPayload = {
    client,
    session,
    answers,
  };

  return NextResponse.json(payload, { status: 200 });
}
