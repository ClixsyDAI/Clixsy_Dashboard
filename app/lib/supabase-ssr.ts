import "server-only";
// =============================================================
// Supabase SSR client (cookie-aware, server-side only)
// =============================================================
//
// Phase 1 PR B. The Google OAuth callback at
// /admin/auth/callback needs a Supabase client that can:
//   1. Read the PKCE code-verifier cookie that the browser side
//      set when the OAuth flow started.
//   2. Exchange the `?code` query param for a Supabase session
//      via supabase.auth.exchangeCodeForSession(code).
//   3. Set the resulting Supabase session cookies on the
//      response, so subsequent server-side reads in this app
//      can call supabase.auth.getUser() to retrieve the verified
//      email from Google's id_token.
//
// @supabase/ssr's createServerClient wires all three of those
// up via a small cookies adapter we pass in. The adapter bridges
// Supabase's "read/write a list of cookies" API to Next.js 16's
// async cookies() API.
//
// Anon key only — service-role queries (e.g. looking up
// app_users) use supabase-server.ts instead.
//
// Counterpart browser helper: app/lib/supabase-browser.ts.

import { cookies as nextCookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

if (typeof window !== "undefined") {
  throw new Error(
    "supabase-ssr.ts was imported into a client bundle. " +
      "Use supabase-browser.ts in client components.",
  );
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function getSupabaseSSRClient() {
  if (!SUPABASE_URL) {
    throw new Error(
      "Supabase SSR client: NEXT_PUBLIC_SUPABASE_URL is not set.",
    );
  }
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase SSR client: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.",
    );
  }

  const cookieStore = await nextCookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map((c) => ({
          name: c.name,
          value: c.value,
        }));
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll throws when called from a Server Component (read-only
          // context). Route handlers can mutate cookies; Server
          // Components can't. The callback route is a Route Handler so
          // we never hit this path in PR B — left as a graceful no-op
          // for future Server-Component callers.
        }
      },
    },
  });
}
