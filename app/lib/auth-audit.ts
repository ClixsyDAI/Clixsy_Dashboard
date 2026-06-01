import "server-only";
// =============================================================
// auth_audit_events — write helper
// =============================================================
//
// Phase 1 PR B. Single entry point for writing rows to the
// auth_audit_events table (migration 011). Centralising the write
// here means:
//   - One place to read for the established event_type values
//     (migration 011's header comment is the source of truth;
//     this file's AuthAuditEventType union mirrors it).
//   - One place that knows the table uses next/server after() per
//     operations-notes §2. Inline writes elsewhere in the code
//     base have repeatedly burned us; centralising prevents drift.
//   - When PR C / PR D add new event types, they edit one union
//     here + one comment in migration 011, not many call sites.

import { after } from "next/server";
import { getSupabaseServerClient } from "./supabase-server";

export type AuthAuditEventType =
  | "google_oauth_sign_in_succeeded"
  | "google_oauth_sign_in_rejected_not_in_app_users"
  | "google_oauth_sign_in_rejected_disabled"
  | "google_oauth_sign_in_rejected_non_clixsy_domain"
  | "google_oauth_sign_in_rejected_email_not_verified"
  | "google_oauth_callback_error"
  | "access_request_created"
  | "requireRole_rejected_unauthenticated"
  | "requireRole_rejected_forbidden";

/**
 * Queue an auth_audit_events write for after-response execution.
 *
 * Fires via next/server after(), so the response ships first and
 * the row is written in the post-response window. If the insert
 * fails the error is logged with `[auth-audit]` prefix — never
 * thrown — because audit failures should never break a sign-in
 * flow.
 *
 * actorEmail may be null for events where the actor isn't known
 * (e.g. a callback hit with no `code` param at all).
 */
export function logAuthAudit(args: {
  eventType: AuthAuditEventType;
  actorEmail: string | null;
  payload?: Record<string, unknown>;
}): void {
  const { eventType, actorEmail, payload } = args;
  after(async () => {
    try {
      const supabase = getSupabaseServerClient();
      const { error } = await supabase.from("auth_audit_events").insert({
        event_type: eventType,
        actor_email: actorEmail,
        payload: payload ?? null,
      });
      if (error) {
        console.warn(
          `[auth-audit] insert failed event_type=${eventType} error=${error.message}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[auth-audit] insert threw event_type=${eventType} error=${message}`,
      );
    }
  });
}
