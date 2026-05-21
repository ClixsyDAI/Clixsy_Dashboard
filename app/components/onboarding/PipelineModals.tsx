"use client";

// =============================================================
// PipelineModals — manager for the 4 pipeline-circle modals
// =============================================================
//
// Phase 5 PR B per phase-5-plan.md §6.2 (with RSC deviation —
// see below).
//
// Owns the `currentModal` state for which of the four
// pipeline-circle modals is open and renders both the
// PipelineStageCard (with the click handler wired) and all
// four modal content components conditionally on which kind
// is open.
//
// Deviation from plan §6.2 — composition over render-prop.
// The plan specified a render-prop API
// (`children: (openModal) => React.ReactNode`) so the
// caller controlled the PipelineStageCard render and only
// the click callback flowed in. That doesn't work across
// the React Server Components boundary: function children
// can't be passed from a server component (OnboardingTabBody)
// to a client component (PipelineModals). Inlining a
// closure that references state inside PipelineModals would
// trip the "Functions cannot be passed to Client Components"
// build error.
//
// Composition keeps the manager-of-state pattern intact —
// PipelineModals still owns useState, the four modals still
// render based on that state — but the wiring to
// PipelineStageCard is done internally here rather than at
// the call site. Phase 6's action-bar buttons (Send Reminder,
// Request Missing Access, Regenerate PIN) will get their own
// manager component using the same composition pattern.

import { useCallback, useState } from "react";
import type { AccessChecklistView } from "../../lib/onboarding/access-checklist";
import type { PipelineState } from "../../lib/onboarding/derive-state";
import type { ProjectedSection } from "../../lib/onboarding/project-sections";
import type {
  OnboardingSessionRow,
  OpenEventSummary,
} from "../../lib/onboarding/types";
import FormCompleteModal from "./FormCompleteModal";
import OpenHistoryModal from "./OpenHistoryModal";
import PipelineStageCard from "./PipelineStageCard";
import SectionsCompletedModal from "./SectionsCompletedModal";
import TechnicalAccessModal from "./TechnicalAccessModal";

export type PipelineModalKind =
  | "open_history"
  | "sections_completed"
  | "form_complete"
  | "technical_access";

/**
 * Maps a clickable pipeline-step index to the modal kind it
 * opens. Steps 1 and 6 are intentionally absent — they stay
 * inert (no click affordance, no tooltip).
 */
const STEP_TO_MODAL: Partial<Record<number, PipelineModalKind>> = {
  2: "open_history",
  3: "sections_completed",
  4: "form_complete",
  5: "technical_access",
};

interface PipelineModalsProps {
  pipelineState: PipelineState;
  session: OnboardingSessionRow;
  sections: ProjectedSection[];
  openEvents: OpenEventSummary[];
  openEventsCount: number;
  accessChecklist: AccessChecklistView;
}

export default function PipelineModals({
  pipelineState,
  session,
  sections,
  openEvents,
  openEventsCount,
  accessChecklist,
}: PipelineModalsProps) {
  const [currentModal, setCurrentModal] = useState<PipelineModalKind | null>(
    null,
  );

  const closeModal = useCallback(() => {
    setCurrentModal(null);
  }, []);

  const handleStepClick = useCallback((stepIndex: number) => {
    const kind = STEP_TO_MODAL[stepIndex];
    if (kind) setCurrentModal(kind);
  }, []);

  return (
    <>
      <PipelineStageCard
        pipelineState={pipelineState}
        onStepClick={handleStepClick}
      />

      <OpenHistoryModal
        isOpen={currentModal === "open_history"}
        onClose={closeModal}
        events={openEvents}
        totalCount={openEventsCount}
      />
      <SectionsCompletedModal
        isOpen={currentModal === "sections_completed"}
        onClose={closeModal}
        sections={sections}
      />
      <FormCompleteModal
        isOpen={currentModal === "form_complete"}
        onClose={closeModal}
        session={session}
      />
      <TechnicalAccessModal
        isOpen={currentModal === "technical_access"}
        onClose={closeModal}
        accessChecklist={accessChecklist}
      />
    </>
  );
}
