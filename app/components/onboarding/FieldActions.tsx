"use client";

// =============================================================
// FieldActions — hover-revealed pencil + copy action group
// =============================================================
//
// Phase 7 PR B step B4 per phase-7-plan.md §6.3.
//
// Sits to the right of the value in FieldRow. Two icon buttons:
//
//   Edit pencil — opacity 0 by default, opacity 0.85 on row hover.
//                 Click fires onEdit() which the parent FieldRow
//                 maps to bumping EditableFieldValue's editTrigger.
//   Copy icon   — 70% opacity by default, 100% on row hover. Click
//                 copies the humanized display value to clipboard
//                 and shows a 1.4s "Copied" indicator.
//
// Hover-reveal happens via CSS — the parent FieldRow carries the
// `.field-row` class and the `.field-row:hover .field-actions__*`
// rules live in `app/styles/onboarding-tab.css`. This keeps the
// FieldActions component free of any "is the row hovered" state.
//
// Per spec §7 line 482 STOP-IF: the pencil's default state uses
// `transform: translateX(-4px)` so hovering doesn't shift the
// row's layout. CSS handles the transform on hover too.

import { useState } from "react";
import { Copy, Edit } from "./icons";

interface FieldActionsProps {
  /** Fired when the pencil is clicked. FieldRow translates this
   * into editTrigger++ on EditableFieldValue. */
  onEdit: () => void;
  /** Humanized text written to the clipboard on copy-button click.
   * `null` suppresses the copy button entirely (missing-pill
   * fields have no real value to copy). */
  copyValue: string | null;
  /** When true (editor is in editing/saving state), both actions
   * are suppressed so the AM isn't tempted to mash them mid-edit. */
  suppressed: boolean;
}

export default function FieldActions({
  onEdit,
  copyValue,
  suppressed,
}: FieldActionsProps) {
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const showCopied = copiedAt !== null && Date.now() - copiedAt < 1400;

  const handleCopy = async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopiedAt(Date.now());
      window.setTimeout(() => setCopiedAt(null), 1400);
    } catch (err) {
      // Don't spam the console with permission errors — surface as
      // a brief visual on the button. Phase 4's ActionBarLinkRow
      // uses the same pattern.
      console.warn("[FieldActions] copy failed:", err);
    }
  };

  if (suppressed) {
    return null;
  }

  return (
    <div
      className="field-actions"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        className="field-actions__edit"
        onClick={onEdit}
        aria-label="Edit field"
        style={{
          all: "unset",
          cursor: "pointer",
          color: "var(--text-3)",
          padding: 4,
          borderRadius: "var(--radius-sm)",
          lineHeight: 0,
          // CSS hover-reveal rules in onboarding-tab.css:
          //   .field-row .field-actions__edit { opacity: 0; transform: translateX(-4px); transition: ...; }
          //   .field-row:hover .field-actions__edit { opacity: 0.85; transform: translateX(0); }
        }}
      >
        <Edit size={14} stroke="currentColor" />
      </button>
      {copyValue !== null && (
        <button
          type="button"
          className="field-actions__copy"
          onClick={handleCopy}
          aria-label={showCopied ? "Copied" : "Copy value"}
          title={showCopied ? "Copied" : "Copy"}
          style={{
            all: "unset",
            cursor: "pointer",
            color: showCopied ? "var(--gold)" : "var(--text-3)",
            padding: 4,
            borderRadius: "var(--radius-sm)",
            lineHeight: 0,
            // CSS hover-reveal in onboarding-tab.css:
            //   .field-row .field-actions__copy { opacity: 0.7; }
            //   .field-row:hover .field-actions__copy { opacity: 1; }
          }}
        >
          <Copy size={14} stroke="currentColor" />
        </button>
      )}
    </div>
  );
}
