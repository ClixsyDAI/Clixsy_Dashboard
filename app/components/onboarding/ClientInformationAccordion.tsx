"use client";

// =============================================================
// ClientInformationAccordion — state + map over 12 sections
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.2.
//
// Top-level client component for the accordion block. Owns the
// open/closed state for the 12 sections and the Expand all /
// Collapse all handlers. Renders <ClientInformationHeader> +
// 12 <SectionRow>s.
//
// State shape: a Set<string> of open section step-keys. Set
// makes lookup, toggle, expand-all, collapse-all O(1) /
// straightforward. Initial state is empty (all sections start
// collapsed per spec §4.4).

import { useCallback, useState } from "react";
import type { ProjectedSection } from "../../lib/onboarding/project-sections";
import ClientInformationHeader from "./ClientInformationHeader";
import SectionRow from "./SectionRow";

interface ClientInformationAccordionProps {
  sections: ProjectedSection[];
  /** Phase 7 PR B: threaded down to each SectionRow → SectionBody
   * → FieldRow → EditableFieldValue for the field-edit POST. */
  sessionId: string;
}

export default function ClientInformationAccordion({
  sections,
  sessionId,
}: ClientInformationAccordionProps) {
  const [openSteps, setOpenSteps] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((stepKey: string) => {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepKey)) next.delete(stepKey);
      else next.add(stepKey);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setOpenSteps(new Set(sections.map((s) => s.stepKey)));
  }, [sections]);

  const collapseAll = useCallback(() => {
    setOpenSteps(new Set());
  }, []);

  return (
    <div>
      <ClientInformationHeader
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />
      <div>
        {sections.map((section) => (
          <SectionRow
            key={section.stepKey}
            section={section}
            isOpen={openSteps.has(section.stepKey)}
            onToggle={() => toggle(section.stepKey)}
            sessionId={sessionId}
          />
        ))}
      </div>
    </div>
  );
}
