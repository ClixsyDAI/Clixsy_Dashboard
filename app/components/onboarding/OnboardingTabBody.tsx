// =============================================================
// OnboardingTabBody — top-level layout for the Onboarding tab
// =============================================================
//
// Phase 2 PR B per phase-2-plan.md §6.
//
// Server component. Composes the Phase 2 UI blocks (ReminderStrip
// at the top, then ActionBar below). Receives the already-fetched
// joined payload from the page so there's no redundant HTTP
// round-trip to the API route.
//
// Wraps everything in a `.onboarding-tab` element that scopes the
// design-token variables defined in `app/styles/onboarding-tab.css`.
// Phase 3 (pipeline stepper) and Phase 4 (accordion) will be added
// inside this same wrapper, picking up the same tokens.
//
// The `/api/onboarding/by-workbook-id/[id]` route remains live —
// PR A's extraction made the underlying data path callable from
// both the page and the route, but the page itself no longer
// HTTP-round-trips for its own render.

import type { OnboardingByWorkbookIdPayload } from "../../lib/onboarding/types";
import ReminderStrip from "./ReminderStrip";
import ActionBar from "./ActionBar";

// The CSS file is imported once here so the design tokens are
// scoped to the Onboarding tab subtree. The wrapper `<div
// className="onboarding-tab">` below establishes the scope.
import "../../styles/onboarding-tab.css";

interface OnboardingTabBodyProps {
  payload: OnboardingByWorkbookIdPayload;
}

export default function OnboardingTabBody({ payload }: OnboardingTabBodyProps) {
  const { client, session, answers, latest_reminder } = payload;

  return (
    <div
      className="onboarding-tab"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        // Spec §4: max-width 1240px centered with 32px horizontal
        // padding. The workbook's existing client page already
        // centers at 1400px, so we let the parent container handle
        // the outer width and just provide the inner spacing.
      }}
    >
      <ReminderStrip latestReminder={latest_reminder} />
      <ActionBar client={client} session={session} answers={answers} />
      {/* Phase 3 — pipeline stage card lands here */}
      {/* Phase 4 — client information accordion lands below pipeline */}
    </div>
  );
}
