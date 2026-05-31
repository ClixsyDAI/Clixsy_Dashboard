// =============================================================
// Supabase browser client (anon key, client-side only)
// =============================================================
//
// Phase 1 PR B introduces the first browser-side Supabase usage
// in the workbook. The use case is narrow: kicking off the
// Google OAuth handshake from the LoginScreen + SignInPrompt
// "Sign in with Google" buttons via supabase.auth.signInWithOAuth.
//
// We use @supabase/ssr's createBrowserClient (not the bare
// @supabase/supabase-js createClient) so that the auth session
// cookies set during the OAuth callback are readable by the
// matching server-side helper in supabase-ssr.ts. The two halves
// share a cookie protocol that @supabase/ssr defines.
//
// Anon key only. Service role NEVER reaches the client bundle —
// that key lives strictly in supabase-server.ts.
//
// Counterpart server helper: app/lib/supabase-ssr.ts.

import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getSupabaseBrowserClient() {
  if (!SUPABASE_URL) {
    throw new Error(
      "Supabase browser client: NEXT_PUBLIC_SUPABASE_URL is not set.",
    );
  }
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase browser client: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.",
    );
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
