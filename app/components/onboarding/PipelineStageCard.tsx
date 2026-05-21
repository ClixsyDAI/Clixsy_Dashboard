// =============================================================
// PipelineStageCard — outer card shell + header + stepper
// =============================================================
//
// Phase 3 PR B per phase-3-plan.md §5.1.
//
// The third UI block in the Onboarding tab (below the reminder
// strip and action bar). Renders:
//   1. Card shell with the same surface/border/radius as the
//      action bar: --surface background, 1px --border, --radius-md.
//   2. Header row "Onboarding stage: {headerLabel}" — label in
//      uppercase --text-3, header label in --gold.
//   3. The 6-step stepper, delegated to <PipelineStepper>.
//
// All inputs come from the PR-A-computed PipelineState. No
// fetches, no derivations — pure rendering.

"use client";

import type {
  PipelineState,
  PipelineStepState,
} from "../../lib/onboarding/derive-state";
import PipelineStepper from "./PipelineStepper";

interface PipelineStageCardProps {
  pipelineState: PipelineState;
  /** Phase 5 PR B: forwarded to PipelineStepper. PipelineModals
   * passes the handler that maps step index → modal kind. */
  onStepClick?: (stepIndex: PipelineStepState["index"]) => void;
}

export default function PipelineStageCard({
  pipelineState,
  onStepClick,
}: PipelineStageCardProps) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        // Mockup uses 10px radius for the card (.card { border-radius: 10px }).
        // Our shared CSS module defines --radius-md as 8px (action-bar value),
        // so the pipeline card uses --radius-lg (10px) instead.
        borderRadius: "var(--radius-lg)",
        padding: "20px 22px",
      }}
    >
      {/* Header row — "Onboarding stage: {label}" */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "center",
          gap: 12,
          marginBottom: 28,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            color: "var(--text-3)",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          Onboarding stage:
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--gold)",
            fontWeight: 500,
          }}
        >
          {pipelineState.headerLabel}
        </div>
      </div>

      <PipelineStepper steps={pipelineState.steps} onStepClick={onStepClick} />
    </div>
  );
}
