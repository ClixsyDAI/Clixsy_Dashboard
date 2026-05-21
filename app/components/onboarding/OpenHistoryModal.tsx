"use client";

// =============================================================
// OpenHistoryModal — list of onboarding_open_events for session
// =============================================================
//
// Phase 5 PR B per phase-5-plan.md §6.3.
//
// Pipeline step 2 (Opened) modal. Lists the open events
// captured by the onboarding repo's `after(...)` insert each
// time the form is loaded (PR #12 in the onboarding repo;
// merged 2026-05-20).
//
// Events arrive newest-first via PR A's fetcher
// (.order("opened_at", { ascending: false })). The fetcher
// caps at OPEN_EVENTS_MODAL_LIMIT (50) so the list may be a
// subset of the true total — surface a "Latest N events"
// caveat when that happens.

import type { OpenEventSummary } from "../../lib/onboarding/types";
import Modal from "./Modal";

const PRE_PR12_NOTE_DATE = "May 20, 2026";

interface OpenHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: OpenEventSummary[];
  totalCount: number;
}

export default function OpenHistoryModal({
  isOpen,
  onClose,
  events,
  totalCount,
}: OpenHistoryModalProps) {
  const isEmpty = events.length === 0;
  const isCapped = totalCount > events.length;

  const subtitle = isEmpty
    ? "No visits recorded yet"
    : isCapped
      ? `Showing latest ${events.length} of ${totalCount} visits`
      : `${totalCount} visit${totalCount === 1 ? "" : "s"} over the session lifetime`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Open history"
      subtitle={subtitle}
    >
      {isEmpty ? (
        <EmptyState />
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {events.map((event) => (
            <li
              key={event.id}
              style={{
                padding: "12px 14px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-1)",
                }}
              >
                {formatEventTimestamp(event.opened_at)}
              </div>
              {event.user_agent && (
                <div
                  title={event.user_agent}
                  style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                  }}
                >
                  {truncate(event.user_agent, 80)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "12px 0",
        color: "var(--text-2)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <p style={{ margin: "0 0 12px" }}>
        No open events have been recorded for this session yet.
      </p>
      <p style={{ margin: 0, color: "var(--text-3)", fontSize: 12 }}>
        Open-event tracking shipped on {PRE_PR12_NOTE_DATE} (workbook PR
        #12). Events for this session will appear here after the next
        time the onboarding link is loaded.
      </p>
    </div>
  );
}

/**
 * Format an ISO timestamp like "May 19, 2026 at 9:35 AM" — matches
 * the mockup's modal-row format. Uses two DateTimeFormat instances
 * so the literal " at " separator stays consistent.
 */
function formatEventTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(d)} at ${timeFmt.format(d)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
