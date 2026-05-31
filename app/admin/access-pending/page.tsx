"use client";

// =============================================================
// /admin/access-pending
// =============================================================
//
// Phase 1 PR B. The destination when a Google OAuth sign-in
// reaches the callback with a verified clixsy.com email but
// either (a) that email isn't in app_users yet, or (b) the row
// has disabled_at set.
//
// In case (a), the callback inserts an app_access_requests row
// before redirecting here, and a super-admin can review it in
// the Users tab (Phase 1 PR D).
//
// In case (b), the row already existed but is soft-disabled; no
// new request is inserted (super-admins can re-enable from the
// existing row).
//
// The page is intentionally minimal — no fetches, no auth
// recheck, no sessionStorage. The callback decided this was the
// right destination; this page just communicates that.

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function AccessPendingContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const reason = searchParams.get("reason");
  const isDisabled = reason === "disabled";

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#f9fafb",
      padding: "1rem",
    }}>
      <div style={{
        backgroundColor: "white",
        borderRadius: "0.75rem",
        boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
        padding: "2rem",
        maxWidth: "32rem",
        width: "100%",
      }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "1rem" }}>
          {isDisabled ? "Access revoked" : "Access request pending"}
        </h1>
        {isDisabled ? (
          <p style={{ color: "#374151", marginBottom: "1rem" }}>
            The account <strong>{email ?? "you signed in with"}</strong> previously had access to the workbook but has been disabled. Contact a super-admin if you believe this is in error.
          </p>
        ) : (
          <>
            <p style={{ color: "#374151", marginBottom: "0.75rem" }}>
              Thanks for signing in. Your clixsy.com account <strong>{email ?? ""}</strong> isn&apos;t on the workbook&apos;s access list yet.
            </p>
            <p style={{ color: "#374151", marginBottom: "1rem" }}>
              A super-admin has been notified and will review your request. You&apos;ll be able to sign in once it&apos;s approved.
            </p>
          </>
        )}
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <Link
            href="/admin"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#f3f4f6",
              color: "#111827",
              textDecoration: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
            }}
          >
            Back to sign-in
          </Link>
          <Link
            href="/"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#111827",
              color: "white",
              textDecoration: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
            }}
          >
            Go to dashboard home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AccessPendingPage() {
  return (
    <Suspense fallback={null}>
      <AccessPendingContent />
    </Suspense>
  );
}
