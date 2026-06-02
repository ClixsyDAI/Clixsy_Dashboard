// =============================================================
// audit-metadata — buildRequestMetadata + handler-rejection audit
// =============================================================
//
// Phase 1 PR D-1. Two responsibilities:
//
//   1. buildRequestMetadata(req) — canonical shape for the
//      request_metadata field on every audit row. No raw IP, no
//      raw User-Agent; hashes only (per audit review finding A6).
//
//   2. auditHandlerRejection(args) — fire-and-forget audit write
//      for handler-layer rejections that happen BEFORE the route
//      reaches a mutation RPC (zod failures, CSRF rejections,
//      rate-limit, method-not-allowed). The RPCs handle their own
//      audit writes for inside-transaction rejections; this is
//      strictly for outside-transaction rejections.
//
// The audit row event_type for handler rejections is one of:
//   - handler_validation_failed
//   - handler_origin_rejected
//   - handler_rate_limited
//   - handler_method_not_allowed
//
// Failure of the audit write logs to stderr and is otherwise
// silent — the user-visible 4xx still ships.

import { createHash } from "node:crypto";
import { after } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseServerClient } from "./supabase-server";
import type {
  AuthAuditEventType,
  AdminActionRejectedReason,
} from "./auth-audit";

const AUDIT_IP_HASH_SALT =
  process.env.AUDIT_IP_HASH_SALT || "clixsy-audit-default-salt-v1";

/**
 * The canonical request_metadata shape stamped on every audit row.
 *
 * - request_id: x-vercel-id header value when present, else a random
 *   UUID. Used to correlate audit rows with Vercel runtime logs.
 * - ip_hash: sha256(salt || raw_ip). NOT reversible to the raw IP
 *   even with the table contents leaked. Salt is fixed for the
 *   system's lifetime (operator's Q8 answer). Rotating the salt
 *   would invalidate IP-cluster forensics across the rotation
 *   boundary, which is acceptable since we don't do those forensics
 *   at Clixsy's scale.
 * - user_agent_class: a coarse classification (browser_chrome /
 *   browser_safari / browser_firefox / browser_edge / curl / other).
 *   Useful for "was this a real browser or a script?" without
 *   storing the raw UA.
 * - user_agent_sha256: full sha256 of the raw UA. Lets the audit
 *   log detect "same client" across requests without revealing the
 *   UA. Stored prefix-only (first 16 hex chars) for brevity.
 * - referer_host: hostname of the Referer header, or null. Full URL
 *   not stored (could contain a token in pathological cases — e.g.
 *   from an invite URL that the user pasted into a third-party
 *   page).
 * - vercel_deployment_id + vercel_region: from x-vercel-* headers.
 *   Useful for correlating audit anomalies with specific deploys
 *   or edge regions.
 */
export type RequestMetadata = {
  request_id: string;
  ip_hash: string | null;
  user_agent_class:
    | "browser_chrome"
    | "browser_safari"
    | "browser_firefox"
    | "browser_edge"
    | "curl"
    | "other";
  user_agent_sha256: string | null;
  referer_host: string | null;
  vercel_deployment_id: string | null;
  vercel_region: string | null;
};

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256")
    .update(AUDIT_IP_HASH_SALT)
    .update(":")
    .update(ip.trim())
    .digest("hex");
}

function classifyUserAgent(ua: string | null): RequestMetadata["user_agent_class"] {
  if (!ua) return "other";
  if (/curl\//i.test(ua)) return "curl";
  // Edge ships BEFORE Chrome in the UA string when it's actually Edge.
  if (/Edg\//.test(ua)) return "browser_edge";
  if (/Firefox\//.test(ua)) return "browser_firefox";
  // Chrome's UA always includes "Chrome/" and "Safari/"; Safari proper
  // includes "Version/" + "Safari/" without "Chrome/".
  if (/Chrome\//.test(ua)) return "browser_chrome";
  if (/Version\/.+Safari\//.test(ua)) return "browser_safari";
  return "other";
}

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Extract the client IP from the request. Vercel sets x-forwarded-for
 * with the client IP first, then any proxy chain. Trust only the first
 * entry; rest is uncontrolled.
 */
function extractIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;
  const first = xff.split(",")[0];
  return first ? first.trim() : null;
}

/**
 * Extract the Referer's hostname, if present and parseable.
 */
function extractRefererHost(req: NextRequest): string | null {
  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).hostname;
  } catch {
    return null;
  }
}

export function buildRequestMetadata(req: NextRequest): RequestMetadata {
  const ua = req.headers.get("user-agent");
  const vercelId = req.headers.get("x-vercel-id");
  // Generate a fallback request_id when x-vercel-id is absent (local dev).
  const requestId = vercelId ?? `local-${crypto.randomUUID()}`;
  return {
    request_id: requestId,
    ip_hash: hashIp(extractIp(req)),
    user_agent_class: classifyUserAgent(ua),
    user_agent_sha256: ua ? shortHash(ua) : null,
    referer_host: extractRefererHost(req),
    vercel_deployment_id: req.headers.get("x-vercel-deployment-url"),
    vercel_region: req.headers.get("x-vercel-region"),
  };
}

// =============================================================
// auditHandlerRejection — fire-and-forget handler-layer audit
// =============================================================
//
// Used for rejections that happen OUTSIDE the RPC transaction
// (zod fail / CSRF / rate-limit / method-not-allowed). These can't
// be written inside the RPC because the RPC never gets called.
//
// after()-based, so the audit insert happens in the post-response
// window. Failure logs to stderr — never throws.

export function auditHandlerRejection(args: {
  eventType: Extract<
    AuthAuditEventType,
    | "handler_validation_failed"
    | "handler_origin_rejected"
    | "handler_rate_limited"
    | "handler_method_not_allowed"
  >;
  actorEmail: string | null;
  endpoint: string;
  method: string;
  reason: AdminActionRejectedReason;
  additional?: Record<string, unknown>;
  requestMetadata: RequestMetadata;
}): void {
  const {
    eventType,
    actorEmail,
    endpoint,
    method,
    reason,
    additional,
    requestMetadata,
  } = args;
  after(async () => {
    try {
      const supabase = getSupabaseServerClient();
      const { error } = await supabase.from("auth_audit_events").insert({
        event_type: eventType,
        actor_email: actorEmail,
        payload: {
          endpoint,
          method,
          reason,
          request_metadata: requestMetadata,
          ...(additional ?? {}),
        },
      });
      if (error) {
        console.warn(
          `[audit-metadata] handler-rejection insert failed event_type=${eventType} error=${error.message}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[audit-metadata] handler-rejection insert threw event_type=${eventType} error=${message}`,
      );
    }
  });
}
