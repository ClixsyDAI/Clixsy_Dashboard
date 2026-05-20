// =============================================================
// Onboarding tab — shared SVG icons
// =============================================================
//
// Phase 3 PR A, step A4 (per phase-3-plan.md §3.1).
//
// Consolidates the inline `<svg>` elements that were duplicated
// across Phase 2's components (ReminderStrip, ActionBar,
// ActionBarLinkRow). Each icon is a React component returning a
// single `<svg>` matching the Lucide / Feather visual language:
// 24×24 viewBox, 2px stroke, round caps and joins.
//
// Why inline SVG and not `lucide-react`: spec Appendix D
// anti-pattern #1 ("Webfont-loaded icons") and the spec's Phase 2
// guidance ("install lucide-react OR use the SVG sprite verbatim").
// Inline SVG matching the mockup's sprite is the lowest-risk
// choice — no new dependency, no CDN failure mode, paths come
// straight from `Resources/onboarding-tab-mockup.html`.
//
// All icons default to `stroke="currentColor"` so they inherit
// the parent's color via CSS. Callers that need a specific color
// (e.g. ReminderStrip's gold clock) pass an explicit `stroke`
// prop.
//
// Phase 2 components migrate to import from here in the same
// commit. Visual output is unchanged — the SVG paths and default
// attributes (width=14, height=14, stroke-width=2) match what
// was inlined before.

import type { SVGProps } from "react";

interface IconProps {
  /** Square dimension in pixels. Defaults to 14 (matches the
   * Phase 2 inline default). */
  size?: number;
  /** Stroke color. Defaults to `currentColor` (Lucide convention)
   * so the parent's color flows through. Pass a CSS variable
   * (e.g. `var(--gold)`) when a specific color is required. */
  stroke?: string;
  /** Optional className for parent-level Tailwind / CSS. */
  className?: string;
  /** Pass-through for any other SVG attribute (aria-hidden,
   * role, etc.). */
  rest?: Omit<SVGProps<SVGSVGElement>, "stroke" | "width" | "height" | "className">;
}

function baseProps({
  size = 14,
  stroke = "currentColor",
  className,
}: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": "true",
  };
}

// =============================================================
// Icons — paths verbatim from the mockup sprite
// =============================================================

/** Clock face with hour + minute hands. Used in the reminder strip. */
export function Clock(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

/** Bell. Used on the "Send form reminder" button. */
export function Bell(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/** Key. Used on the "Request missing access" button AND on the
 * pipeline stepper's Step 5 (Access pending) circle, with a
 * different fill treatment. */
export function Key(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

/** Copy / duplicate. Used on the "Copy link" button. */
export function Copy(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

/** External link / open in new tab. Used on the "View form" button. */
export function ExternalLink(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/** Refresh / counter-clockwise. Used on the "Regenerate PIN code" button. */
export function RefreshCcw(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// =============================================================
// New in Phase 3 — used by the pipeline stepper
// =============================================================

/** Check mark. Drawn on `done` step circles in the pipeline
 * stepper (steps 1, 3, 4 when complete). */
export function Check(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Eye. Drawn on the Step 2 (Opened) circle in the pipeline
 * stepper. */
export function Eye(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** List with checkmarks. Drawn on the Step 3 (In progress) circle
 * in the pipeline stepper. The mockup uses this (not the plain
 * Check) to differentiate the "you're working through a list"
 * meaning from steps 1 and 4's "this is a completed milestone"
 * meaning. */
export function ListChecks(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3 17l2 2 4-4" />
      <path d="M3 7l2 2 4-4" />
      <line x1="13" y1="6" x2="21" y2="6" />
      <line x1="13" y1="12" x2="21" y2="12" />
      <line x1="13" y1="18" x2="21" y2="18" />
    </svg>
  );
}
