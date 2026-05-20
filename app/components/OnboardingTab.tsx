"use client";

// =============================================================
// OnboardingTab — Phase 1 placeholder
// =============================================================
//
// Renders the joined onboarding payload (`client + session +
// answers`) for the current workbook id as raw JSON. No styling
// beyond the existing dark theme. This is a deliberate Phase 1
// shape: it proves the end-to-end fetch works, and lets the
// operator eyeball the actual returned data before Phase 2 starts
// building the real UI (action bar, pipeline stepper, accordion).
//
// Future phases will replace this with the structured UI from
// `Resources/onboarding-tab-spec.md`. The fetch path
// (/api/onboarding/by-workbook-id/[id]) and the underlying types
// stay the same — only the renderer changes.

import { useEffect, useState } from "react";

interface OnboardingTabProps {
  /** Basecamp project id (integer, from app/data/projects.json). */
  workbookId: number;
}

type FetchState =
  | { status: "loading" }
  | { status: "ok"; payload: unknown }
  | { status: "not_found" }
  | { status: "error"; message: string };

export default function OnboardingTab({ workbookId }: OnboardingTabProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function run() {
      try {
        const res = await fetch(
          `/api/onboarding/by-workbook-id/${workbookId}`,
          { signal: ctrl.signal },
        );
        if (cancelled) return;
        if (res.status === 404) {
          setState({ status: "not_found" });
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          setState({
            status: "error",
            message: `${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
          });
          return;
        }
        const payload: unknown = await res.json();
        if (cancelled) return;
        setState({ status: "ok", payload });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Unknown fetch error",
        });
      }
    }
    run();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [workbookId]);

  if (state.status === "loading") {
    return (
      <p className="py-12 text-center text-sm" style={{ color: "#666" }}>
        Loading onboarding data…
      </p>
    );
  }

  if (state.status === "not_found") {
    // The tab should normally not be visible if there's no session
    // for this workbook id — the parent page gates rendering. This
    // branch covers the race where a session is deleted between
    // page render and tab open.
    return (
      <p className="py-12 text-center text-sm" style={{ color: "#888" }}>
        No onboarding session found for this client.
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="py-8 text-sm" style={{ color: "#e25d5d" }}>
        <p className="mb-2 font-semibold">
          Couldn&apos;t load onboarding data for this client.
        </p>
        <p style={{ color: "#888" }}>{state.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "#888" }}>
        Phase 1 placeholder. This is the raw payload returned by{" "}
        <code style={{ color: "#c8a882" }}>
          GET /api/onboarding/by-workbook-id/{workbookId}
        </code>
        . Phase 2 will replace this with the spec UI.
      </p>
      <pre
        className="overflow-x-auto rounded-sm p-4 text-xs leading-relaxed"
        style={{
          backgroundColor: "#111111",
          color: "#f0ede8",
          border: "1px solid #1a1a1a",
        }}
      >
        {JSON.stringify(state.payload, null, 2)}
      </pre>
    </div>
  );
}
