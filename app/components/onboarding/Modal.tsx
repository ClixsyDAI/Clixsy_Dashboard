"use client";

// =============================================================
// Modal — shared dialog wrapper for Phase 5+ pipeline modals
// =============================================================
//
// Phase 5 PR B per phase-5-plan.md §6.1.
//
// Cross-cutting concerns handled here so every modal in the
// Onboarding tab (Open History, Sections Completed, Form
// Complete, Technical Access — and Phase 6's three action-bar
// modals) inherits the same chrome:
//
//   1. Portal to document.body via React's createPortal.
//   2. ESC keypress closes (document-level listener, only when
//      isOpen).
//   3. Backdrop click closes (stopPropagation on the panel).
//   4. Body scroll lock while open.
//   5. Focus trap via <FocusTrap> from focus-trap-react with
//      returnFocusOnDeactivate so keyboard users land back on
//      the triggering pipeline circle after close.
//   6. A11y attrs: role=dialog, aria-modal, aria-labelledby
//      (always), aria-describedby (when subtitle present).
//
// The portal target is document.body directly — no extra
// <div id="modal-root"> is added because Next.js renders into
// body by default and we want the backdrop's z-index 9999 to
// sit above any workbook stacking context.

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusTrap } from "focus-trap-react";
import { X } from "./icons";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "default" | "wide";
}

export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "default",
}: ModalProps) {
  const titleId = useId();
  const subtitleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // SSR guard — createPortal requires document. The portal only
  // renders after the component mounts on the client. This also
  // ensures focus-trap-react doesn't try to grab focus during
  // hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC closes — listener only attached while open so the modal
  // doesn't sit on the document listening forever.
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Body scroll lock — toggle overflow on body while open; restore
  // the previous value on cleanup (don't assume it was always
  // 'visible' — another component could have locked it).
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const maxWidth = width === "wide" ? 880 : 640;

  const modalJsx = (
    <FocusTrap
      active={isOpen}
      focusTrapOptions={{
        // Library handles the return-focus dance — captures
        // document.activeElement on activation, calls .focus() on
        // it during deactivation. Spec §6.1 PR B definition of
        // done: focus returns to the triggering pipeline circle.
        returnFocusOnDeactivate: true,
        // ESC + backdrop click are handled by our own listeners;
        // don't let the trap also fight for the keypress.
        escapeDeactivates: false,
        clickOutsideDeactivates: false,
        // Allow clicks outside the trapped element (the backdrop)
        // so the overlay click-to-close handler still fires.
        allowOutsideClick: true,
        // Initial focus on the close button — sensible default
        // that doesn't trigger unwanted actions on Enter.
        initialFocus: () => closeButtonRef.current,
      }}
    >
      <div
        className="onboarding-tab"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.7)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            width: "100%",
            maxWidth,
            maxHeight: "85vh",
            display: "flex",
            flexDirection: "column",
            color: "var(--text-1)",
            // Soft shadow to separate the panel from the backdrop
            // (matches mockup .modal box-shadow).
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.45)",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              padding: "20px 24px 12px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  lineHeight: 1.3,
                }}
              >
                {title}
              </h2>
              {subtitle && (
                <p
                  id={subtitleId}
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "var(--text-3)",
                  }}
                >
                  {subtitle}
                </p>
              )}
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                all: "unset",
                cursor: "pointer",
                color: "var(--text-3)",
                padding: 4,
                borderRadius: "var(--radius-sm)",
                lineHeight: 0,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-3)";
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = "0 0 0 2px var(--gold)";
                e.currentTarget.style.color = "var(--text-1)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.color = "var(--text-3)";
              }}
            >
              <X size={18} stroke="currentColor" />
            </button>
          </div>

          {/* Body — scrollable when content overflows the 70vh cap */}
          <div
            style={{
              padding: "16px 24px",
              overflowY: "auto",
              flex: 1,
              minHeight: 0,
            }}
          >
            {children}
          </div>

          {footer && (
            <div
              style={{
                padding: "12px 24px 20px",
                borderTop: "1px solid var(--border)",
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );

  return createPortal(modalJsx, document.body);
}
