// =============================================================
// POST /api/webhooks/ghl/opportunity-onboarded
// =============================================================
//
// GHL Pipeline-Stage-Changed workflow webhook receiver. Fires when
// a GHL opportunity transitions into the "Onboarding" stage on a
// configured pipeline ("PI - SEO" → law_firm, "Home Services" →
// home_services). Replaces the Basecamp poller's create path
// (basecamp-poller.ts processNewProject) — the poller stays alive
// during the gap before cutover and is scheduled for removal in
// the cutover PR.
//
// Always-200 invariant
// --------------------
// Per the GHL discovery doc, any 5xx response causes the platform
// to permanently drop the event (no retry queue). So validation
// failures, manifest-write failures, and downstream session-create
// failures all return 200 with { ok: false, reason, ... } so they
// surface in Vercel logs without losing the payload.
//
// The ONLY non-200 cases:
//   - 500 when GHL_WEBHOOK_BEARER is unset (fail loud — a
//     misconfigured prod environment must not silently accept
//     unauthenticated traffic).
//   - 401 when the Authorization header is missing or wrong.
//
// Both of those are GHL-workflow-configuration bugs (operator
// fixable) and won't recover via retry anyway.

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  type Project,
  appendProjectAndCommitManifest,
} from "@/app/lib/projects";

export const runtime = "nodejs";

const ONBOARDING_BASE_URL = "https://clixsy-onboarding.vercel.app";

// Pipeline-to-vertical mapping. Anything unmapped becomes "other"
// and a warning is logged — the new entry still gets written so
// the AM can fix it in the admin UI; we just lose vertical routing
// downstream (onboarding form variant, etc.).
const PIPELINE_TO_VERTICAL: Record<
  string,
  "law_firm" | "home_services" | "other"
> = {
  "PI - SEO": "law_firm",
  "Home Services": "home_services",
};

// Normalize values that GHL templating sends as the literal four-
// character string "null" when the underlying field is empty. This
// happens with custom fields (e.g. `{{opportunity.website_url}}`)
// and the `{{opportunity.assignedTo}}` variable when no AM is set.
// Empty strings come through too — coerce both to JS null so the
// downstream JSON write (projects.json) gets actual null, not the
// string "null".
function normalizeGhlNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null") return null;
  if (/^[A-Za-z0-9]{20}$/.test(trimmed)) return trimmed;
  return null;
}

// GHL custom-webhook payload schema. Field names mirror the workflow
// Custom Action body. "assigned_to" arrives as either a 20-char GHL
// user id or the literal string "null" when no AM is set — see the
// GHL discovery doc §"assigned_to resolution". Optional text fields
// (email/phone/website) accept empty string or the literal "null"
// from GHL templating; both get coerced via normalizeGhlNullable
// before they reach the manifest.
const PayloadSchema = z.object({
  opportunity_id: z.string().regex(/^[A-Za-z0-9]{20}$/),
  opportunity_name: z.string().min(1),
  pipeline_name: z.string().min(1),
  stage_name: z.literal("Onboarding"),
  status: z.string(),
  contact_id: z.string().regex(/^[A-Za-z0-9]{20}$/),
  contact_first_name: z.string(),
  contact_last_name: z.string(),
  contact_email: z.string(),
  contact_phone: z.string(),
  website_url: z.string(),
  assigned_to: z.union([z.string(), z.null()]).optional(),
});

type LogResult = "ok" | "skipped" | "failed";

function logResult(
  result: LogResult,
  opportunity_id: string,
  reason: string,
  start: number,
): void {
  // Single structured line per request — Vercel log search by
  // "[ghl-webhook] result=failed" gets every failure cleanly.
  console.log(
    `[ghl-webhook] result=${result} opportunity_id=${opportunity_id} reason=${reason} elapsed_ms=${Date.now() - start}`,
  );
}

export async function POST(req: NextRequest) {
  const start = Date.now();

  // ── Auth ────────────────────────────────────────────────────
  const bearer = process.env.GHL_WEBHOOK_BEARER;
  if (!bearer) {
    console.error("[ghl-webhook] GHL_WEBHOOK_BEARER not configured");
    return new Response("GHL_WEBHOOK_BEARER not configured", { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${bearer}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Payload validation ──────────────────────────────────────
  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
  } catch {
    // Empty body or invalid JSON — Zod's safeParse will catch and
    // produce a usable error list. Don't 400 here, keep the always-
    // 200 invariant.
  }

  const parsed = PayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const oppId =
      rawBody &&
      typeof rawBody === "object" &&
      "opportunity_id" in rawBody &&
      typeof (rawBody as Record<string, unknown>).opportunity_id === "string"
        ? (rawBody as Record<string, string>).opportunity_id
        : "(unknown)";
    console.warn(
      `[ghl-webhook] invalid_payload errors=${JSON.stringify(errors)}`,
    );
    logResult("failed", oppId, "invalid_payload", start);
    return Response.json({ ok: false, reason: "invalid_payload", errors });
  }

  const payload = parsed.data;

  // ── Pipeline-to-vertical mapping ────────────────────────────
  const mappedVertical = PIPELINE_TO_VERTICAL[payload.pipeline_name];
  const vertical: "law_firm" | "home_services" | "other" =
    mappedVertical ?? "other";
  if (!mappedVertical) {
    console.warn(
      `[ghl-webhook] unknown pipeline "${payload.pipeline_name}" — defaulting vertical to "other"`,
    );
  }

  const assignedTo = normalizeGhlNullable(payload.assigned_to);
  if (assignedTo === null) {
    console.log(`[ghl-webhook] assigned_to_unassigned opp=${payload.opportunity_id} raw=${JSON.stringify(payload.assigned_to)}`);
  }
  const websiteUrl = normalizeGhlNullable(payload.website_url);

  const newProject: Project = {
    id: payload.opportunity_id,
    name: payload.opportunity_name,
    j_number: null,
    description: null,
    vertical,
    ghl_contact_id: payload.contact_id,
    am_ghl_user_id: assignedTo,
    website_url: websiteUrl,
  };

  // Test-mode short-circuit: used by this route's own unit tests to
  // verify payload validation + assigned_to normalization without
  // touching GitHub (manifest commit) or the onboarding repo
  // (Supabase session POST). NEVER set GHL_RECEIVER_TEST_MODE=1 in
  // production env — it skips all side effects.
  if (process.env.GHL_RECEIVER_TEST_MODE === "1") {
    return Response.json({
      ok: true,
      opportunity_id: payload.opportunity_id,
      manifest_blob_sha: "TEST_MODE_NO_COMMIT",
      supabase_session_id: "TEST_MODE_NO_SESSION",
      assigned_to_normalized: assignedTo,
      test_mode: true,
    });
  }

  // ── Idempotency + manifest write ────────────────────────────
  let manifestSha: string;
  try {
    const result = await appendProjectAndCommitManifest(newProject);
    if (result.skipped) {
      logResult("skipped", payload.opportunity_id, "already_exists", start);
      return Response.json({
        ok: true,
        skipped: true,
        reason: "already_exists",
      });
    }
    manifestSha = result.sha;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ghl-webhook] manifest_write_failed opportunity_id=${payload.opportunity_id} error=${message}`,
    );
    logResult(
      "failed",
      payload.opportunity_id,
      "manifest_write_failed",
      start,
    );
    return Response.json({
      ok: false,
      reason: "manifest_write_failed",
      error: message,
    });
  }

  // ── Supabase onboarding session via onboarding repo ─────────
  const shared = process.env.SHARED_INTEGRATION_BEARER_TOKEN;
  if (!shared) {
    console.error(
      "[ghl-webhook] SHARED_INTEGRATION_BEARER_TOKEN not configured",
    );
    logResult(
      "failed",
      payload.opportunity_id,
      "session_create_failed",
      start,
    );
    return Response.json({
      ok: false,
      reason: "session_create_failed",
      error: "SHARED_INTEGRATION_BEARER_TOKEN not configured",
    });
  }

  let onboardingRes: Response;
  try {
    onboardingRes = await fetch(
      `${ONBOARDING_BASE_URL}/api/admin/onboarding/create`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${shared}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Mirrors the Basecamp poller's contract in
          // basecamp-poller.ts createOnboardingSession.
          clientName: payload.opportunity_name,
          // Sentinel — same one the poller used. Onboarding's Zod
          // schema rejects empty strings here; until that schema is
          // made nullable (followup-account-manager-schema-cleanup),
          // the sentinel keeps the create call passing. AM replaces
          // it via the workbook admin UI later.
          accountManager: "Auto-created (unassigned)",
          vertical,
          workbookId: payload.opportunity_id,
        }),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ghl-webhook] session_create_failed network opportunity_id=${payload.opportunity_id} error=${message}`,
    );
    logResult(
      "failed",
      payload.opportunity_id,
      "session_create_failed",
      start,
    );
    return Response.json({
      ok: false,
      reason: "session_create_failed",
      error: { network: message },
    });
  }

  // 409 = workbook_id already linked in onboarding's Supabase row.
  // Idempotent retry path — return ok and let the AM resume.
  if (onboardingRes.status === 409) {
    logResult("ok", payload.opportunity_id, "session_already_exists", start);
    return Response.json({
      ok: true,
      opportunity_id: payload.opportunity_id,
      manifest_blob_sha: manifestSha,
      supabase_session_id: null,
      note: "session already existed (409 from onboarding) — manifest entry was newly created",
    });
  }

  if (!onboardingRes.ok) {
    let errText = "unknown";
    try {
      errText = await onboardingRes.text();
    } catch {
      /* swallow */
    }
    console.error(
      `[ghl-webhook] session_create_failed status=${onboardingRes.status} body=${errText}`,
    );
    logResult(
      "failed",
      payload.opportunity_id,
      "session_create_failed",
      start,
    );
    return Response.json({
      ok: false,
      reason: "session_create_failed",
      error: { status: onboardingRes.status, body: errText },
    });
  }

  const onboardingBody = (await onboardingRes.json()) as {
    sessionId?: string;
    token?: string;
    pin?: string;
  };

  logResult("ok", payload.opportunity_id, "created", start);
  return Response.json({
    ok: true,
    opportunity_id: payload.opportunity_id,
    manifest_blob_sha: manifestSha,
    supabase_session_id: onboardingBody.sessionId ?? null,
  });
}
