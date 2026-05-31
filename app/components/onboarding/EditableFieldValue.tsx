"use client";

// =============================================================
// EditableFieldValue — inline contenteditable editor + state machine
// =============================================================
//
// Phase 7 PR B step B3 per phase-7-plan.md §6.2 + §4.3.
//
// State machine:
//   idle → editing → saving → { saved | error }
//                                ↓        ↓
//                                idle    editing (with error callout)
//
// idle:    renders the existing FieldValue (read-only HumanizeResult).
//          A sibling FieldActions group (B4) shows the hover-pencil
//          that calls onStartEdit() to enter "editing".
// editing: replaces the read view with a contenteditable span +
//          gold border + --surface-3 bg. Cursor at end of content.
//          Enter (no Shift) → save; blur → save; Esc → cancel.
// saving:  contenteditable=false; "Saving…" indicator inline.
// saved:   "Check" icon + brief pulse, then back to idle. Optimistic
//          display value is now confirmed.
// error:   typed value retained, visible display reverts to original,
//          red inline callout below with the server's error message
//          + a Dismiss link that returns to editing for retry.
//
// The typed value lives in this component's useState — it survives
// the rollback because the editor stays mounted on error.
// The "visible display value" is the prop coming from the payload —
// it reverts to the original because nothing else updated it.
//
// Per FieldType serialization (§6.6 of plan):
//   text/long_text/email/tel/url/select/radio → trimmed string
//   multiselect → split(",").map(trim).filter(Boolean)  → array
//   checkbox    → "yes"|"no" → true|false; anything else → null
//
// No router.refresh() after save (§6.8). Visible value sticks via
// optimistic display; pipeline-stepper missing counts may stale
// until next page reload.

import { useEffect, useRef, useState } from "react";
import type { FieldType } from "../../lib/onboarding/field-config";
import type { HumanizeResult } from "../../lib/onboarding/humanize";
import type { StepKey } from "../../lib/onboarding/step-keys";
import { Check, RefreshCcw } from "./icons";
import FieldValue from "./FieldValue";
import { useAdminAuth } from "../../lib/use-admin-auth";

interface EditableFieldValueProps {
  sessionId: string;
  stepKey: StepKey;
  fieldKey: string;
  fieldType: FieldType;
  /** Current humanized display (Phase 4's HumanizeResult). The
   * editor renders this verbatim in idle/saving/error states. */
  display: HumanizeResult;
  /** Raw JSONB value (PR A added rawValue to ProjectedField).
   * Used to seed the editor on entry + as the rollback target. */
  rawValue: unknown;
  /** Imperative trigger to enter edit mode. FieldRow's hover
   * pencil calls this. */
  editTrigger: number;
  /** Fires when the editor exits idle (started) or returns to
   * idle (saved successfully OR cancelled). Lets the parent
   * suppress hover/copy affordances while editing. */
  onEditingChange?: (editing: boolean) => void;
}

type EditState =
  | { kind: "idle" }
  | { kind: "editing"; typed: string }
  | { kind: "saving"; typed: string }
  | { kind: "saved"; optimistic: string }
  | { kind: "error"; typed: string; message: string };

export default function EditableFieldValue({
  sessionId,
  stepKey,
  fieldKey,
  fieldType,
  display,
  rawValue,
  editTrigger,
  onEditingChange,
}: EditableFieldValueProps) {
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();
  const [state, setState] = useState<EditState>({ kind: "idle" });
  // Tracks the optimistic display value during the saved-pulse so
  // the row shows the new content before the next page render
  // reconciles it.
  const [optimisticDisplay, setOptimisticDisplay] = useState<string | null>(null);

  const editorRef = useRef<HTMLSpanElement>(null);

  // Imperative open: when the parent's pencil click bumps
  // editTrigger, enter editing.
  //
  // Seed the editor with the OPTIMISTIC value if a previous save
  // landed one (the user's last-typed text); otherwise serialise
  // the prop's rawValue. This matters because the prop doesn't
  // refresh until next page render (no router.refresh per plan
  // §6.8), so without this the editor would re-open with the
  // pre-edit raw value instead of what's currently displayed.
  useEffect(() => {
    if (editTrigger === 0) return; // initial render, no auto-open
    if (state.kind !== "idle" && state.kind !== "saved") return;
    const initial =
      optimisticDisplay !== null
        ? optimisticDisplay
        : serializeRawForEditor(rawValue, fieldType);
    setState({ kind: "editing", typed: initial });
    onEditingChange?.(true);
    // Focus + cursor-at-end happens in the layout effect below
    // once the contenteditable span has rendered.
  }, [editTrigger]); // intentionally only editTrigger — other deps would re-open

  // Invalidate the optimistic display when the prop changes —
  // i.e., when next page render arrives carrying the fresh DB
  // value. From that point the prop is authoritative and the
  // local optimistic is redundant. Without this, a router.refresh
  // (Phase 6 send actions) or full reload would render the prop
  // BUT the stale optimistic would still show.
  useEffect(() => {
    setOptimisticDisplay(null);
  }, [display]);

  // Place cursor at end of content when entering editing.
  useEffect(() => {
    if (state.kind !== "editing") return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [state.kind]);

  // Notify parent when editing exits (idle / saved / error all stop the hover suppression).
  useEffect(() => {
    if (state.kind === "idle" || state.kind === "saved") {
      onEditingChange?.(false);
    }
    if (state.kind === "saved") {
      // Auto-clear the saved pulse after 900ms — transitions back
      // to idle. **optimisticDisplay is intentionally NOT cleared
      // here.** Per plan §6.8 the optimistic value sticks until
      // the prop changes (next page render), so the idle render
      // below can fall back to it instead of the stale rawValue.
      // The [display] useEffect above is the invalidator.
      const timer = window.setTimeout(() => {
        setState({ kind: "idle" });
      }, 900);
      return () => window.clearTimeout(timer);
    }
  }, [state.kind, onEditingChange]);

  const handleSave = async (typed: string) => {
    setState({ kind: "saving", typed });
    const new_value = parseTypedForFieldType(typed, fieldType);
    try {
      const res = await fetchWithAuth("/api/onboarding/field-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          step_key: stepKey,
          field_key: fieldKey,
          field_type: fieldType,
          new_value,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setState({
          kind: "error",
          typed,
          message: j.error ?? `Request failed: ${res.status}`,
        });
        return;
      }
      // 2xx — optimistic display sticks until next page render.
      // The visible string is the editor's typed value verbatim
      // (post-parse for multiselect / checkbox we still want the
      // user-friendly display).
      setOptimisticDisplay(typed.trim());
      setState({ kind: "saved", optimistic: typed.trim() });
    } catch (err) {
      setState({
        kind: "error",
        typed,
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const handleCancel = () => {
    // **optimisticDisplay is intentionally NOT cleared here.**
    // Cancel means "abandon THIS edit attempt"; it shouldn't
    // wipe out a previously-saved optimistic value. The [display]
    // invalidator clears optimistic when the prop catches up.
    setState({ kind: "idle" });
  };

  const handleDismissError = () => {
    if (state.kind !== "error") return;
    // Return to editing with the typed value retained.
    setState({ kind: "editing", typed: state.typed });
  };

  // =============================================================
  // Render
  // =============================================================

  if (state.kind === "editing" || state.kind === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget as HTMLSpanElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              handleCancel();
            }
          }}
          onBlur={(e) => {
            // Blur saves with the current textContent. State-machine
            // guard: only save when in editing (not error — error's
            // dismiss path re-enters editing and re-focuses).
            if (state.kind !== "editing") return;
            const typed = e.currentTarget.textContent ?? "";
            handleSave(typed);
          }}
          style={{
            display: "inline-block",
            outline: "none",
            background: "var(--surface-3)",
            border: "1.5px solid var(--gold)",
            borderRadius: "var(--radius-sm)",
            padding: "2px 8px",
            minWidth: 60,
            color: "var(--text-1)",
          }}
        >
          {state.kind === "editing" ? state.typed : state.typed}
        </span>
        {state.kind === "error" && (
          <div
            role="alert"
            style={{
              fontSize: 11,
              color: "var(--red)",
              background: "var(--red-soft)",
              border: "1px solid var(--red)",
              borderRadius: "var(--radius-sm)",
              padding: "6px 10px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              lineHeight: 1.4,
            }}
          >
            <span style={{ flex: 1 }}>{state.message}</span>
            <button
              type="button"
              onClick={handleDismissError}
              style={{
                all: "unset",
                cursor: "pointer",
                color: "var(--text-2)",
                fontSize: 11,
                fontWeight: 500,
                textDecoration: "underline",
              }}
            >
              Dismiss
            </button>
          </div>
        )}
        {signInPromptJsx}
      </div>
    );
  }

  if (state.kind === "saving") {
    return (
      <>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--text-3)" }}>{state.typed}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            <RefreshCcw size={11} stroke="currentColor" />
            Saving…
          </span>
        </span>
        {signInPromptJsx}
      </>
    );
  }

  if (state.kind === "saved") {
    return (
      <>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--text-1)" }}>{state.optimistic}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "var(--green)",
            }}
          >
            <Check size={12} stroke="currentColor" />
            Saved
          </span>
        </span>
        {signInPromptJsx}
      </>
    );
  }

  // idle — render the existing FieldValue. If we have an
  // optimistic display from the recently-saved pulse, show it
  // verbatim (the props won't include it until next page render).
  if (optimisticDisplay !== null) {
    return (
      <>
        <span style={{ color: "var(--text-1)" }}>{optimisticDisplay}</span>
        {signInPromptJsx}
      </>
    );
  }
  return (
    <>
      <FieldValue value={display} />
      {signInPromptJsx}
    </>
  );
}

// =============================================================
// Per-FieldType editor serialisation
// =============================================================

/**
 * Serialise the raw JSONB value to the string the contenteditable
 * editor displays in editing state.
 */
function serializeRawForEditor(raw: unknown, fieldType: FieldType): string {
  switch (fieldType) {
    case "multiselect":
      return Array.isArray(raw) ? raw.join(", ") : "";
    case "checkbox":
      return raw === true ? "yes" : raw === false ? "no" : "";
    default:
      return raw == null ? "" : String(raw);
  }
}

/**
 * Parse the editor's typed string into the wire shape the route
 * expects.
 */
function parseTypedForFieldType(typed: string, fieldType: FieldType): unknown {
  const trimmed = typed.trim();
  switch (fieldType) {
    case "multiselect":
      return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    case "checkbox": {
      const lower = trimmed.toLowerCase();
      if (lower === "yes" || lower === "true") return true;
      if (lower === "no" || lower === "false") return false;
      return null;
    }
    default:
      return trimmed;
  }
}
