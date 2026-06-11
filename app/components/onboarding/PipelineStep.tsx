"use client";

// =============================================================
// PipelineStep — one circle + label + sub-label in the stepper
// =============================================================
//
// Phase 3 PR B per phase-3-plan.md §5.3.
// Phase 5 PR B per phase-5-plan.md §6.8 — adds optional onClick
// so clickable circles (steps 2-5) open their modals via the
// PipelineModals manager. The inert title="Modal opens in a
// later phase" tooltip is gone when onClick is wired.
//
// When step.clickable && onClick: renders as a proper <button>
// with focus ring + aria-label for keyboard users. When non-
// clickable (steps 1, 6) or onClick absent: renders as a div
// with cursor: default and no tooltip.

import type { PipelineStepState } from "../../lib/onboarding/derive-state";
import { Check, Eye, Key, ListChecks } from "./icons";

interface PipelineStepProps {
  step: PipelineStepState;
  /** Phase 5 PR B: wired by PipelineModals via PipelineStepper.
   * Only fires when step.clickable is true (steps 2-5). */
  onClick?: () => void;
}

export default function PipelineStep({ step, onClick }: PipelineStepProps) {
  // The four "step has special icon when current/done" rules drive
  // the dot visual. Pending uses a uniform dashed-grey treatment.
  const dotVisual = step.state === "pending" ? "pending" : visualForIndex(step.index, step.state);
  const isInteractive = step.clickable && !!onClick;

  // Inner contents are identical between the button and div
  // branches — extracted to keep the visual logic single-source.
  const inner = (
    <>
      <StepDot visual={dotVisual} step={step} />
      <StepLabel index={step.index} state={step.state} />
      <StepSubLabel step={step} />
    </>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Open ${STEP_LABELS[step.index]} details`}
        style={{
          // Reset button chrome so the visual matches the div
          // branch (and the Phase 3 mockup).
          all: "unset",
          boxSizing: "border-box",
          position: "relative",
          zIndex: 1,
          width: 42,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          cursor: "pointer",
          borderRadius: 4,
        }}
        onFocus={(e) => {
          // Focus ring on the wrapper — gold outline keyboard
          // users can see. The inner StepDot already has its own
          // visual; this just makes the parent's focus state
          // visible.
          e.currentTarget.style.outline = "2px solid var(--gold)";
          e.currentTarget.style.outlineOffset = "4px";
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = "none";
          e.currentTarget.style.outlineOffset = "0";
        }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        width: 42,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        cursor: "default",
      }}
    >
      {inner}
    </div>
  );
}

// =============================================================
// Visual dispatch
// =============================================================
//
// Returns a tag for the dot's CSS treatment. Each tag maps to a
// concrete style block in <StepDot>. Centralised here so the
// switch is easy to audit against the spec table.

type DotVisual =
  | "done-green-check"    // Step 1 done; Step 4 done; Step 5 done
  | "done-opened-eye"     // Step 2 done (with optional count badge)
  | "done-listcheck"      // Step 3 done OR current (with optional fraction badge)
  | "current-gold-key"    // Step 5 current
  | "pending";            // Any step pending; Step 6 always (no kickoff_at column)

function visualForIndex(
  index: PipelineStepState["index"],
  state: PipelineStepState["state"],
): DotVisual {
  switch (index) {
    case 1:
      return "done-green-check";
    case 2:
      return "done-opened-eye"; // step 2 is never `current` per derive-state
    case 3:
      return "done-listcheck"; // both done and current use the same visual
    case 4:
      return "done-green-check";
    case 5:
      return state === "current" ? "current-gold-key" : "done-green-check";
    case 6:
      // Per phase-3-plan.md §8 risk #3: step 6 has no `kickoff_at`
      // column to drive a `done` visual. Spec §4.3 also literally
      // describes step 6's "current" appearance as the same dashed
      // grey circle as pending — so we never show a distinct
      // current treatment for step 6. State only affects the label
      // color (handled in StepLabel).
      return "pending";
  }
}

// =============================================================
// Dot
// =============================================================

interface StepDotProps {
  visual: DotVisual;
  step: PipelineStepState;
}

function StepDot({ visual, step }: StepDotProps) {
  // Common dot wrapper. Specific visuals override background,
  // border, and icon color via inline style.
  const dotBase: React.CSSProperties = {
    width: 42,
    height: 42,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  };

  switch (visual) {
    case "done-green-check":
      return (
        <div
          style={{
            ...dotBase,
            background: "var(--green)",
            color: "#0a0a0a",
          }}
        >
          <Check stroke="currentColor" size={18} />
        </div>
      );

    case "done-opened-eye": {
      // Gold-bordered surface-2 background with eye icon and
      // optional count badge. Per mockup `.step.opened .step-dot`.
      const showBadge = (step.metaCount ?? 0) > 0;
      return (
        <div
          style={{
            ...dotBase,
            background: "var(--surface-2)",
            border: "1.5px solid var(--gold)",
            color: "var(--gold)",
          }}
        >
          <Eye stroke="currentColor" size={18} />
          {showBadge && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -6,
                background: "var(--gold)",
                color: "#2a1f10",
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 10,
                fontWeight: 700,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
              }}
            >
              {step.metaCount}&times;
            </span>
          )}
        </div>
      );
    }

    case "done-listcheck": {
      // Green dot + ListChecks icon. Fraction badge only when
      // `current` (the metaFraction field is populated only in
      // current state per derive-state.ts).
      const fraction = step.metaFraction;
      return (
        <div
          style={{
            ...dotBase,
            background: "var(--green)",
            color: "#0a0a0a",
          }}
        >
          <ListChecks stroke="currentColor" size={18} />
          {fraction && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -6,
                background: "var(--gold)",
                color: "#2a1f10",
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 10,
                fontWeight: 700,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
              }}
            >
              {fraction.numerator}/{fraction.denominator}
            </span>
          )}
        </div>
      );
    }

    case "current-gold-key":
      return (
        <div
          style={{
            ...dotBase,
            background: "var(--gold)",
            color: "#2a1f10",
            boxShadow: "0 0 0 6px rgba(201,169,120,0.18)",
          }}
        >
          <Key stroke="currentColor" size={18} />
        </div>
      );

    case "pending":
      return (
        <div
          style={{
            ...dotBase,
            background: "var(--surface-3)",
            border: "1.5px dashed #3a3a3a",
          }}
        />
      );
  }
}

// =============================================================
// Label + sub-label
// =============================================================

function StepLabel({
  index,
  state,
}: {
  index: PipelineStepState["index"];
  state: PipelineStepState["state"];
}) {
  // Label text by index (matches spec §4.3 step table).
  const label = STEP_LABELS[index];
  // Per mockup: pending label is dimmer, current label is gold.
  // Done label uses the secondary text color.
  const color =
    state === "current"
      ? "var(--gold)"
      : state === "pending"
        ? "var(--text-4)"
        : "var(--text-2)";
  return (
    <div
      style={{
        fontSize: 12,
        color,
        fontWeight: 500,
        marginTop: 10,
        whiteSpace: "nowrap",
        textAlign: "center",
      }}
    >
      {label}
    </div>
  );
}

const STEP_LABELS: Record<PipelineStepState["index"], string> = {
  1: "Form created",
  2: "Opened",
  3: "In progress",
  4: "Complete",
  5: "Access pending",
  6: "Kickoff ready",
};

function StepSubLabel({ step }: { step: PipelineStepState }) {
  const text = computeSubLabel(step);
  if (!text) return null;
  // Per mockup: pending uses --text-4, current uses --gold,
  // done uses --text-4 (the sub-label color doesn't lighten when
  // done — only the label color does).
  const color = step.state === "current" ? "var(--gold)" : "var(--text-4)";
  return (
    <div
      style={{
        fontSize: 10.5,
        color,
        marginTop: 3,
        whiteSpace: "nowrap",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function computeSubLabel(step: PipelineStepState): string | null {
  switch (step.index) {
    case 1:
      return step.subLabelTimestamp ? formatStepDate(step.subLabelTimestamp) : null;
    case 2: {
      const count = step.metaCount ?? 0;
      if (step.state === "pending") return null;
      // Phase 3: count is 0 for legacy sessions (pre PR #12
      // open-events emission). Show a different copy in that case
      // rather than "0 visits · view log" which reads awkwardly.
      if (count === 0) return "No visits logged yet";
      // Open-summary feature (2026-06-11): surface the LAST real-client
      // open next to the count — engagement at a glance, no modal click
      // needed. AM-bypass opens are excluded at the source (never
      // written to onboarding_open_events), so both numbers are genuine
      // client activity. The full visit list stays one click away.
      const visits = `${count} visit${count === 1 ? "" : "s"}`;
      return step.subLabelTimestamp
        ? `${visits} · last ${formatStepDate(step.subLabelTimestamp)}`
        : `${visits} · view log`;
    }
    case 3:
      return step.subLabelTimestamp ? formatStepDate(step.subLabelTimestamp) : null;
    case 4:
      // Step 4 is `done` once submitted; `pending` otherwise.
      // The sub-label only renders when submittedAt exists.
      return step.subLabelTimestamp ? formatStepDate(step.subLabelTimestamp) : null;
    case 5: {
      const access = step.metaAccess;
      if (!access) return null;
      return `${access.received} of ${access.total} received`;
    }
    case 6:
      // No kickoff_at column. Sub-label is just a static word
      // reflecting the effective state. See phase-3-plan.md §8
      // risk #3.
      return step.state === "current" ? "Ready" : "Pending";
  }
}

/**
 * Format an ISO timestamp like the mockup's `May 14, 10:22 PM`.
 * Built from two DateTimeFormat instances so the literal comma
 * + space separator matches the mockup precisely.
 */
function formatStepDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}
