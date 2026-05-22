"use client";

// =============================================================
// ActionBarModals — composition manager for the 3 action-bar modals
// =============================================================
//
// Phase 6 PR B step B5 per phase-6-plan.md §6.5.
//
// Owns the currentModal state for which of the three action-bar
// modals is open and composes ActionBar + the three modals
// together. Same shape as Phase 5's PipelineModals (composition
// over render-prop, per RSC function-children constraint).
//
// The three modals' send actions write rows to Supabase via the
// PR A routes. On a successful Send Reminder / Send Request,
// the manager calls router.refresh() so the reminder strip's
// "Last reminder sent" line updates without a full page reload.
// Regenerate PIN doesn't refresh the page — its update is
// surfaced through the modal's own PIN-display state.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccessChecklistView } from "../../lib/onboarding/access-checklist";
import { getPrimaryContact } from "../../lib/onboarding/get-primary-contact";
import type {
  ClientRow,
  OnboardingAnswerRow,
  RedactedOnboardingSession,
} from "../../lib/onboarding/types";
import ActionBar from "./ActionBar";
import RegeneratePinModal from "./RegeneratePinModal";
import RequestMissingAccessModal from "./RequestMissingAccessModal";
import SendFormReminderModal from "./SendFormReminderModal";

export type ActionBarModalKind =
  | "send_reminder"
  | "request_access"
  | "regenerate_pin";

interface ActionBarModalsProps {
  client: ClientRow;
  session: RedactedOnboardingSession;
  answers: OnboardingAnswerRow[];
  accessChecklist: AccessChecklistView;
}

export default function ActionBarModals({
  client,
  session,
  answers,
  accessChecklist,
}: ActionBarModalsProps) {
  const router = useRouter();
  const [currentModal, setCurrentModal] =
    useState<ActionBarModalKind | null>(null);

  // Contact for the modals. Phase 6.5 PR B B6: comes from the
  // shared getPrimaryContact() helper so ActionBar + this
  // composer + the email-templates consumers all derive the same
  // shape from the same source.
  const contact = getPrimaryContact(answers, client);

  const openModal = useCallback((kind: ActionBarModalKind) => {
    setCurrentModal(kind);
  }, []);

  const closeModal = useCallback(() => {
    setCurrentModal(null);
  }, []);

  const handleReminderSent = useCallback(() => {
    // Refresh the page route so the reminder strip's
    // "Last reminder sent" line picks up the new row.
    router.refresh();
    setCurrentModal(null);
  }, [router]);

  return (
    <>
      <ActionBar
        client={client}
        session={session}
        answers={answers}
        onAction={openModal}
      />

      <SendFormReminderModal
        isOpen={currentModal === "send_reminder"}
        onClose={closeModal}
        onSent={handleReminderSent}
        sessionId={session.id}
        contact={contact}
      />
      <RequestMissingAccessModal
        isOpen={currentModal === "request_access"}
        onClose={closeModal}
        onSent={handleReminderSent}
        sessionId={session.id}
        contact={{
          first_name: contact.first_name,
          email: contact.email,
        }}
        accessChecklist={accessChecklist}
      />
      <RegeneratePinModal
        isOpen={currentModal === "regenerate_pin"}
        onClose={closeModal}
        sessionId={session.id}
        contact={{ email: contact.email }}
      />
    </>
  );
}

