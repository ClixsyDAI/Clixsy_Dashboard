import { NextResponse } from "next/server";

export async function GET() {
  const hasAccessToken = !!process.env.BASECAMP_ACCESS_TOKEN;
  const hasRefreshToken = !!process.env.BASECAMP_REFRESH_TOKEN;
  const hasGithubToken = !!process.env.GITHUB_TOKEN;
  const hasVercelToken = !!process.env.VERCEL_API_TOKEN;
  // Added in Phase 1 of the Onboarding tab integration (2026-05).
  // Reports whether the workbook is wired to the shared Supabase
  // project. Checked post-merge on the production deploy to
  // confirm env-var rollout took.
  const supabase = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return NextResponse.json({
    connected: hasAccessToken && hasRefreshToken,
    hasGithubToken,
    hasVercelToken,
    canSync: hasAccessToken && hasRefreshToken && hasGithubToken,
    supabase,
  });
}
