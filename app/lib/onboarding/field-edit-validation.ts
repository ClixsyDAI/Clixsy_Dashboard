// =============================================================
// field-edit-validation — lookup + per-FieldType validation
// =============================================================
//
// Phase 7 PR A step A3 per phase-7-plan.md §5.4.
//
// Two pure helpers consumed by the POST /api/onboarding/field-edits
// route:
//
//   lookupFieldConfig(step_key, field_key)
//     Walks SECTION_CONFIGS to find the FieldConfig for a given
//     step + field. Returns null when no match — the route
//     responds 400 "Unknown field for step".
//
//   validateFieldValue(fieldConfig, raw_value)
//     Runs the per-FieldType schema (zod for the union types,
//     custom for tel/checkbox) on the raw client-provided
//     value. Returns the normalised value on success, or an
//     error string on failure.
//
// Per phase-7-plan.md §4.7: required-vs-optional is NOT
// enforced. Every field accepts the empty string (or `null` /
// empty array for non-text types) as a "clear the value"
// signal. The AM has editorial authority to blank a field.

import { z } from "zod";
import {
  SECTION_CONFIGS,
  type FieldConfig,
  type FieldType,
} from "./field-config";
import type { StepKey } from "./step-keys";

export type FieldEditValidation =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

// =============================================================
// lookupFieldConfig
// =============================================================

/**
 * Find a field's config by step_key + field_key. Returns null when
 * either the step doesn't exist or the field isn't listed under it.
 * The caller responds 400 with "Unknown field for step" on null.
 */
export function lookupFieldConfig(
  step_key: StepKey,
  field_key: string,
): FieldConfig | null {
  const section = SECTION_CONFIGS.find((s) => s.stepKey === step_key);
  if (!section) return null;
  const field = section.fields.find((f) => f.name === field_key);
  return field ?? null;
}

// =============================================================
// validateFieldValue
// =============================================================

/**
 * Validate + normalise a raw client value against the field's
 * FieldType. Returns the value on success (potentially trimmed /
 * coerced) or a human-readable error on failure.
 *
 * field-config.ts marks `type` as optional (`type?: FieldType`).
 * Fields without an explicit type default to `"text"` — same
 * implicit default the read-path's `humanize()` falls through to.
 */
export function validateFieldValue(
  fieldConfig: FieldConfig,
  raw_value: unknown,
): FieldEditValidation {
  const type: FieldType = fieldConfig.type ?? "text";

  switch (type) {
    case "text":
    case "select":
    case "radio": {
      // Free-form short string. select / radio inherit this same
      // shape per phase-7-plan.md §4.7 — the canonical-value
      // problem isn't solved at v1 (§9 risk #2).
      const schema = z.string().max(200);
      const result = schema.safeParse(raw_value);
      if (!result.success) {
        return {
          ok: false,
          error: `Value must be a string up to 200 characters`,
        };
      }
      return { ok: true, value: result.data.trim() };
    }

    case "long_text": {
      const schema = z.string().max(10_000);
      const result = schema.safeParse(raw_value);
      if (!result.success) {
        return {
          ok: false,
          error: `Value must be a string up to 10,000 characters`,
        };
      }
      return { ok: true, value: result.data.trim() };
    }

    case "email": {
      // Allow empty string (clears the field). Otherwise must
      // parse as an email.
      if (raw_value === "") return { ok: true, value: "" };
      const schema = z.string().email();
      const result = schema.safeParse(raw_value);
      if (!result.success) {
        return { ok: false, error: "Value must be a valid email address" };
      }
      return { ok: true, value: result.data.trim() };
    }

    case "tel": {
      // Lenient regex — phone-number false-rejection cost outweighs
      // the validation value. Tighter (libphonenumber) is v2 work.
      // Allow empty string to clear.
      if (raw_value === "") return { ok: true, value: "" };
      if (typeof raw_value !== "string") {
        return { ok: false, error: "Value must be a string" };
      }
      const trimmed = raw_value.trim();
      if (!/^[+\d\s()\-]{0,40}$/.test(trimmed)) {
        return {
          ok: false,
          error:
            "Value must look like a phone number (digits, spaces, +, (), -)",
        };
      }
      return { ok: true, value: trimmed };
    }

    case "url": {
      // Allow empty to clear.
      if (raw_value === "") return { ok: true, value: "" };
      const schema = z.string().url();
      const result = schema.safeParse(raw_value);
      if (!result.success) {
        return { ok: false, error: "Value must be a valid URL" };
      }
      return { ok: true, value: result.data.trim() };
    }

    case "multiselect": {
      // Server receives an array (client splits comma-separated
      // text before POST). Empty array is valid (clears).
      const schema = z.array(z.string().max(200)).max(50);
      const result = schema.safeParse(raw_value);
      if (!result.success) {
        return {
          ok: false,
          error:
            "Value must be an array of strings (each up to 200 chars, max 50 items)",
        };
      }
      // Trim each entry; drop empty ones so a trailing comma
      // doesn't survive as a blank chip.
      const cleaned = result.data
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { ok: true, value: cleaned };
    }

    case "checkbox": {
      // Client converts "yes" / "no" / blank to boolean | null
      // before POST. Server accepts the explicit boolean form.
      const schema = z.union([z.boolean(), z.null()]);
      const result = schema.safeParse(raw_value);
      if (!result.success) {
        return { ok: false, error: "Value must be true, false, or null" };
      }
      return { ok: true, value: result.data };
    }
  }
}
