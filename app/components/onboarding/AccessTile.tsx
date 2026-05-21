// =============================================================
// AccessTile — single colored tile in the Technical Access grid
// =============================================================
//
// Phase 5 PR B per phase-5-plan.md §6.7.
//
// Server component. Renders one of the 7 access assets with
// the status-specific color treatment per spec §6.4:
//
//   provided   → green   tile with Check
//   missing    → red     tile with AlertTriangle
//   needs_help → blue    tile with HelpCircle
//   later      → amber   tile with Clock
//   na         → grey    tile with Minus
//
// Status icons come from icons.tsx (extended in PR A step A3).

import type {
  AccessAssetKey,
  AccessStatus,
} from "../../lib/onboarding/access-checklist";
import { AlertTriangle, Check, Clock, HelpCircle, Minus } from "./icons";

interface AccessTileProps {
  assetKey: AccessAssetKey;
  status: AccessStatus;
}

export default function AccessTile({ assetKey, status }: AccessTileProps) {
  const visual = VISUAL_BY_STATUS[status];
  const StatusIcon = visual.Icon;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "14px 16px",
        background: visual.bg,
        border: `1px solid ${visual.border}`,
        borderRadius: "var(--radius-sm)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: visual.accent,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <StatusIcon size={14} stroke="currentColor" />
        <span style={{ color: "var(--text-1)" }}>
          {ASSET_LABELS[assetKey]}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          fontWeight: 500,
        }}
      >
        {STATUS_LABELS[status]}
      </div>
    </div>
  );
}

// =============================================================
// Lookup tables
// =============================================================

const ASSET_LABELS: Record<AccessAssetKey, string> = {
  wordpress: "WordPress",
  domain: "Domain",
  dns: "DNS",
  gsc: "Search Console",
  ga: "Analytics",
  gbp: "Business Profile",
  youtube: "YouTube",
};

const STATUS_LABELS: Record<AccessStatus, string> = {
  provided: "Provided",
  missing: "Missing",
  needs_help: "Needs help",
  later: "Will do later",
  na: "Not applicable",
};

interface TileVisual {
  bg: string;
  border: string;
  accent: string;
  Icon: typeof Check;
}

const VISUAL_BY_STATUS: Record<AccessStatus, TileVisual> = {
  provided: {
    bg: "var(--green-soft)",
    border: "var(--green)",
    accent: "var(--green)",
    Icon: Check,
  },
  missing: {
    bg: "var(--red-soft)",
    border: "var(--red)",
    accent: "var(--red)",
    Icon: AlertTriangle,
  },
  needs_help: {
    bg: "var(--blue-soft)",
    border: "var(--blue)",
    accent: "var(--blue)",
    Icon: HelpCircle,
  },
  later: {
    bg: "var(--amber-soft)",
    border: "var(--amber)",
    accent: "var(--amber)",
    Icon: Clock,
  },
  na: {
    bg: "var(--surface-2)",
    border: "var(--border-strong)",
    accent: "var(--text-3)",
    Icon: Minus,
  },
};
