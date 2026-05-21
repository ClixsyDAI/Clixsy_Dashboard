// =============================================================
// format-reminder-date — shared date formatters
// =============================================================
//
// Phase 6.5 PR B step B1 per phase-6.5-plan.md §6.1.
//
// Extracted from ReminderStrip.tsx so the Reminder History modal
// can reuse the same relative + absolute timestamp formats
// without duplicating the implementations.
//
// Both functions are pure (no `now` defaulting, no I/O). The
// caller passes `now` explicitly so the call sites are easy to
// audit and the helpers are trivially testable should a future
// phase add a test harness.

/**
 * Format a past date relative to `now` using Intl.RelativeTimeFormat.
 * Picks the largest natural unit (second → minute → hour → day →
 * month → year). With `numeric: 'auto'`, single-unit cases get
 * phrasings like "yesterday" / "last month" instead of "1 day ago" /
 * "1 month ago".
 *
 * Inputs MUST be in the past (caller wraps via
 * `formatRelative(sent, new Date())`). The negative sign is applied
 * here.
 */
export function formatRelative(date: Date, now: Date): string {
  const ms = now.getTime() - date.getTime();
  const seconds = Math.round(ms / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const months = Math.round(days / 30);
  const years = Math.round(days / 365);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (hours < 24) return rtf.format(-hours, "hour");
  if (days < 30) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-months, "month");
  return rtf.format(-years, "year");
}

/**
 * Format an absolute timestamp to match the spec's example:
 *   "May 17, 2026 at 11:30 AM"
 *
 * Built from two DateTimeFormat instances rather than one so the
 * spec's literal " at " separator is preserved (Intl doesn't offer
 * a "long-date + time joined by 'at'" preset).
 */
export function formatAbsolute(date: Date): string {
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(date)} at ${timeFmt.format(date)}`;
}
