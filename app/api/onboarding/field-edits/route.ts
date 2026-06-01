// =============================================================
// POST /api/onboarding/field-edits
// =============================================================
//
// Phase 7 PR A step A4 per phase-7-plan.md §5.3.
//
// Workbook-side in-place edit route. Writes a single field to
// `onboarding_answers.answers` (JSONB column) and audits the
// change in `onboarding_field_edits`. This is the FIRST workbook
// route to write to the form's source-of-truth data — every
// previous write touched workbook-owned auxiliary tables
// (onboarding_reminders, onboarding_audit_events).
//
// **Highest-stakes route to date.** Read phase-7-plan.md §9
// risk #0 before changing anything in this file. A bug here
// can lose or corrupt client-entered data mid-onboarding.
//
// Pipeline (per plan §5.3):
//   1. Workbook admin-auth via validateAdminToken.
//   2. Zod-parse the request body.
//   3. lookupFieldConfig(step_key, field_key). 400 if unknown.
//   4. Defence-in-depth: assert client's field_type matches the
//      server's known type for this field.
//   5. validateFieldValue per FieldType. 400 on failure.
//   6. Fetch the existing onboarding_answers row to capture
//      old_value for the audit.
//   7. JSONB UPSERT (UPDATE-existing OR INSERT-new). Critical
//      to use the field_key from the server-looked-up config,
//      NOT the raw client-provided string (defence-in-depth
//      against future-me adding logic that mutates the key
//      before the lookup).
//   8. Audit row via after() per operations-notes entry 2.
//      Try/catch inside the callback so a failing audit
//      logs a console.warn instead of being invisible.
//
// completed column is intentionally NOT touched — confirmed
// stored-not-derived in PR A step A0; the onboarding form's
// Wizard is the sole authority on flipping it.

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "../../../lib/require-role";
import { logAuthAudit } from "../../../lib/auth-audit";
import {
  lookupFieldConfig,
  validateFieldValue,
} from "../../../lib/onboarding/field-edit-validation";
import { STEP_KEYS, type StepKey } from "../../../lib/onboarding/step-keys";
import { getSupabaseServerClient } from "../../../lib/supabase-server";

const StepKeyEnum = z.enum(STEP_KEYS);

const FieldTypeEnum = z.enum([
  "text",
  "long_text",
  "email",
  "tel",
  "url",
  "select",
  "radio",
  "multiselect",
  "checkbox",
]);

const RequestBodySchema = z.object({
  session_id: z.string().uuid(),
  step_key: StepKeyEnum,
  field_key: z.string().min(1).max(64),
  field_type: FieldTypeEnum,
  new_value: z.unknown(),
});

const ACTOR_LABEL = "Workbook (Admin)";

export async function POST(req: NextRequest) {
  // ── 1. Auth ───────────────────────────────────────────────
  const auth = await requireRole(req, "admin", "/api/onboarding/field-edits");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  // ── 2. Parse + Zod-validate body ──────────────────────────
  let parsed;
  try {
    parsed = RequestBodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid request body",
        details: err instanceof Error ? err.message : "parse error",
      },
      { status: 400 },
    );
  }
  const { session_id, step_key, field_key, field_type, new_value } = parsed;

  // ── 3. Field-config lookup ────────────────────────────────
  const fieldConfig = lookupFieldConfig(step_key as StepKey, field_key);
  if (!fieldConfig) {
    return NextResponse.json(
      { ok: false, error: "Unknown field for step" },
      { status: 400 },
    );
  }

  // ── 4. Defence-in-depth: client field_type must match server's ──
  const serverFieldType = fieldConfig.type ?? "text";
  if (field_type !== serverFieldType) {
    return NextResponse.json(
      {
        ok: false,
        error: `field_type mismatch: client sent "${field_type}", server expected "${serverFieldType}"`,
      },
      { status: 400 },
    );
  }

  // ── 5. Per-FieldType value validation ─────────────────────
  const validation = validateFieldValue(fieldConfig, new_value);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: validation.error },
      { status: 400 },
    );
  }
  const normalised_value = validation.value;

  // ── 6. Supabase client ────────────────────────────────────
  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    console.error("[field-edits] supabase client init failed:", err);
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // ── 7. Fetch existing row to capture old_value ────────────
  const existingRes = await supabase
    .from("onboarding_answers")
    .select("id, answers")
    .eq("session_id", session_id)
    .eq("step_key", step_key)
    .maybeSingle();

  if (existingRes.error) {
    console.error(
      `[field-edits] existing-row lookup failed for session_id=${session_id} step_key=${step_key}:`,
      existingRes.error,
    );
    return NextResponse.json(
      { ok: false, error: `Lookup failed: ${existingRes.error.message}` },
      { status: 500 },
    );
  }

  const existingAnswers =
    (existingRes.data?.answers as Record<string, unknown> | undefined) ?? {};
  const old_value =
    field_key in existingAnswers ? existingAnswers[field_key] : null;

  // ── 8. UPSERT the JSONB ───────────────────────────────────
  // Use the field_key from the server-looked-up config, NOT the
  // raw client-provided string. lookupFieldConfig confirmed that
  // string matches a known field, and fieldConfig.name is the
  // authoritative wire identifier.
  const trusted_field_key = fieldConfig.name;

  if (existingRes.data) {
    // UPDATE existing row: merge the new value into answers.
    const updated_answers = {
      ...existingAnswers,
      [trusted_field_key]: normalised_value,
    };
    const updateRes = await supabase
      .from("onboarding_answers")
      .update({ answers: updated_answers })
      .eq("id", existingRes.data.id);

    if (updateRes.error) {
      console.error(
        `[field-edits] update failed for row_id=${existingRes.data.id}:`,
        updateRes.error,
      );
      return NextResponse.json(
        { ok: false, error: `Update failed: ${updateRes.error.message}` },
        { status: 500 },
      );
    }
  } else {
    // INSERT new row. completed is false at insert time — the
    // onboarding form's Wizard is the sole authority on flipping
    // it to true (verified in PR A step A0).
    const insertRes = await supabase.from("onboarding_answers").insert({
      session_id,
      step_key,
      answers: { [trusted_field_key]: normalised_value },
      completed: false,
    });

    if (insertRes.error) {
      console.error(
        `[field-edits] insert failed for session_id=${session_id} step_key=${step_key}:`,
        insertRes.error,
      );
      return NextResponse.json(
        { ok: false, error: `Insert failed: ${insertRes.error.message}` },
        { status: 500 },
      );
    }
  }

  // ── 9. Audit row via after() ──────────────────────────────
  // PIN-of-Phase-6 pattern (operations-notes entry 2): after()
  // is mandatory for non-blocking writes from Vercel routes; bare
  // void/.catch() silently drops the work on serverless teardown.
  // Try/catch INSIDE the callback so a failing audit logs to
  // console.warn instead of being invisible.
  after(async () => {
    try {
      const auditSupabase = getSupabaseServerClient();
      const { error } = await auditSupabase
        .from("onboarding_field_edits")
        .insert({
          session_id,
          step_key,
          field_key: trusted_field_key,
          old_value,
          new_value: normalised_value,
          edited_by_label: ACTOR_LABEL,
        });
      if (error) {
        console.warn(
          "[field-edits] audit insert returned error:",
          error.message,
        );
      }
    } catch (err) {
      console.warn("[field-edits] audit insert threw:", err);
    }
  });

  // ── 10. Return ───────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    old_value,
    new_value: normalised_value,
  });
}
