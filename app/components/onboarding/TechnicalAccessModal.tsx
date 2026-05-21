"use client";

// =============================================================
// TechnicalAccessModal — 7-tile colored access checklist
// =============================================================
//
// Phase 5 PR B per phase-5-plan.md §6.6.
//
// Pipeline step 5 (Access pending) modal. Renders the 7
// access assets in a responsive grid: 4 columns at >= 560px,
// 2 columns when narrower.
//
// Tile order matches the spec: WordPress, Domain, DNS, GSC,
// GA, GBP, YouTube. Pulled directly from ACCESS_ASSET_KEYS in
// access-checklist.ts (PR A) so it stays in sync.

import {
  ACCESS_ASSET_KEYS,
  type AccessChecklistView,
} from "../../lib/onboarding/access-checklist";
import AccessTile from "./AccessTile";
import Modal from "./Modal";

interface TechnicalAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessChecklist: AccessChecklistView;
}

export default function TechnicalAccessModal({
  isOpen,
  onClose,
  accessChecklist,
}: TechnicalAccessModalProps) {
  const total = ACCESS_ASSET_KEYS.length;
  const subtitle = `${accessChecklist.effectivelyComplete} of ${total} received`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Technical access checklist"
      subtitle={subtitle}
      width="wide"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {ACCESS_ASSET_KEYS.map((assetKey) => (
          <AccessTile
            key={assetKey}
            assetKey={assetKey}
            status={accessChecklist.byAsset[assetKey]}
          />
        ))}
      </div>
    </Modal>
  );
}
