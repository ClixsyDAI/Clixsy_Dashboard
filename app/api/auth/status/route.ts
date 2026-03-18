import { NextResponse } from "next/server";

export async function GET() {
  const hasAccessToken = !!process.env.BASECAMP_ACCESS_TOKEN;
  const hasRefreshToken = !!process.env.BASECAMP_REFRESH_TOKEN;
  const hasGithubToken = !!process.env.GITHUB_TOKEN;
  const hasVercelToken = !!process.env.VERCEL_API_TOKEN;

  return NextResponse.json({
    connected: hasAccessToken && hasRefreshToken,
    hasGithubToken,
    hasVercelToken,
    canSync: hasAccessToken && hasRefreshToken && hasGithubToken,
  });
}
