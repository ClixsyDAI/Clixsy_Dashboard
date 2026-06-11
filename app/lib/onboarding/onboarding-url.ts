// =============================================================
// onboarding-url — public-form URL construction
// =============================================================
//
// Phase 8 proper PR B: extracted from get-primary-contact when the
// session token was redacted from the by-workbook-id payload.
// Multiple consumers now need to build the URL after fetching the
// token from /api/onboarding/sessions/[id]/token:
//
//   1. ActionBarLinkRow — Copy + View on-click handlers
//   2. SendFormReminderModal — email-preview render after modal-open fetch
//
// Single constant + builder keeps the URL shape consistent. If
// the onboarding-tool ever moves to a different domain or the
// path prefix changes, this is the only place to update.

/** Public-form base URL. Phase 2 originally inlined this in two
 * components; phase 6.5 deduped into get-primary-contact; phase 8
 * proper hoists again now that get-primary-contact no longer
 * builds the URL.
 *
 * 2026-06-11: custom domain welcome.clixsy.com went live. Default now
 * points there; override via the ONBOARDING_BASE_URL env var so a
 * future domain change is a Vercel setting + redeploy, not a code edit
 * (this had calcified into three hardcoded copies). It matters beyond
 * cosmetics: the dashboard's cross-repo calls (regenerate-pin, am-link,
 * GHL→create) send an Authorization: Bearer header, and fetch STRIPS
 * that header across a cross-origin redirect — so the moment
 * vercel.app is set to redirect to welcome.clixsy.com, any call still
 * aimed at vercel.app 401s. Pointing at the canonical domain avoids it. */
export const ONBOARDING_BASE_URL =
  process.env.ONBOARDING_BASE_URL ?? "https://welcome.clixsy.com";

/** Build the public-form resume URL from a session token. The
 * token must come from the dedicated /api/onboarding/sessions/[id]
 * /token endpoint (which audits each access) — NEVER from the
 * by-workbook-id payload (which redacts the token in Phase 8). */
export function buildOnboardingUrl(token: string): string {
  return `${ONBOARDING_BASE_URL}/onboarding/${token}`;
}
