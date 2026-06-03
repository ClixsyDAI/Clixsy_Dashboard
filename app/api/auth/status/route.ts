import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/app/lib/basecamp";
import { storeBasecampTokens } from "@/app/lib/vercel-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusBody =
  | { connected: true; refreshed: boolean; newTokensWrittenToVercel?: boolean; note?: string }
  | { connected: false; reason: string; needsReauth: boolean; httpStatusFromBasecamp?: number };

export async function GET() {
  const accessToken = process.env.BASECAMP_ACCESS_TOKEN;
  const refreshToken = process.env.BASECAMP_REFRESH_TOKEN;

  if (!accessToken || !refreshToken) {
    return NextResponse.json<StatusBody>({
      connected: false,
      reason: accessToken ? "missing_refresh_token" : "missing_access_token",
      needsReauth: true,
    });
  }

  try {
    // getValidAccessToken does: probe /projects.json with current token; on 401, call refreshAccessToken.
    const result = await getValidAccessToken();
    // result: { accessToken, refreshed: boolean, newTokens?: BasecampTokens }

    if (result.refreshed && result.newTokens) {
      // Write the new tokens back to Vercel env vars so the next cold start picks them up.
      // Note: this does NOT affect the CURRENT running function — only future deploys.
      let writeOk = false;
      try {
        if (process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID) {
          await storeBasecampTokens(result.newTokens.access_token, result.newTokens.refresh_token);
          writeOk = true;
        }
      } catch (e) {
        console.warn("[auth/status] storeBasecampTokens failed:", e);
      }
      return NextResponse.json<StatusBody>({
        connected: true,
        refreshed: true,
        newTokensWrittenToVercel: writeOk,
        note: writeOk
          ? "Stored refreshed tokens to Vercel. A redeploy is needed for them to propagate."
          : "Refreshed in-memory but could not write to Vercel (missing VERCEL_API_TOKEN or VERCEL_PROJECT_ID).",
      });
    }
    return NextResponse.json<StatusBody>({
      connected: true,
      refreshed: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // refreshAccessToken throws when the refresh token itself is bad / revoked.
    // Heuristic: any error here means the OAuth flow needs the human to re-authorize.
    const needsReauth =
      msg.includes("401") ||
      msg.toLowerCase().includes("refresh") ||
      msg.toLowerCase().includes("invalid_grant");
    return NextResponse.json<StatusBody>({
      connected: false,
      reason: msg,
      needsReauth,
    });
  }
}
