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
// Auth posture (discovery-notes.md §5 Q2): inherits the workbook's
// existing "internal pages have no gate" posture. Any request that
// can reach `/client/[id]` can reach this route. The service role
// key is consumed via app/lib/supabase-server.ts and never leaves
// the server.

import { NextResponse } from "next/server";
import { getOnboardingByWorkbookId } from "../../../../lib/onboarding/get-by-workbook-id";

// Use the Node.js runtime; the underlying server module uses
// `import "server-only"` which is Node-only.
export const runtime = "nodejs";
// Don't cache — the workbook expects fresh session data on every
// tab open.
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
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
