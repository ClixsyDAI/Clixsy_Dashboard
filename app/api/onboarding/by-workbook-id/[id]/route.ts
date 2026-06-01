// =============================================================
// GET /api/onboarding/by-workbook-id/[id]
// =============================================================
//
// Phase 2 (per phase-2-plan.md §6): thin route handler that delegates
// to the shared `getOnboardingByWorkbookId` server module. The query
// chain itself (clients → onboarding_sessions → onboarding_answers
// → onboarding_reminders) lives in app/lib/onboarding/get-by-workbook-id.ts
// so the /client/[id] page can call the same code path without
// HTTP-round-tripping through this route.
//
// Auth posture: PR C added `requireRole('viewer')` defence-in-depth.
// Previously this route was proxy-gate-only ("internal pages have no
// gate" per discovery-notes.md §5 Q2). After PR C, the route also
// verifies an app_session cookie OR admin_token bearer in-handler so
// a misconfigured matcher (operations-notes §6c) can't expose the
// onboarding payload. Viewer rank is the floor — anyone with workbook
// access should be able to read /client/[id]. The service role key is
// consumed via app/lib/supabase-server.ts and never leaves the server.

import { NextRequest, NextResponse } from "next/server";
import { getOnboardingByWorkbookId } from "../../../../lib/onboarding/get-by-workbook-id";
import { requireRole } from "../../../../lib/require-role";
import { logAuthAudit } from "../../../../lib/auth-audit";

// Use the Node.js runtime; the underlying server module uses
// `import "server-only"` which is Node-only.
export const runtime = "nodejs";
// Don't cache — the workbook expects fresh session data on every
// tab open.
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = requireRole(req, "viewer", "/api/onboarding/by-workbook-id/[id]");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  const { id: rawId } = await ctx.params;
  const result = await getOnboardingByWorkbookId(rawId);

  switch (result.kind) {
    case "ok":
      return NextResponse.json(result.payload, { status: 200 });

    case "invalid_id":
      return NextResponse.json(
        { error: "Invalid workbook id", detail: result.message },
        { status: 400 },
      );

    case "not_found":
      return NextResponse.json(
        {
          error:
            result.reason === "no_client"
              ? "No client mapped for this workbook id"
              : "No onboarding session for this client",
        },
        { status: 404 },
      );

    case "error":
      // Errors are already logged inside the module; surface a
      // signal-but-no-internals message to the caller.
      return NextResponse.json(
        {
          error: `Supabase ${result.stage.replace(/_/g, " ")} failed`,
          detail: result.message,
        },
        { status: 500 },
      );
  }
}
