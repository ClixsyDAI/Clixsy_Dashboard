import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/app/lib/basecamp";
import { storeBasecampTokens } from "@/app/lib/vercel-env";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set("auth_error", error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code) {
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set("auth_error", "No authorization code received");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Try to store tokens as Vercel env vars (requires VERCEL_API_TOKEN)
    let storedInVercel = false;
    if (process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID) {
      try {
        await storeBasecampTokens(tokens.access_token, tokens.refresh_token);
        storedInVercel = true;
      } catch (e) {
        console.error("Failed to store tokens in Vercel env vars:", e);
      }
    }

    // Redirect to home with success
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set("auth_success", "true");
    redirectUrl.searchParams.set("stored_in_vercel", String(storedInVercel));

    // If we couldn't store in Vercel, pass tokens as query params
    // so the user can manually set them. These are short-lived in the URL.
    if (!storedInVercel) {
      redirectUrl.searchParams.set("access_token", tokens.access_token);
      redirectUrl.searchParams.set("refresh_token", tokens.refresh_token);
    }

    return NextResponse.redirect(redirectUrl);
  } catch (e) {
    console.error("OAuth callback error:", e);
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set(
      "auth_error",
      e instanceof Error ? e.message : "Unknown error during token exchange"
    );
    return NextResponse.redirect(redirectUrl);
  }
}
