// =============================================================
// rate-limit — coarse 30/min/(actor, action_class) rate limiter
// =============================================================
//
// Phase 1 PR D-1. Backed by the `bump_rate_limit` RPC in
// migration 013. Single-statement INSERT … ON CONFLICT UPDATE
// atomically increments a per-(actor, action_class, minute)
// counter; we 429 when the post-increment count exceeds the
// limit.
//
// Action classes (matched in the table's action_class column):
//   - users_mutation      — role / disable / enable / invite-create / invite-revoke
//   - access_request      — access-request approve/deny
//   - invite_acceptance   — POST /api/invite/accept (keyed by IP-hash, not email)
//
// Limit is 30/minute. Hard-coded; if we ever need per-class
// tuning, we extend with a config map here.

import { getSupabaseServerClient } from "./supabase-server";

export type ActionClass =
  | "users_mutation"
  | "access_request"
  | "invite_acceptance"
  | "basecamp_refresh";

const LIMIT_PER_MINUTE = 30;

export type RateLimitResult =
  | { ok: true; count: number; transitioned_to_throttled: boolean }
  | { ok: false; reason: "limit_exceeded"; count: number; retry_after_seconds: number }
  | { ok: false; reason: "transient_error" };

/**
 * Increment the rate-limit counter for the actor+action class.
 *
 * - ok:true,  transitioned_to_throttled:false — under the limit.
 * - ok:true,  transitioned_to_throttled:true  — JUST crossed the limit
 *   on this call. Caller should audit the throttle event ONCE (not on
 *   every subsequent rejected call in the same minute).
 * - ok:false, reason:'limit_exceeded' — count was already at or above
 *   the limit before this call. Caller returns 429 with Retry-After.
 *   Caller does NOT audit (would spam the log).
 * - ok:false, reason:'transient_error' — Supabase error. Caller should
 *   either 503 OR fail open (let the request through). Returning 503
 *   matches the rest of PR D-1's posture: fail-soft on Supabase blip.
 */
export async function enforceRateLimit(
  actorKey: string,
  actionClass: ActionClass,
): Promise<RateLimitResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("bump_rate_limit", {
      p_actor_key: actorKey,
      p_action_class: actionClass,
    });

    if (error) {
      console.warn(
        `[rate-limit] bump_rate_limit failed for ${actionClass}: ${error.message}`,
      );
      return { ok: false, reason: "transient_error" };
    }

    const count = typeof data === "number" ? data : Number(data ?? 0);

    if (count > LIMIT_PER_MINUTE) {
      return {
        ok: false,
        reason: "limit_exceeded",
        count,
        retry_after_seconds: 60,
      };
    }

    // Edge: this is the call that pushed count from <=30 to 30+1=31 …
    // wait, that's already > limit. The 'just transitioned' edge is
    // count === LIMIT_PER_MINUTE + 1, but we already 429'd above. So
    // 'transitioned' actually means: this is the call where count
    // reached LIMIT_PER_MINUTE. The NEXT call will 429. We audit the
    // boundary so the audit log records "user crossed the threshold".
    const transitioned = count === LIMIT_PER_MINUTE;

    return { ok: true, count, transitioned_to_throttled: transitioned };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[rate-limit] bump_rate_limit threw for ${actionClass}: ${message}`,
    );
    return { ok: false, reason: "transient_error" };
  }
}
