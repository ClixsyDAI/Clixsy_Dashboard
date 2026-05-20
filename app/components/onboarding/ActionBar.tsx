// =============================================================
// ActionBar — spec §4.2 (top row only; link row composed below)
// =============================================================
//
// Phase 2 PR B per phase-2-plan.md §5.1 + §5.2.
//
// Server component for the static top row (avatar, identity line,
// sub-line, two inert action buttons). The bottom link row is a
// separate **client** component (`<ActionBarLinkRow>`) because the
// Copy button needs `navigator.clipboard`. They share the same
// outer card shell.
//
// Inert in Phase 2 (per the operator's PR-B brief):
//   - "Send form reminder" button → opens nothing yet. Modal in
//     spec §6.5 lands in a later phase.
//   - "Request missing access" button → opens nothing yet. Modal
//     in spec §6.6 lands in a later phase.
//
// Both buttons render present-but-disabled so the visual block
// matches the mockup. Hover state, color, sizing — all match;
// only the click handler is missing.

import type {
  ClientRow,
  OnboardingAnswerRow,
  OnboardingSessionRow,
  SessionStatus,
} from "../../lib/onboarding/types";
import ActionBarLinkRow from "./ActionBarLinkRow";

interface ActionBarProps {
  client: ClientRow;
  session: OnboardingSessionRow;
  answers: OnboardingAnswerRow[];
}

interface PrimaryContactView {
  name: string;
  email: string;
  phone: string;
  title: string;
}

export default function ActionBar({ client, session, answers }: ActionBarProps) {
  const contact = pullPrimaryContact(answers, client);
  const initials = computeInitials(contact.name, contact.email);
  const identityLine = buildIdentityLine(session.status, contact);
  const subLine = buildSubLine(contact);

  return (
    <div
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* ── Top row: identity + actions ─────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* Avatar + identity */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              backgroundColor: "var(--gold-soft)",
              color: "var(--gold)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.06em",
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-1)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {identityLine}
            </div>
            {subLine && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-3)",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {subLine}
              </div>
            )}
          </div>
        </div>

        {/* Actions (inert in Phase 2) */}
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <InertActionButton
            variant="ghost"
            icon={<BellIcon />}
            label="Send form reminder"
            title="Coming in a later phase"
          />
          <InertActionButton
            variant="gold"
            icon={<KeyIcon />}
            label="Request missing access"
            title="Coming in a later phase"
          />
        </div>
      </div>

      {/* 1px divider between top row and link row */}
      <div
        style={{
          height: 1,
          backgroundColor: "var(--border)",
        }}
      />

      {/* ── Bottom row: onboarding link + link actions ──────── */}
      <ActionBarLinkRow token={session.token} />
    </div>
  );
}

// =============================================================
// Identity helpers
// =============================================================

/**
 * Pull the primary contact info from the answers JSONB. The spec
 * (§4.2 / discovery contradiction §3) assumes flat `contact_*`
 * columns on the session row, but in reality those values live
 * inside `onboarding_answers.answers` for the row where
 * `step_key === 'primary_contact'`, under names
 * `main_contact_name`, `main_contact_email`, `main_contact_phone`,
 * `main_contact_title` (per onboarding repo audit §5).
 *
 * Fall back to `client.primary_contact_email` if the answers don't
 * have it yet (early-draft sessions). Returns "" for missing pieces
 * — the caller decides whether to display them.
 */
function pullPrimaryContact(
  answers: OnboardingAnswerRow[],
  client: ClientRow,
): PrimaryContactView {
  const row = answers.find((a) => a.step_key === "primary_contact");
  const data = (row?.answers ?? {}) as Record<string, unknown>;

  const name = asString(data.main_contact_name);
  const email = asString(data.main_contact_email) || (client.primary_contact_email ?? "");
  const phone = asString(data.main_contact_phone);
  const title = asString(data.main_contact_title);

  return { name, email, phone, title };
}

function asString(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

/**
 * Compute the avatar initials: first letter of first word + first
 * letter of last word. Fallback to first 2 letters of email if no
 * name is available. Returns "?" if neither is set.
 */
function computeInitials(name: string, email: string): string {
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    const first = words[0][0] ?? "";
    const last = words[words.length - 1][0] ?? "";
    return (first + last).toUpperCase();
  }
  if (email) {
    // Use the local-part before the @ so a "test@…" doesn't end up
    // as "TE" but rather "TE" from the local part.
    const local = email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase() || "?";
  }
  return "?";
}

/**
 * Build the primary identity line per session.status. Spec §4.2:
 *   submitted    → "Submitted by {Full Name}"
 *   in_progress  → "Filled in by {Full Name}"
 *   draft        → "Form created for {email}"
 *
 * Falls back to email when the name is unset on submitted/in_progress
 * (edge case: form was submitted before the primary_contact step was
 * answered — shouldn't happen, but degrade gracefully).
 */
function buildIdentityLine(
  status: SessionStatus,
  contact: PrimaryContactView,
): string {
  switch (status) {
    case "submitted":
      return `Submitted by ${contact.name || contact.email || "—"}`;
    case "in_progress":
      return `Filled in by ${contact.name || contact.email || "—"}`;
    case "draft":
    default:
      return `Form created for ${contact.email || "—"}`;
  }
}

/**
 * Join email · phone · title with a non-breaking-space middle-dot.
 * Missing pieces are collapsed (spec §10 edge case: no stray middle
 * dots when phone or title are empty).
 */
function buildSubLine(contact: PrimaryContactView): string {
  const pieces = [contact.email, contact.phone, contact.title].filter(Boolean);
  if (pieces.length === 0) return "";
  // Spaces around the middle dot match the spec example: "email · phone · title".
  return pieces.join(" · ");
}

// =============================================================
// Subcomponents
// =============================================================

interface InertButtonProps {
  variant: "ghost" | "gold";
  icon: React.ReactNode;
  label: string;
  title?: string;
}

function InertActionButton({ variant, icon, label, title }: InertButtonProps) {
  const isGold = variant === "gold";
  return (
    <button
      type="button"
      disabled
      title={title}
      style={{
        background: isGold ? "var(--gold)" : "var(--surface-2)",
        color: isGold ? "#2a1f10" : "var(--text-1)",
        border: isGold ? "1px solid var(--gold)" : "1px solid var(--border-strong)",
        padding: "10px 14px",
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "not-allowed",
        opacity: 0.85,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// =============================================================
// Inline icons (mockup sprite paths, see spec Appendix D #1 —
// inline SVG so a missing webfont can't break the icons)
// =============================================================

function BellIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}
