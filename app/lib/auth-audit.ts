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
  | "requireRole_rejected_forbidden"
  // PR D-0: requireRole now reads app_users.session_version on every call
  // and rejects cookies whose session_version claim is stale (or missing).
  | "requireRole_rejected_session_revoked"
  // PR D-1: mutation success events from the 8 admin RPCs.
  | "user_invited"
  | "invite_accepted"
  | "invite_revoked"
  | "role_changed"
  | "user_disabled"
  | "user_enabled"
  | "access_request_approved"
  | "access_request_denied"
  // PR D-1: catch-all for rejection branches inside mutation RPCs. The
  // payload's `reason` field uses the AdminActionRejectedReason enum
  // below; the payload's `rpc` field names the RPC the rejection came
  // from. Together these uniquely identify the rejection.
  | "users_action_rejected"
  // PR D-1: handler-layer rejection events (zod fail / CSRF / rate-limit /
  // method-not-allowed). Best-effort fire-and-forget audit; failure to
  // write does not block the 4xx response. Same closed-set reason enum.
  | "handler_validation_failed"
  | "handler_origin_rejected"
  | "handler_rate_limited"
  | "handler_method_not_allowed";

/**
 * Closed-set reason enum for users_action_rejected + handler_* events.
 *
 * Every rejection branch in PR D-1's RPCs + routes maps to exactly one
 * value here. Any code outside this set is a bug — the post-merge
 * monitoring step alerts on it.
 */
export type AdminActionRejectedReason =
  // Common across many RPCs
  | "actor_session_stale"
  | "invalid_role"
  | "self_action_forbidden"
  | "target_not_found"
  // approve/deny access request
  | "request_not_found"
  | "request_already_resolved"
  | "email_not_verified_at_request_time"
  | "email_already_in_users"
  // create/revoke/accept invite
  | "invalid_email_domain"
  | "pending_invite_exists"
  | "invite_not_found"
  | "invite_already_accepted"
  | "invite_already_revoked"
  | "invite_expired"
  | "invite_email_mismatch"
  | "invite_email_already_user"
  // disable/enable user + role change
  | "target_already_disabled"
  | "target_already_enabled"
  | "cannot_remove_last_super_admin"
  // Handler layer (not from RPCs)
  | "validation_failed"
  | "origin_rejected"
  | "rate_limited"
  | "method_not_allowed";

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
