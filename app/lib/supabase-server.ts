import "server-only";
// =============================================================
// Supabase service-role client (server-side only)
// =============================================================
//
// Phase 1 of the Onboarding tab integration. The workbook reads
// from the shared Supabase project lawwsutjxopiekjzupef (the same
// project that backs the onboarding tool). The service role key
// is consumed here and ONLY here; no client-component imports
// allowed.
//
// Belt-and-braces guarding:
//   1. `import "server-only"` (top of file) — Next.js build-time
//      check. Any client component that transitively imports this
//      file fails the build.
//   2. Runtime `typeof window !== "undefined"` throw — catches
//      exotic SSR streaming / edge cases where the build-time
//      check might miss something.
//
// If you need a browser-side Supabase client later (e.g. for
// realtime subscriptions wired into a client component), DO NOT
// reuse this module — create a separate `supabase-browser.ts`
// using the anon key.

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

// Belt-and-braces runtime guard. The `import "server-only"`
// above is the primary defence; this guards exotic edge cases.
if (typeof window !== "undefined") {
  throw new Error(
    "supabase-server.ts was imported into a client bundle. " +
      "This module holds the service-role key and must stay server-side.",
  );
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cached: SupabaseClient | null = null;

/**
 * Returns a cached service-role Supabase client. Throws if either
 * `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is
 * unset — callers should handle that as a "not configured" error
 * rather than letting a half-configured deploy ship.
 *
 * Note: the service role bypasses Row-Level Security. Every code
 * path that uses this client is implicitly trusted; do not surface
 * its results to untrusted callers without filtering. Phase 1's
 * `/api/onboarding/by-workbook-id/[id]` route is internal-only
 * (same posture as every other workbook route — see the workbook
 * audit §7) and respects this.
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (cached) return cached;
  if (!SUPABASE_URL) {
    throw new Error(
      "Supabase server client: NEXT_PUBLIC_SUPABASE_URL is not set.",
    );
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase server client: SUPABASE_SERVICE_ROLE_KEY is not set.",
    );
  }
  cached = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // Server-only client; never persist sessions / use cookies.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
