// =============================================================
// EmailPreview — white-on-dark email simulation
// =============================================================
//
// Phase 6 PR B step B1 per phase-6-plan.md §6.4.
//
// Shared preview pane used by SendFormReminderModal (§6.5) and
// RequestMissingAccessModal (§6.6). Renders the rendered email
// (subject + body from lib/onboarding/email-templates.ts) like
// a real email client: white background, dark text, From/To
// header, bold subject, body paragraphs, optional green CTA
// buttons.
//
// This is the only block in the Onboarding tab that uses light
// backgrounds — emails are dark-text-on-light, even inside the
// dark-themed workbook tab. The contrast is intentional.
//
// Server component — no interactivity. Pure render over plain
// data.

interface EmailPreviewProps {
  from: string;
  to: string;
  subject: string;
  /** Email body string with newlines. Paragraphs are split on
   * blank lines. Tokens like "[Resume your form ->]" become
   * green CTA buttons IF the inner label appears in ctaLabels. */
  body: string;
  /** Inner labels (without brackets) to render as CTA buttons.
   * Anything not in this list stays as literal "[Label]" text. */
  ctaLabels?: string[];
}

export default function EmailPreview({
  from,
  to,
  subject,
  body,
  ctaLabels = [],
}: EmailPreviewProps) {
  const paragraphs = body.split(/\n{2,}/);

  return (
    <div
      style={{
        background: "#ffffff",
        color: "#1a1a1a",
        border: "1px solid #d0d0d0",
        borderRadius: "var(--radius-sm)",
        padding: 0,
        fontFamily:
          'system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, sans-serif',
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {/* From / To header strip */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #e2e2e2",
          background: "#f7f7f5",
          fontSize: 11,
          color: "#555",
        }}
      >
        <div>
          <span style={{ fontWeight: 600 }}>From:</span> {from}
        </div>
        <div>
          <span style={{ fontWeight: 600 }}>To:</span> {to}
        </div>
      </div>

      {/* Subject */}
      <div
        style={{
          padding: "12px 16px 6px",
          fontSize: 14,
          fontWeight: 700,
          color: "#1a1a1a",
        }}
      >
        {subject}
      </div>

      {/* Body */}
      <div style={{ padding: "0 16px 16px" }}>
        {paragraphs.map((para, i) => (
          <Paragraph key={i} text={para} ctaLabels={ctaLabels} />
        ))}
      </div>
    </div>
  );
}

// =============================================================
// Paragraph + CTA swap
// =============================================================

function Paragraph({
  text,
  ctaLabels,
}: {
  text: string;
  ctaLabels: string[];
}) {
  // Preserve internal newlines as <br/> so bullet lists from the
  // access-request template keep their shape.
  const lines = text.split("\n");
  return (
    <p style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>
      {lines.map((line, i) => (
        <span key={i}>
          {renderWithCtas(line, ctaLabels)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </p>
  );
}

/**
 * Render a single line, swapping [Label] tokens for green CTA
 * pills when Label matches an entry in ctaLabels. Tokens that
 * don't match render as literal text so the email body still
 * reads sensibly without UI styling.
 */
function renderWithCtas(line: string, ctaLabels: string[]) {
  if (ctaLabels.length === 0) return line;

  // Split on [Label] tokens, keeping the captures.
  const parts = line.split(/(\[[^\]]+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(.+)\]$/);
    if (match && ctaLabels.includes(match[1])) {
      return <CtaButton key={i}>{match[1]}</CtaButton>;
    }
    return part;
  });
}

function CtaButton({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        margin: "2px 4px 2px 0",
        padding: "4px 10px",
        background: "#3eb37a",
        color: "#ffffff",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {children}
    </span>
  );
}
