"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AuthCallbackBannerInner() {
  const searchParams = useSearchParams();
  const authSuccess = searchParams.get("auth_success");
  const authError = searchParams.get("auth_error");
  const storedInVercel = searchParams.get("stored_in_vercel");
  const accessToken = searchParams.get("access_token");
  const refreshToken = searchParams.get("refresh_token");

  if (!authSuccess && !authError) return null;

  return (
    <div
      className="mb-4 rounded-sm px-4 py-3 text-sm"
      style={{
        backgroundColor: authSuccess
          ? "rgba(45, 106, 79, 0.15)"
          : "rgba(200, 50, 50, 0.15)",
        color: authSuccess ? "#2d6a4f" : "#cc4444",
      }}
    >
      {authSuccess ? (
        <div>
          <p className="font-semibold">Basecamp connected successfully!</p>
          {storedInVercel === "true" ? (
            <p className="mt-1 text-xs opacity-80">
              Tokens saved to Vercel environment variables. A redeploy is
              required for them to take effect.
            </p>
          ) : (
            <div className="mt-2">
              <p className="text-xs opacity-80">
                Could not auto-save tokens to Vercel. Please set these
                environment variables manually in your Vercel project settings:
              </p>
              {accessToken && (
                <div className="mt-2">
                  <code
                    className="block overflow-x-auto rounded px-2 py-1 text-xs"
                    style={{ backgroundColor: "rgba(0,0,0,0.2)" }}
                  >
                    BASECAMP_ACCESS_TOKEN={accessToken}
                  </code>
                </div>
              )}
              {refreshToken && (
                <div className="mt-1">
                  <code
                    className="block overflow-x-auto rounded px-2 py-1 text-xs"
                    style={{ backgroundColor: "rgba(0,0,0,0.2)" }}
                  >
                    BASECAMP_REFRESH_TOKEN={refreshToken}
                  </code>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p>
          <span className="font-semibold">Basecamp connection failed:</span>{" "}
          {authError}
        </p>
      )}
    </div>
  );
}

export default function AuthCallbackBanner() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackBannerInner />
    </Suspense>
  );
}
