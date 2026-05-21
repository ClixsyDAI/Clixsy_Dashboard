// =============================================================
// email-templates — pure renderers for the two reminder kinds
// =============================================================
//
// Phase 6 PR A step A5 per phase-6-plan.md §5.7.
//
// Single source of truth for the email subject + body that the
// Send Form Reminder modal (spec §6.5) and the Request Missing
// Access modal (spec §6.6) render in their preview AND that the
// /api/onboarding/reminders route persists to
// `onboarding_reminders.email_subject` + `.email_body`. The
// preview text and the stored body are guaranteed identical
// because both come from the same function call.
//
// Pure functions over plain data — no I/O, no Supabase, no env
// var reads. Easy to unit-test (no harness wired in this phase)
// and stable across redeploys.
//
// Phase 6 does NOT send any email. The templates render the
// text and store it; outbound delivery is deferred to Phase 9
// per spec §6.5 and §6.6.

import type { AccessAssetKey } from "./access-checklist";

// =============================================================
// Public types
// =============================================================

export interface ReminderContact {
  first_name: string;
  /** Resume URL for the onboarding form — ${ONBOARDING_BASE_URL}
   * /onboarding/${token}. Required for form-reminder CTA. */
  resume_url: string;
}

export interface AccessRequestContact {
  first_name: string;
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

// =============================================================
// renderFormReminderEmail (spec §6.5)
// =============================================================

/**
 * Form-reminder template. Subject + body verbatim from spec §6.5
 * with two placeholders filled: {first_name} from contact,
 * [Resume your form ->] as the inline CTA placeholder
 * (the modal preview pane swaps this for a styled link; the DB
 * row stores the literal bracket form).
 *
 * If first_name is empty, falls back to "there" so the greeting
 * doesn't read "Hi ,".
 */
export function renderFormReminderEmail(
  contact: ReminderContact,
): RenderedEmail {
  const name = contact.first_name.trim() || "there";
  const subject = "Picking up where you left off, your Clixsy onboarding";
  const body = [
    `Hi ${name},`,
    "",
    "Just a quick check-in on your Clixsy onboarding. We noticed you've started",
    "the form but haven't quite wrapped it up yet. When you have a few minutes,",
    "we'd love for you to finish the remaining sections so we can get rolling.",
    "",
    "[Resume your form ->]",
    "",
    "If you have any questions, just hit reply.",
    "",
    "Thanks,",
    "The Clixsy team",
  ].join("\n");
  return { subject, body };
}

// =============================================================
// renderAccessRequestEmail (spec §6.6)
// =============================================================

interface AssetDetail {
  /** Label shown in the bullet list, e.g. "Domain registrar". */
  bulletLabel: string;
  /** Rationale clause that follows the label, e.g. "so we can
   * verify ownership and update records when needed". */
  rationale: string;
  /** Label shown on the CTA link, e.g. "Grant Domain access". */
  ctaLabel: string;
}

// Per-asset copy. Spec §6.6 supplies rationales for Domain, DNS,
// and Google Analytics. Rationales for the other four assets
// (WordPress, GSC, GBP, YouTube) follow the same shape and tone
// and are placeholder defaults — when the spec's template editor
// lands (deferred), the operator can refine without touching code.
const ASSET_DETAIL: Record<AccessAssetKey, AssetDetail> = {
  wordpress: {
    bulletLabel: "WordPress admin",
    rationale: "so we can publish updates and tune on-site content",
    ctaLabel: "Grant WordPress access",
  },
  domain: {
    bulletLabel: "Domain registrar",
    rationale:
      "so we can verify ownership and update records when needed",
    ctaLabel: "Grant Domain access",
  },
  dns: {
    bulletLabel: "DNS settings",
    rationale: "for any record changes tied to verification and email",
    ctaLabel: "Grant DNS access",
  },
  gsc: {
    bulletLabel: "Search Console",
    rationale: "to monitor indexing, search performance, and coverage issues",
    ctaLabel: "Grant Search Console access",
  },
  ga: {
    bulletLabel: "Google Analytics",
    rationale:
      "for visibility into your existing traffic and goals",
    ctaLabel: "Grant Analytics access",
  },
  gbp: {
    bulletLabel: "Business Profile",
    rationale:
      "to manage map listings, hours, and customer-facing details",
    ctaLabel: "Grant Business Profile access",
  },
  youtube: {
    bulletLabel: "YouTube channel",
    rationale: "to publish and tune video content tied to your campaigns",
    ctaLabel: "Grant YouTube access",
  },
};

/**
 * Access-request template. Subject is fixed; body is dynamic —
 * the bullet list and the CTA row are built from the
 * `missingAssets` array (typically the union of `missing` +
 * `needs_help` from the access-checklist projection).
 *
 * If `missingAssets` is empty, the caller is responsible for not
 * sending — but this function still returns sensible text in case
 * a UI flow falls through. The Request Missing Access modal in
 * Phase 6 PR B (§6.6) renders an "Nothing to request" empty-state
 * paragraph instead of opening the send flow.
 */
export function renderAccessRequestEmail(
  contact: AccessRequestContact,
  missingAssets: AccessAssetKey[],
): RenderedEmail {
  const name = contact.first_name.trim() || "there";
  const subject = "Access needed to get your campaign rolling";

  const details = missingAssets.map((k) => ASSET_DETAIL[k]);
  const bullets = details.length
    ? details
        .map((d) => `  - ${d.bulletLabel}, ${d.rationale}`)
        .join("\n")
    : "  - (No outstanding items.)";
  const ctas = details.length
    ? details.map((d) => `[${d.ctaLabel}]`).join("  ")
    : "";

  const body = [
    `Hi ${name},`,
    "",
    "Thanks for finishing the onboarding form. Before we can kick things off,",
    "we still need access to a few of your accounts:",
    "",
    bullets,
    "",
    "Each one's quick to share. The links below walk you through it:",
    "",
    ctas,
    "",
    "Once those are in we'll move you straight to kickoff.",
    "",
    "Thanks,",
    "The Clixsy team",
  ].join("\n");

  return { subject, body };
}
