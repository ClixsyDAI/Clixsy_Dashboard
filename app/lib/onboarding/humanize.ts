// =============================================================
// Humanize — wire value → display representation
// =============================================================
//
// Phase 4 PR A per phase-4-plan.md §5.2.
//
// Translates the JSONB answer values into one of six render
// kinds. The accordion's <FieldRow> dispatches on the result's
// `kind` to produce the correct visual: plain text, chip list
// for arrays, amber missing pill, gold web URL, or text-2-color
// mailto/tel link.
//
// The dispatch order is type-first, value-fallback:
//   1. field.type === 'email'  → email link
//   2. field.type === 'tel'    → tel link
//   3. field.type === 'url'    → url link
//   4. otherwise dispatch on the value:
//        empty/null/undefined → missing pill ("Not provided")
//        well-known strings   → missing pill (not_sure / later /
//                              need_help / dont_know)
//        array                → chip list
//        scalar               → text (with dictionary lookup or
//                              snake_case → "Snake case" fallback)
//
// The dictionary below is partial by design — spec Appendix B
// covers a starter set, and the rest of the wire values use the
// default snake_case-to-Title-Case fallback. Add entries when a
// brand name or unusual phrasing surfaces that the fallback gets
// wrong (e.g. `godaddy` → "Godaddy" rather than "GoDaddy").

import type { FieldType } from "./field-config";

// =============================================================
// Result types
// =============================================================

export type MissingReason =
  | "not_provided" // empty / null / undefined
  | "not_sure"
  | "later"
  | "need_help"
  | "dont_know";

export type HumanizeResult =
  | { kind: "text"; display: string }
  | { kind: "chip_list"; chips: string[] }
  | { kind: "missing_pill"; display: string; reason: MissingReason }
  | { kind: "url"; display: string; href: string }
  | { kind: "email"; display: string; href: string }
  | { kind: "tel"; display: string; href: string };

// =============================================================
// Wire-value dictionary
// =============================================================
//
// Spec Appendix B + observed wire values. Each entry maps a
// snake_case wire value to its display form. Brand names get
// explicit entries (the snake_case fallback would produce
// "Godaddy" not "GoDaddy" etc.).

const DICTIONARY: Record<string, string> = {
  // Goals & Strategy
  more_leads: "More leads",
  more_calls: "More calls",
  better_leads: "Better quality leads",
  brand_awareness: "Brand awareness",
  website_traffic: "Website traffic",
  rankings: "Rankings",
  revenue: "Revenue",
  lead_quality: "Lead quality",
  stay_competitive: "Stay competitive",
  all: "All of the above",
  phone_calls: "Phone calls",
  form_submissions: "Form submissions",
  signed_clients: "Signed clients",
  reviews: "Reviews",

  // Technical Setup — yes/no/not-sure and platforms
  yes: "Yes",
  no: "No",
  not_sure: "Not sure",
  another_agency: "Another agency",
  in_house: "In-house",
  internal: "Internal team",
  freelancer: "Freelancer",
  no_one: "No one",
  unmanaged: "No one (unmanaged)",
  wordpress: "WordPress",
  webflow: "Webflow",
  squarespace: "Squarespace",
  wix: "Wix",
  shopify: "Shopify",
  custom: "Custom build",
  godaddy: "GoDaddy",
  namecheap: "Namecheap",
  cloudflare: "Cloudflare",
  google: "Google Domains",
  google_domains: "Google Domains",
  network_solutions: "Network Solutions",
  callrail: "CallRail",
  callfire: "CallFire",
  ctm: "CTM",
  marchex: "Marchex",
  none: "None",
  external: "External IT company",

  // Form-submission destinations
  email: "Email",
  crm: "CRM",
  salesforce: "Salesforce",
  hubspot: "HubSpot",
  zoho: "Zoho",
  pipedrive: "Pipedrive",
  clio: "Clio",
  lawmatics: "Lawmatics",
  mycase: "MyCase",
  litify: "Litify",
  filevine: "Filevine",

  // Access checklist
  done: "Done — access granted",
  need_help: "Needs help",
  later: "Will do later",
  not_applicable: "Not applicable",
  dont_know: "Client doesn't know",

  // Service area
  local: "Local",
  regional: "Regional",
  statewide: "Statewide",
  national: "National",
  international: "International",

  // Content approval
  approve_each: "Approves each piece",
  weekly_batch: "Approves weekly batch",
  yes_all: "Approves all content",
  major_only: "Major pieces only",
  trust: "Trusts us to publish",

  // Comm preferences
  phone: "Phone",
  text: "Text",
  slack: "Slack",
  slack_teams: "Slack / Teams",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  wait: "Wait until transition complete",

  // Languages
  english: "English",
  spanish: "Spanish",
  chinese: "Chinese",
  vietnamese: "Vietnamese",
  korean: "Korean",
  tagalog: "Tagalog",
  other: "Other",

  // Brand-guide presence
  some: "Some guidelines",

  // Title/Role options
  owner: "Owner / Managing Partner",
  partner: "Partner",
  marketing_director: "Marketing Director",
  office_manager: "Office Manager",
};

// Wire values that should always render as missing pills rather
// than as plain text. Keep in sync with MissingReason.
const MISSING_LIKE: Record<string, MissingReason> = {
  not_sure: "not_sure",
  later: "later",
  need_help: "need_help",
  dont_know: "dont_know",
};

const MISSING_DISPLAY: Record<MissingReason, string> = {
  not_provided: "Not provided",
  not_sure: "Not sure",
  later: "Will do later",
  need_help: "Needs help",
  dont_know: "Client doesn't know",
};

// =============================================================
// Public API
// =============================================================

export function humanize(
  value: unknown,
  field?: { type?: FieldType },
): HumanizeResult {
  // 1. Type-first dispatch — email / tel / url get link kinds
  //    when the value is a non-empty string.
  if (field?.type === "email" && typeof value === "string" && value.trim()) {
    const v = value.trim();
    return { kind: "email", display: v, href: `mailto:${v}` };
  }
  if (field?.type === "tel" && typeof value === "string" && value.trim()) {
    const v = value.trim();
    return { kind: "tel", display: v, href: `tel:${v}` };
  }
  if (field?.type === "url" && typeof value === "string" && value.trim()) {
    const v = value.trim();
    return { kind: "url", display: v, href: v };
  }

  // 2. Empty / null / undefined → missing pill "Not provided".
  if (value === null || value === undefined || value === "") {
    return {
      kind: "missing_pill",
      display: MISSING_DISPLAY.not_provided,
      reason: "not_provided",
    };
  }

  // 3. Missing-like sentinel strings → missing pill.
  if (typeof value === "string" && value in MISSING_LIKE) {
    const reason = MISSING_LIKE[value];
    return {
      kind: "missing_pill",
      display: MISSING_DISPLAY[reason],
      reason,
    };
  }

  // 4. Boolean → "Yes" / "No" (a few checkbox fields write true/false).
  if (typeof value === "boolean") {
    return { kind: "text", display: value ? "Yes" : "No" };
  }

  // 5. Number → string-coerce. Rare on this form but defensive.
  if (typeof value === "number") {
    return { kind: "text", display: String(value) };
  }

  // 6. Array → chip list. Empty array → missing pill.
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        kind: "missing_pill",
        display: MISSING_DISPLAY.not_provided,
        reason: "not_provided",
      };
    }
    const chips = value
      .map((v) => humanizeScalar(v))
      .filter((s): s is string => s.length > 0);
    if (chips.length === 0) {
      return {
        kind: "missing_pill",
        display: MISSING_DISPLAY.not_provided,
        reason: "not_provided",
      };
    }
    return { kind: "chip_list", chips };
  }

  // 7. String → dictionary lookup, then snake_case fallback.
  if (typeof value === "string") {
    return { kind: "text", display: humanizeScalar(value) };
  }

  // 8. Unknown shape (object, etc.) — JSON-stringify so the
  //    operator at least sees something rather than a blank
  //    field. This shouldn't happen for any field in the current
  //    form schema; if it does, the field-config gained a
  //    nested shape and humanize.ts needs to learn about it.
  return { kind: "text", display: JSON.stringify(value) };
}

// =============================================================
// Internals
// =============================================================

/**
 * Look up a single wire value in the dictionary, falling back
 * to snake_case → Title Case if absent. Returns the empty
 * string for falsy / non-string inputs so chip-list filtering
 * can drop them.
 */
function humanizeScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string") return String(v);
  const trimmed = v.trim();
  if (!trimmed) return "";
  const hit = DICTIONARY[trimmed];
  if (hit) return hit;
  // Fallback: snake_case → "Snake case" (replace underscores
  // with spaces, capitalize first letter of the result).
  if (/^[a-z][a-z0-9_]*$/.test(trimmed)) {
    const spaced = trimmed.replace(/_/g, " ");
    return spaced[0].toUpperCase() + spaced.slice(1);
  }
  // Otherwise pass through (already-humanized text, free-form
  // user input, etc.).
  return trimmed;
}
