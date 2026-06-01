// =============================================================
// POST /api/onboarding/regenerate-pin
// =============================================================
//
// Phase 6 PR A step A5 per phase-6-plan.md §5.6.
//
// Cross-repo facade. The workbook's Regenerate PIN modal (spec
// §6.7) needs to rotate a session's PIN, but the rotation logic
// lives in the onboarding repo (scrypt params, column shape) and
// the workbook should not duplicate it. This route is the only
// caller of the onboarding repo's regenerate-pin endpoint from
// workbook code — the modal hits this route, this route hits
// the onboarding endpoint with the bearer token.
//
// Why a facade rather than calling cross-repo from the browser:
//   - Bearer token never reaches the browser bundle.
//   - CORS not required (we're server-to-server inside Vercel).
//   - Cross-repo failures get a workbook-side log + a 502 with
//     the upstream error attached, instead of an opaque browser
//     network error.
//
// Audit (plan §4.5): every PIN rotation triggered from the
// workbook writes one onboarding_audit_events row with event_type
// "pin_regenerated_from_workbook". The PIN itself is NEVER in the
// audit payload — only the fact that a rotation happened, which
// actor (hardcoded "Workbook (Admin)" until multi-user lands),
// and the source ("action_bar"). Insert via after() per
// operations-notes.md entry 2 so the response doesn't block on
// the audit write.

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "../../../lib/supabase-server";
import { requireRole } from "../../../lib/require-role";
import { logAuthAudit } from "../../../lib/auth-audit";

const ONBOARDING_BASE_URL = "https://client-onboarding-tool.vercel.app";

const RequestBodySchema = z.object({
  session_id: z.string().uuid(),
});

const ACTOR_LABEL = "Workbook (Admin)";

export async function POST(req: NextRequest) {
  // 1. Auth.
  const auth = requireRole(req, "admin", "/api/onboarding/regenerate-pin");
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
  const { session_id } = parsed;

  // 3. Bearer token must be configured for the cross-repo call.
  //    If it's missing in this environment, fail loud rather
  //    than calling unauthenticated (which would succeed in
  //    onboarding's local-dev mode and silently bypass auth).
  const bearer = process.env.SHARED_INTEGRATION_BEARER_TOKEN;
  if (!bearer) {
    console.error(
      "[regenerate-pin] SHARED_INTEGRATION_BEARER_TOKEN not configured",
    );
    return NextResponse.json(
      { error: "Server misconfigured: bearer token missing" },
      { status: 500 },
    );
  }

  // 4. Cross-repo call.
  const upstreamUrl = `${ONBOARDING_BASE_URL}/api/admin/onboarding/sessions/${session_id}/regenerate-pin`;
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
    });
  } catch (err) {
    console.error("[regenerate-pin] cross-repo fetch failed:", err);
    return NextResponse.json(
      {
        error: "Failed to reach onboarding service",
        details: err instanceof Error ? err.message : "fetch error",
      },
      { status: 502 },
    );
  }

  let upstreamBody: unknown;
  try {
    upstreamBody = await upstreamRes.json();
  } catch (err) {
    console.error("[regenerate-pin] upstream returned non-JSON:", err);
    return NextResponse.json(
      {
        error: "Onboarding service returned malformed response",
        upstream_status: upstreamRes.status,
      },
      { status: 502 },
    );
  }

  if (!upstreamRes.ok) {
    // Log the upstream status + error message but NOT the PIN
    // (none should be present on a failure anyway).
    const upstreamError =
      typeof upstreamBody === "object" && upstreamBody && "error" in upstreamBody
        ? String((upstreamBody as { error: unknown }).error)
        : "unknown upstream error";
    console.error(
      `[regenerate-pin] upstream returned ${upstreamRes.status}: ${upstreamError}`,
    );
    return NextResponse.json(
      {
        error: "Onboarding service rejected the request",
        upstream_status: upstreamRes.status,
        upstream_error: upstreamError,
      },
      { status: 502 },
    );
  }

  // Extract the PIN. Onboarding's response shape:
  //   { success: true, pin: "123456" }
  const pin =
    typeof upstreamBody === "object" &&
    upstreamBody &&
    "pin" in upstreamBody &&
    typeof (upstreamBody as { pin: unknown }).pin === "string"
      ? (upstreamBody as { pin: string }).pin
      : null;
  if (!pin) {
    console.error(
      "[regenerate-pin] upstream success response missing pin field",
    );
    return NextResponse.json(
      {
        error: "Onboarding service returned no PIN",
        upstream_status: upstreamRes.status,
      },
      { status: 502 },
    );
  }

  // 5. Audit row via after() — fire-and-forget after response.
  //    Per operations-notes entry 2, MUST use after() not bare
  //    void/.catch() or the insert silently drops in serverless.
  //    The PIN is NEVER logged or audited — only the action.
  after(async () => {
    try {
      const supabase = getSupabaseServerClient();
      const { error } = await supabase
        .from("onboarding_audit_events")
        .insert({
          session_id,
          event_type: "pin_regenerated_from_workbook",
          payload: {
            actor_label: ACTOR_LABEL,
            source: "action_bar",
          },
        });
      if (error) {
        console.warn(
          "[regenerate-pin] audit insert returned error:",
          error.message,
        );
      }
    } catch (err) {
      console.warn("[regenerate-pin] audit insert threw:", err);
    }
  });

  // 6. Return the PIN. Never logged here.
  return NextResponse.json({ pin });
}
