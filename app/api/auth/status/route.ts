import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../lib/supabase-server";

// Use Node.js runtime; the Supabase server client imports
// `import "server-only"` which is Node-only.
export const runtime = "nodejs";
// Don't cache — the env-var + probe check should reflect the
// current deploy state, not a stale value.
export const dynamic = "force-dynamic";

/**
 * Probe Supabase with a cheap query so the `supabase` boolean reflects
 * **validity** of the credentials, not just **presence** of the env var.
 *
 * Phase 1 of the Onboarding tab integration shipped a presence-only
 * check (`!!process.env.SUPABASE_SERVICE_ROLE_KEY`). That check returned
 * `true` for a corrupted SR key and the failure mode only surfaced
 * downstream when the by-workbook-id route returned 500 "Invalid API
 * key" against production. Phase 2 (per phase-2-plan.md §3.3) wires
 * the validity check at the source.
 *
 * The probe is bounded by a 1-second timeout. The workbook runs in
 * iad1 and the Supabase project is in eu-west-1, so a healthy query
 * round-trips in 150-300ms typical; 1s catches network pathologies
 * without blocking the response indefinitely. On timeout we return
 * `false` — if Supabase is that slow, the rest of the integration
 * is failing anyway.
 */
async function checkSupabase(): Promise<boolean> {
  // Fast path: env var missing or empty -> false without a round-trip.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return false;

  try {
    const supabase = getSupabaseServerClient();
    const probe = supabase
      .from("clients")
      .select("id")
      .limit(1)
      .maybeSingle();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("supabase probe timeout")), 1_000),
    );
    const result = (await Promise.race([probe, timeout])) as {
      error: unknown;
    };
    return !result.error;
  } catch {
    // Timeout or unexpected throw -> false. We deliberately don't
    // log the body of the error here; the route is health-check-shaped
    // and doesn't need to expose Supabase error details to the caller.
    return false;
  }
}

export async function GET() {
  const hasAccessToken = !!process.env.BASECAMP_ACCESS_TOKEN;
  const hasRefreshToken = !!process.env.BASECAMP_REFRESH_TOKEN;
  const hasGithubToken = !!process.env.GITHUB_TOKEN;
  const hasVercelToken = !!process.env.VERCEL_API_TOKEN;
  // Phase 2: validity check, not just env-var presence. Returns true
  // only if a trivial Supabase query against `public.clients` succeeds
  // within the 1-second timeout. See checkSupabase() above for the
  // rationale.
  const supabase = await checkSupabase();

  return NextResponse.json({
    connected: hasAccessToken && hasRefreshToken,
    hasGithubToken,
    hasVercelToken,
    canSync: hasAccessToken && hasRefreshToken && hasGithubToken,
    supabase,
  });
}
