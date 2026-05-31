// =============================================================
// OAuth email guards — pure helpers, server + test importable
// =============================================================
//
// Phase 1 PR B. The two defence-in-depth checks the OAuth
// callback runs against the Supabase user before deciding
// anything else:
//
//   - isClixsyEmail: layer-3 hostname guard. The PRIMARY
//     clixsy.com enforcement layer because the consent screen is
//     External (see docs/phase1-oauth-setup.md). Trusts only the
//     email field's domain; ignores any other id_token claim.
//
//   - isEmailVerified: layer-2 verification guard. Reads the
//     verification flag from either user_metadata or one of the
//     identities entries (Google's id_token can land in either
//     shape depending on Supabase's normalisation).
//
// Pure functions — no Supabase imports, no Next.js imports, no
// env-var reads — so the colocated .test.ts can exercise them
// without pulling the rest of the callback's dependency tree
// into the Node test runner.

export type SupabaseUserShape = {
  email?: string | null;
  user_metadata?: { email_verified?: unknown } | null;
  identities?: Array<{ identity_data?: { email_verified?: unknown } | null } | null> | null;
};

export function isClixsyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith("@clixsy.com");
}

export function isEmailVerified(user: SupabaseUserShape | null | undefined): boolean {
  if (!user) return false;
  if (user.user_metadata?.email_verified === true) return true;
  const ids = user.identities ?? [];
  for (const id of ids) {
    if (id?.identity_data?.email_verified === true) return true;
  }
  return false;
}
