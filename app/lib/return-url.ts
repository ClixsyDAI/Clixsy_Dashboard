// =============================================================
// return-url — safe-redirect validation for sign-in flow
// =============================================================
//
// Phase 8 proper PR A per phase-8-proper-plan.md §3.2 + §4.2.
//
// Two consumers will need this validation:
//   - proxy.ts (the WRITER) — constructs `?return=<encoded path>`
//     on the unauthenticated redirect to /admin. Only appends the
//     param if validateReturnPath approves the original path.
//   - app/admin/page.tsx (the READER) — after a successful sign-in
//     OR mount-effect existing-session check, reads `?return=` from
//     the URL, validates it again (defence in depth: never trust
//     a client-side param), and router.replaces to the path.
//
// Identical logic on both sides. If they diverge an open-redirect
// bug ships, so the validation lives here once and is imported by
// both. Discriminated-union return matches admin-auth.ts style.
//
// Decisions locked before writing (phase-8-proper-plan.md §3.2):
//   - PREFIX-ONLY whitelist (not numeric-ID-only). Any path under
//     one of the gated prefixes is acceptable.
//   - PATH-ONLY validation; query string + fragment rejected.
//     The proxy strips ? and # from the original URL before
//     constructing the return param. If either reaches here,
//     upstream is buggy or the param was hand-crafted — fail
//     closed.
//   - Single-decode + post-decode % check kills double-encoded
//     payloads (//evil.com → %2F%2Fevil.com → %252F%252Fevil.com
//     are all rejected).

export type ReturnPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

const MAX_INPUT_LENGTH = 256;

// Prefixes the validator will accept after decoding + sanity-checks.
// This is the workbook's proxy.ts matcher list — only paths that the
// gate would itself protect are useful as return targets.
const ALLOWED_RETURN_PREFIXES: readonly string[] = [
  "/client/",
  "/api/onboarding/",
  "/api/task-summaries/",
  "/api/meeting-prep/",
  "/api/content/",
  "/api/chat/",
  "/api/ai-summary/",
  "/api/google/",
  "/api/team-assignments/",
];

function looksNonRelative(s: string): boolean {
  // Protocol-relative (`//evil.com`), Windows-style path (`\\evil`),
  // explicit schemes (`http:`, `javascript:`, `data:`), and the
  // catch-all `:` (which would indicate a scheme prefix we haven't
  // listed). Order matters — check the specific patterns before the
  // generic colon check so the rejection reason stays informative
  // for any future logging.
  return (
    s.startsWith("//") ||
    s.startsWith("\\\\") ||
    s.startsWith("http:") ||
    s.startsWith("https:") ||
    s.startsWith("javascript:") ||
    s.startsWith("data:") ||
    s.includes(":")
  );
}

/**
 * Validate a candidate return-URL path. Returns a discriminated union
 * — the ok branch carries the canonical safe path the caller may
 * navigate to, the !ok branch carries a server-loggable reason.
 *
 * NEVER throws. Every code path returns a ReturnPathResult.
 */
export function validateReturnPath(
  raw: string | null | undefined,
): ReturnPathResult {
  if (raw == null || raw === "") {
    return { ok: false, reason: "empty" };
  }
  if (raw.length > MAX_INPUT_LENGTH) {
    return { ok: false, reason: "too long" };
  }

  // Path-only: ? and # belong to query/fragment and have no business
  // in a return param per the locked decision.
  if (raw.includes("?") || raw.includes("#")) {
    return { ok: false, reason: "contains query" };
  }

  if (looksNonRelative(raw)) {
    return { ok: false, reason: "non-relative" };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false, reason: "malformed encoding" };
  }

  // After one decode, no further encoded chars should remain. Double-
  // encoded payloads (e.g. %252F → %2F) hit this branch.
  if (decoded.includes("%")) {
    return { ok: false, reason: "double-encoded" };
  }

  // The decode may have revealed a non-relative form that was masked
  // by encoding (`%2F%2Fevil.com` → `//evil.com`).
  if (decoded !== raw && looksNonRelative(decoded)) {
    return { ok: false, reason: "non-relative after decode" };
  }

  if (!decoded.startsWith("/")) {
    return { ok: false, reason: "not absolute" };
  }

  if (decoded.includes("..")) {
    return { ok: false, reason: "traversal" };
  }

  const matchesPrefix = ALLOWED_RETURN_PREFIXES.some((p) =>
    decoded.startsWith(p),
  );
  if (!matchesPrefix) {
    return { ok: false, reason: "not in allowed prefix list" };
  }

  return { ok: true, path: decoded };
}
