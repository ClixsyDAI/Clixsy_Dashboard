// =============================================================
// PipelineStepper — layout + connector line + progress fill
// =============================================================
//
// Phase 3 PR B per phase-3-plan.md §5.2.
//
// Lays out 6 PipelineStep children in a row with even spacing,
// and draws the two-track connector line behind them (full
// border-strong base + green progress fill).
//
// Geometry recap (from `Resources/onboarding-tab-mockup.html`
// .pipeline / .pipeline-line / .pipeline-fill):
//   - Outer container: display: flex; justify-content: space-between;
//     margin: 12px 28px 6px; (the 28px side margins keep the first
//     and last circles from crowding the card edge.)
//   - 6 steps at positions 0%, 20%, 40%, 60%, 80%, 100% of the
//     content row (each is 42px wide; line-of-centers spans the
//     full content row).
//   - Connector line absolutely positioned at top: 21px (the
//     vertical center of the 42px circles), with left: 21px and
//     right: 21px so the line starts and ends at step-1's and
//     step-6's centers.
//   - Green fill is a separate absolutely-positioned element
//     overlaying the line. Its width is a percentage of the line:
//
//       fillPct = (currentStepIndex - 1) / 5 * 100
//
//     For example: in_progress → current is step 3 → fill is 40%
//     of the line; access_pending → current is step 5 → fill is
//     80%; kickoff_ready → step 6 is current per derive-state →
//     fill is 100%; created → step 1 is technically "done" and
//     no step is current, so fill is 0%.

import type { PipelineStepState } from "../../lib/onboarding/derive-state";
import PipelineStep from "./PipelineStep";

interface PipelineStepperProps {
  steps: PipelineStepState[];
}

export default function PipelineStepper({ steps }: PipelineStepperProps) {
  const fillPct = computeFillPercent(steps);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        position: "relative",
        padding: 0,
        margin: "12px 28px 6px",
      }}
    >
      {/* Base line — full border-strong color, behind the fill */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 21,
          left: 21,
          right: 21,
          height: 2,
          background: "var(--border-strong)",
          zIndex: 0,
        }}
      />
      {/* Green progress fill — overlays the base line */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 21,
          left: 21,
          // Line width is "100% - 42px" (the two halves of the
          // outermost circles), and the fill is a percentage of
          // THAT — see geometry recap above.
          width: `calc((100% - 42px) * ${fillPct / 100})`,
          height: 2,
          background: "var(--green)",
          zIndex: 0,
        }}
      />
      {steps.map((step) => (
        <PipelineStep key={step.index} step={step} />
      ))}
    </div>
  );
}

/**
 * Compute the green fill's percentage of the connector line.
 *
 * Rule (per mockup geometry):
 *   - If a step is `current`, fill reaches that step's center.
 *     Position formula: (currentStepIndex - 1) / 5 * 100.
 *   - If no step is `current` (the `created` effective state only),
 *     fill is 0%.
 *
 * Bounded to [0, 100] just in case derive-state ever produces an
 * unexpected combination.
 */
function computeFillPercent(steps: PipelineStepState[]): number {
  const current = steps.find((s) => s.state === "current");
  if (!current) return 0;
  const raw = ((current.index - 1) / 5) * 100;
  if (raw < 0) return 0;
  if (raw > 100) return 100;
  return raw;
}
