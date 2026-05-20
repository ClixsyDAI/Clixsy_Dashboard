// =============================================================
// Field configuration — 12 sections × N fields each
// =============================================================
//
// Hand-copied from
// `JLcilliers/client-onboarding-tool/src/lib/onboarding/steps-v2.ts`
// at commit `a706174510ebbb46fe412785f6e2e28a05c592fe` (PR #12 merge,
// 2026-05-20). Re-sync this file when that source changes.
//
// What's captured:
//   - Field `name` (wire identifier, drives JSONB key lookup)
//   - Field `label` (human-readable question; renders on the left
//     column of the accordion body)
//   - Field `type` (drives the FieldRow's render-kind dispatch via
//     the humanize() helper in humanize.ts)
//   - Field `helpText` when meaningfully different from `label`
//
// What's NOT captured (irrelevant to the read-only workbook UI):
//   - `options[]` per select/radio/multiselect — the workbook
//     displays the wire value humanized via the dictionary in
//     humanize.ts, not the select-time options
//   - `dependsOn` — the workbook renders whatever the answers JSONB
//     has; conditional show/hide is the onboarding form's concern,
//     not the workbook's
//   - `placeholder`, `required`, `previewMode` etc. — form-time only
//
// Section display names override the onboarding step's `title` for
// two of the twelve sections — see the spec §4.4 table mapped through
// `SECTION_DISPLAY_NAMES` in project-sections.ts.
//
// **Drift footgun** (see `operations-notes.md` entry 3): if the
// onboarding form changes a field's `name` or adds/removes a field,
// this file goes stale silently. The SHA-pinned source comment
// above is the manual-resync anchor.

import type { StepKey } from "./step-keys";

export type FieldType =
  | "text"
  | "url"
  | "tel"
  | "email"
  | "long_text"      // maps to onboarding's `textarea`
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox";      // section 12's confirm_accuracy / confirm_proceed

export interface FieldConfig {
  name: string;
  label: string;
  type?: FieldType;
  helpText?: string;
}

export type SectionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type SectionIconKey =
  | "user"
  | "users"
  | "building"
  | "target"
  | "palette"
  | "monitor"
  | "search"
  | "scale"
  | "key"
  | "refresh"
  | "flag"
  | "check";

export interface SectionConfig {
  number: SectionNumber;
  stepKey: StepKey;
  /** Display name for the accordion header — may differ from the
   * onboarding form's step `title`. Section 11 uses "Almost There!"
   * matching spec §4.4 / mockup; section 12 uses "Ready to Submit". */
  name: string;
  iconKey: SectionIconKey;
  fields: FieldConfig[];
}

// =============================================================
// The 12 sections, ordered by number
// =============================================================

export const SECTION_CONFIGS: readonly SectionConfig[] = [
  // ─────────────────────────────────────────────────────────────
  // 1. Primary Contact (steps-v2.ts:25-57)
  // ─────────────────────────────────────────────────────────────
  {
    number: 1,
    stepKey: "primary_contact",
    name: "Primary Contact",
    iconKey: "user",
    fields: [
      { name: "main_contact_name", label: "Full Name", type: "text" },
      { name: "main_contact_title", label: "Title/Role", type: "select" },
      { name: "main_contact_email", label: "Email Address", type: "email" },
      { name: "main_contact_phone", label: "Best Contact Number", type: "tel" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 2. Other Contacts (steps-v2.ts:62-152)
  // ─────────────────────────────────────────────────────────────
  {
    number: 2,
    stepKey: "other_contacts",
    name: "Other Contacts",
    iconKey: "users",
    fields: [
      { name: "has_secondary_contact", label: "Do you have a secondary contact for day-to-day matters?", type: "radio" },
      { name: "secondary_contact_name", label: "Secondary Contact - Full Name", type: "text" },
      { name: "secondary_contact_email", label: "Secondary Contact - Email", type: "text" },
      { name: "secondary_contact_phone", label: "Secondary Contact - Phone", type: "text" },
      { name: "has_tech_contact", label: "Do you have a dedicated technical/IT contact?", type: "radio" },
      { name: "tech_contact_name", label: "Technical Contact - Full Name", type: "text" },
      { name: "tech_contact_email", label: "Technical Contact - Email", type: "email" },
      { name: "wants_welcome_gift", label: "Would you like to receive a welcome gift?", type: "radio" },
      { name: "gift_recipient_name", label: "Recipient Name", type: "text" },
      { name: "gift_shipping_address", label: "Shipping Address", type: "long_text" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 3. Business Overview (steps-v2.ts:159-187)
  // ─────────────────────────────────────────────────────────────
  {
    number: 3,
    stepKey: "business_overview",
    name: "Business Overview",
    iconKey: "building",
    fields: [
      { name: "business_name", label: "Business Name", type: "text" },
      { name: "website_url", label: "Main Website URL", type: "url" },
      { name: "business_phone", label: "Main Business Phone", type: "tel" },
      { name: "physical_address", label: "Physical Company Address", type: "long_text" },
      { name: "languages", label: "Languages spoken at your firm", type: "multiselect" },
      { name: "owner_names", label: "Owner/Main Partner(s) Names", type: "long_text" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 4. Goals & Strategy (steps-v2.ts:193-241)
  // ─────────────────────────────────────────────────────────────
  {
    number: 4,
    stepKey: "goals_strategy",
    name: "Goals & Strategy",
    iconKey: "target",
    fields: [
      { name: "primary_goal", label: "What is your #1 goal for working with us?", type: "radio" },
      { name: "success_definition", label: "What would make this a success in 12 months?", type: "long_text" },
      { name: "current_challenges", label: "What is your biggest marketing challenge right now?", type: "long_text" },
      { name: "important_metrics", label: "Which metrics matter most to you?", type: "multiselect" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 5. Brand & Design (steps-v2.ts:247-305)
  // ─────────────────────────────────────────────────────────────
  {
    number: 5,
    stepKey: "brand_design",
    name: "Brand & Design",
    iconKey: "palette",
    fields: [
      { name: "has_brand_guide", label: "Do you have a brand style guide?", type: "radio" },
      { name: "knows_brand_colors", label: "Do you know your brand color hex codes?", type: "radio" },
      { name: "primary_color", label: "Primary Brand Color (Hex)", type: "text" },
      { name: "secondary_color", label: "Secondary Brand Color (Hex)", type: "text" },
      { name: "typography_fonts", label: "What fonts does your brand use?", type: "text" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 6. Technical Setup (steps-v2.ts:310-464)
  // ─────────────────────────────────────────────────────────────
  {
    number: 6,
    stepKey: "technical_setup",
    name: "Technical Setup",
    iconKey: "monitor",
    fields: [
      { name: "owns_domain", label: "Do you own your domain?", type: "radio" },
      { name: "domain_registrar", label: "Where is your domain registered?", type: "select" },
      { name: "controls_dns", label: "Do you have access to DNS settings?", type: "radio" },
      { name: "website_platform", label: "What platform is your website built on?", type: "radio" },
      { name: "website_managed_by", label: "Who currently manages your website?", type: "radio" },
      { name: "website_owner_name", label: "Agency / Freelancer name", type: "text" },
      { name: "website_owner_contact_name", label: "Contact name", type: "text" },
      { name: "website_owner_contact_email", label: "Contact email address", type: "email" },
      { name: "uses_call_tracking", label: "Do you use call tracking?", type: "radio" },
      { name: "call_tracking_provider", label: "Which call tracking provider?", type: "select" },
      {
        name: "form_submission_methods",
        label: "Where should form submissions go?",
        type: "multiselect",
        helpText: "Select all that apply — many firms route to both an inbox and a CRM.",
      },
      { name: "form_submission_email", label: "Specify address", type: "email" },
      { name: "form_submission_crm", label: "Which CRM?", type: "select" },
      { name: "form_submission_other", label: "Describe the other destination", type: "text" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 7. SEO & Targeting (steps-v2.ts:470-619)
  // ─────────────────────────────────────────────────────────────
  // Vertical-gated fields (primary_case_types_* for law_firm,
  // service_* for home_services) all coexist in this config —
  // the workbook renders whichever the answers JSONB carries.
  {
    number: 7,
    stepKey: "seo_targeting",
    name: "SEO & Targeting",
    iconKey: "search",
    fields: [
      { name: "service_area_type", label: "How would you describe your service area?", type: "radio" },
      { name: "main_geographical_areas", label: "What cities or areas do you want to target?", type: "long_text" },
      { name: "primary_case_types_keywords", label: "What are your primary case types or services?", type: "multiselect" },
      { name: "primary_case_types_other", label: "Tell us about your other case types", type: "text" },
      { name: "case_priority", label: "Which case type should we focus on first?", type: "radio" },
      { name: "service_trades", label: "Which trades do you offer?", type: "multiselect" },
      { name: "service_categories", label: "Which specific services do you offer?", type: "multiselect" },
      { name: "service_priority", label: "Which service should we focus on first?", type: "radio" },
      { name: "service_other", label: "Other service not listed?", type: "text" },
      { name: "cases_to_avoid", label: "Any case types you want to avoid?", type: "long_text" },
      { name: "has_gbp", label: "Do you have a Google Business Profile?", type: "radio" },
      { name: "gbp_listing_url", label: "Google Business Profile URL", type: "url" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 8. Legal, Content & Communication (steps-v2.ts:625-701)
  // ─────────────────────────────────────────────────────────────
  {
    number: 8,
    stepKey: "legal_content_comms",
    name: "Legal, Content & Communication",
    iconKey: "scale",
    fields: [
      { name: "has_advertising_restrictions", label: "Are there special advertising rules for your industry?", type: "radio" },
      { name: "advertising_regulations", label: "What restrictions apply?", type: "long_text" },
      { name: "legal_disclaimers", label: "Any required legal disclaimers for your marketing?", type: "long_text" },
      { name: "content_approval_required", label: "Do you want to approve content before it goes live?", type: "radio" },
      { name: "words_phrases_to_avoid", label: "Any words or phrases we should avoid?", type: "long_text" },
      { name: "topics_to_avoid", label: "Any topics we should avoid?", type: "long_text" },
      { name: "preferred_communication", label: "What is your preferred communication method?", type: "radio" },
      { name: "call_frequency_preference", label: "How often would you like to meet?", type: "radio" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 9. Access Checklist (steps-v2.ts:708-814)
  // ─────────────────────────────────────────────────────────────
  // Renders as plain Q/A rows in the accordion. The structured
  // 7-tile grid with red/blue/amber/green colors lives in the
  // (later phase) Technical Access modal — that's spec §6.4,
  // NOT this accordion section. Per phase-4-plan.md §9 risk #6.
  {
    number: 9,
    stepKey: "access_checklist",
    name: "Access Checklist",
    iconKey: "key",
    fields: [
      { name: "has_google_analytics", label: "Do you have Google Analytics set up?", type: "radio" },
      { name: "ga_access_status", label: "Google Analytics access status", type: "select" },
      { name: "gsc_access_status", label: "Google Search Console access status", type: "select" },
      { name: "gbp_access_status", label: "Google Business Profile access status", type: "select" },
      { name: "wordpress_access_status", label: "WordPress access status", type: "select" },
      { name: "domain_access_status", label: "Domain registrar access status", type: "select" },
      { name: "dns_access_status", label: "DNS access status", type: "select" },
      { name: "has_youtube", label: "Do you have a YouTube channel?", type: "radio" },
      { name: "youtube_access_status", label: "YouTube access status", type: "select" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 10. Transition & Wrap-up (steps-v2.ts:822-871)
  // ─────────────────────────────────────────────────────────────
  {
    number: 10,
    stepKey: "transition_wrapup",
    name: "Transition & Wrap-up",
    iconKey: "refresh",
    fields: [
      { name: "has_previous_agency", label: "Are you currently working with another marketing agency?", type: "radio" },
      { name: "previous_agency_name", label: "Agency name", type: "text" },
      { name: "previous_agency_contact_person", label: "Contact person name", type: "text" },
      { name: "previous_agency_contact_email", label: "Email address", type: "email" },
      { name: "can_remove_agency_access", label: "Would you like us to help remove their access?", type: "radio" },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 11. Almost There! (steps-v2.ts:876-884)
  // ─────────────────────────────────────────────────────────────
  // Informational only — the onboarding form's `review` step is
  // a "let's confirm what you entered" screen with zero input
  // fields. The accordion section is empty of field-rows and
  // suppresses its missing-pill via `isInformational: true` in
  // project-sections.ts.
  {
    number: 11,
    stepKey: "review",
    name: "Almost There!",
    iconKey: "flag",
    fields: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 12. Ready to Submit (steps-v2.ts:889-913)
  // ─────────────────────────────────────────────────────────────
  // Plan-tighten from hand-copy: phase-4-plan.md §5.3 listed both
  // sections 11 AND 12 as "informational". Section 12 is NOT —
  // it has 3 real fields (confirm_accuracy, confirm_proceed,
  // additional_notes). Section 12 renders field-rows and shows
  // missing pills like a normal section. `isInformational: false`
  // in project-sections.ts.
  {
    number: 12,
    stepKey: "submit",
    name: "Ready to Submit",
    iconKey: "check",
    fields: [
      { name: "confirm_accuracy", label: "I confirm that the information provided is accurate to the best of my knowledge.", type: "checkbox" },
      { name: "confirm_proceed", label: "I authorize Clixsy to proceed with setting up my accounts and marketing services.", type: "checkbox" },
      { name: "additional_notes", label: "Anything else you'd like us to know?", type: "long_text" },
    ],
  },
] as const;
