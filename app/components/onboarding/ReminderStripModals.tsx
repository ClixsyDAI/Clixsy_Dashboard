"use client";

// =============================================================
// ReminderStripModals — composition manager for the strip's modals
// =============================================================
//
// Phase 6.5 PR B step B4 per phase-6.5-plan.md §6.6.
//
// Same composition pattern as Phase 5's PipelineModals and
// Phase 6's ActionBarModals. Owns `currentModal` state, composes
// <ReminderStrip> + <ReminderHistoryModal> together. Passes an
// onViewHistory callback to the strip so the inert link from
// Phase 2 becomes a real trigger.
//
// One modal kind today ("history"), but typed as a union so
// future strip-related modals (per-reminder drilldown, etc.)
// don't need a refactor.
//
// No contactEmail prop per phase-6.5-plan.md Option B — the
// history modal doesn't render contact data anywhere, so there's
// no consumer at this layer. If a future per-reminder drilldown
// needs contact data, the prop comes back as a one-line change.

import { useCallback, useState } from "react";
import type {
  OnboardingReminderSummary,
  ReminderHistoryRow,
} from "../../lib/onboarding/types";
import ReminderHistoryModal from "./ReminderHistoryModal";
import ReminderStrip from "./ReminderStrip";

export type ReminderStripModalKind = "history";

interface ReminderStripModalsProps {
  latestReminder: OnboardingReminderSummary | null;
  reminders: ReminderHistoryRow[];
  remindersCount: number;
}

export default function ReminderStripModals({
  latestReminder,
  reminders,
  remindersCount,
}: ReminderStripModalsProps) {
  const [currentModal, setCurrentModal] =
    useState<ReminderStripModalKind | null>(null);

  const openHistory = useCallback(() => {
    setCurrentModal("history");
  }, []);

  const closeModal = useCallback(() => {
    setCurrentModal(null);
  }, []);

  return (
    <>
      <ReminderStrip
        latestReminder={latestReminder}
        onViewHistory={openHistory}
      />

      <ReminderHistoryModal
        isOpen={currentModal === "history"}
        onClose={closeModal}
        reminders={reminders}
        totalCount={remindersCount}
      />
    </>
  );
}
