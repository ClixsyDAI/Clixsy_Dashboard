"use client";

// =============================================================
// ClientInformationHeader — top strip of the accordion block
// =============================================================
//
// Phase 4 PR B per phase-4-plan.md §6.1.
//
// Client component — part of the accordion's client subtree
// because it carries interactive controls (Expand all,
// Collapse all) that toggle the accordion's state directly.
// The Export buttons are inert in Phase 4 (Phase 8 wires them
// to real CSV/JSON downloads).
//
// Layout per spec §4.4:
//   [<h2>Client information</h2>]    [Expand all | Collapse all] [Export to CSV] [Export to JSON]

import { Copy } from "./icons";

interface ClientInformationHeaderProps {
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export default function ClientInformationHeader({
  onExpandAll,
  onCollapseAll,
}: ClientInformationHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        marginBottom: 12,
        // No card chrome — this header sits directly above the
        // accordion item list.
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          color: "var(--text-1)",
        }}
      >
        Client information
      </h2>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        {/* Expand / Collapse pair — gold text links, divider between */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
          }}
        >
          <button
            type="button"
            onClick={onExpandAll}
            style={textLinkStyle}
          >
            Expand all
          </button>
          <span style={{ color: "var(--text-4)" }}>|</span>
          <button
            type="button"
            onClick={onCollapseAll}
            style={textLinkStyle}
          >
            Collapse all
          </button>
        </div>

        {/* Inert export buttons — Phase 8 wires the downloads */}
        <button
          type="button"
          disabled
          title="Coming in Phase 8"
          style={exportButtonStyle}
        >
          <Copy size={12} stroke="currentColor" />
          Export to CSV
        </button>
        <button
          type="button"
          disabled
          title="Coming in Phase 8"
          style={exportButtonStyle}
        >
          <Copy size={12} stroke="currentColor" />
          Export to JSON
        </button>
      </div>
    </div>
  );
}

// =============================================================
// Style helpers
// =============================================================

const textLinkStyle: React.CSSProperties = {
  all: "unset",
  color: "var(--gold)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
};

const exportButtonStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  color: "var(--text-2)",
  border: "1px solid var(--border-strong)",
  padding: "6px 12px",
  borderRadius: "var(--radius-sm)",
  fontSize: 11,
  fontWeight: 500,
  cursor: "not-allowed",
  opacity: 0.7,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
};
