// =============================================================
// POST /api/onboarding/sessions/[id]/token
// =============================================================
//
// Phase 8 proper PR B per phase-8-proper-plan.md §5.2.
//
// The session.token is a credential. Paired with the 6-digit PIN
// it grants public access to the onboarding form. Until this PR,
// every workbook page load that hit /api/onboarding/by-workbook-
// id/[id] received the token in the joined payload — only one UI
// component genuinely needed it (Copy link on the ONBOARDING tab),
// the rest plumbed it through props without using it.
//
// PR B redacts the token from that payload. Consumers that need
// the token call this endpoint on user intent. Each access writes
// one onboarding_audit_events row so we can see who fetched a
// token, when, and which UI surface triggered the fetch.
//
// =============================================================
// HTTP shape — POST, not GET
// =============================================================
//
// Plan §5.2 originally sketched this as GET. Two reasons it ships
// as POST:
//   1. The handler writes an audit row — that's a side effect.
//      GET handlers should be safe + idempotent. POST is the
//      conventional fit.
//   2. POST takes a body, and the operator's source-discriminator
//      requirement (audit row's payload.source distinguishes
//      "copy_link" / "view_form" / "send_reminder_modal") needs a
//      structured input that survives URL-encoding and is easy to
//      validate. Body shape > query param hygiene for this use
//      case.
//
// =============================================================
// Two-layer auth
// =============================================================
//
// 1. `proxy.ts` matcher already gates /api/onboarding/* — the
//    Phase 8 emergency hotfix (PR #20) covers cookie auth at the
//    edge.
// 2. This handler's validateAdminToken() Bearer check is the
//    second layer (Phase 6/7 pattern) — protects against any
//    future hypothetical where the proxy is misconfigured AND
//    against scripted callers bypassing the cookie. Belt-and-
//    braces; both required.
//
// =============================================================
// Audit shape
// =============================================================
//
// Writes to onboarding_audit_events (Phase 6 table, types.gen.ts
// :126-157). Same table /api/onboarding/regenerate-pin writes to
// today. Columns: session_id, event_type, payload (Json).
//
//   event_type: "onboarding_token_accessed"
//   payload: {
//     actor_label: "Workbook (Admin)"   // matches Phase 6 convention
//     source: <validated string>         // "copy_link" | "view_form" | "send_reminder_modal"
//   }
//
// Inserted via `after()` per operations-notes.md §2 — the response
// returns immediately; the audit insert runs after the connection
// closes. Failure logs but does not affect the user-facing
// response (the credential delivery is more important than the
// audit write succeeding; the alternative is failing the user
// flow when the audit table is briefly unavailable, which is
// worse).

import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "../../../../../lib/supabase-server";
import { requireRole } from "../../../../../lib/require-role";
import { logAuthAudit } from "../../../../../lib/auth-audit";
import { ONBOARDING_BASE_URL } from "../../../../../lib/onboarding/onboarding-url";

const ACTOR_LABEL = "Workbook (Admin)";

// Whitelist of valid source values. Adding a new UI surface that
// accesses tokens means adding a value here. Keeping the list
// explicit makes the audit log queryable without surprises.
const VALID_SOURCES = ["copy_link", "view_form", "send_reminder_modal"] as const;
type TokenAccessSource = (typeof VALID_SOURCES)[number];

const RequestBodySchema = z.object({
  source: z.enum(VALID_SOURCES),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth (proxy cookie gate already passed).
  const auth = await requireRole(
    req,
    "admin",
    "/api/onboarding/sessions/[id]/token",
  );
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  // 2. Parse session id from URL + validate.
  const { id: rawId } = await params;
  const idResult = z.string().uuid().safeParse(rawId);
  if (!idResult.success) {
    return NextResponse.json(
      { error: "Invalid session id (expected uuid)" },
      { status: 400 },
    );
  }
  const sessionId = idResult.data;

  // 3. Parse + validate body.
  let parsed;
  try {
    parsed = RequestBodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        detail:
          err instanceof z.ZodError
            ? err.issues.map((i) => i.message).join(", ")
            : String(err),
      },
      { status: 400 },
    );
  }
  const source: TokenAccessSource = parsed.source;

  // 4. Look up session token. Service-role client — RLS is irrelevant
  //    here because the Bearer + cookie auth has already gated.
  const supabase = getSupabaseServerClient();
  const { data: session, error: lookupError } = await supabase
    .from("onboarding_sessions")
    .select("token")
    .eq("id", sessionId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: "Database error", detail: lookupError.message },
      { status: 500 },
    );
  }
  if (!session) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 },
    );
  }

  // 5. Audit row via after() — fire-and-forget after response.
  //    Mirrors /api/onboarding/regenerate-pin's pattern. The token
  //    is NEVER in the audit payload — only the fact + source.
  after(async () => {
    try {
      const { error } = await supabase
        .from("onboarding_audit_events")
        .insert({
          session_id: sessionId,
          event_type: "onboarding_token_accessed",
          payload: {
            actor_label: ACTOR_LABEL,
            source,
          },
        });
      if (error) {
        console.warn(
          "[sessions/token] audit insert returned error:",
          error.message,
        );
      }
    } catch (err) {
      console.warn("[sessions/token] audit insert threw:", err);
    }
  });

  // 6. View form opens the form the way an AM should see it: PIN
  //    waived, welcome wizard suppressed, zero tracking rows (E2E
  //    finding F3, 2026-06-11 — previously this button opened the
  //    plain client link, hit the PIN gate, and burned a tracked
  //    open in the very Open History the bypass keeps clean). The
  //    signature is HMAC'd with a secret only the onboarding deploy
  //    holds, so it's fetched cross-repo (same bearer pattern as
  //    regenerate-pin). Failure degrades gracefully: token-only
  //    response → View form opens the plain link → PIN gate, which
  //    is the pre-F3 behaviour, not an outage. Copy link NEVER gets
  //    the signature — that link is sent to clients.
  let amSignature: string | undefined;
  if (source === "view_form") {
    const bearer = process.env.SHARED_INTEGRATION_BEARER_TOKEN;
    if (!bearer) {
      console.warn("[sessions/token] SHARED_INTEGRATION_BEARER_TOKEN unset — View form falls back to the plain link");
    } else {
      try {
        const res = await fetch(
          `${ONBOARDING_BASE_URL}/api/admin/onboarding/sessions/${sessionId}/am-link`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${bearer}` },
            // Bound the wait so a slow onboarding deploy can't hang the
            // click past usefulness — fall back to the plain link instead.
            signal: AbortSignal.timeout(8000),
          },
        );
        if (res.ok) {
          const body = (await res.json()) as { amSignature?: string };
          if (typeof body.amSignature === "string" && body.amSignature) {
            amSignature = body.amSignature;
          }
        } else {
          console.warn(`[sessions/token] am-link fetch returned ${res.status} — View form falls back to the plain link`);
        }
      } catch (err) {
        console.warn("[sessions/token] am-link fetch failed — View form falls back to the plain link:", err);
      }
    }
  }

  // 7. Respond with the token (and, for view_form, the AM-bypass
  //    signature). Cache-Control: no-store — the response contains
  //    credentials; do not cache anywhere (browser, CDN, Vercel edge).
  return NextResponse.json(
    { token: session.token, ...(amSignature ? { amSignature } : {}) },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
