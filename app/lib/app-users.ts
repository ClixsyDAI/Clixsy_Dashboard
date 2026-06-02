// =============================================================
// app-users — typed wrappers for the 8 PR D-1 mutation RPCs
// =============================================================
//
// Phase 1 PR D-1. Each function below corresponds to one RPC in
// migration 013. The wrapper:
//
//   - Takes typed args (no untyped jsonb at the call site)
//   - Calls supabase.rpc(...)
//   - Maps RPC sentinel responses to a typed discriminated union
//   - Translates Supabase errors to transient_error
//
// Route handlers consume the typed return; an `ok:true` carries
// the success fields, `ok:false` carries `{ status, reason }` for
// the response. The RPC itself wrote the audit row (success path)
// or the rejection audit (failure path) — handlers do NOT re-audit
// what the RPC already audited.
//
// Note: the RPC writes the audit row for rejections that REACH
// the RPC. Rejections BEFORE the RPC (zod fail / CSRF / rate-
// limit) are audited by the handler layer via auditHandlerRejection
// in audit-metadata.ts.

import { getSupabaseServerClient } from "./supabase-server";
import type { Role } from "./require-role";

// =============================================================
// Shared response type
// =============================================================

/**
 * Discriminated union returned from every RPC wrapper. Mirrors
 * the jsonb sentinel shape from the SQL side. `status` is the
 * HTTP status the route should respond with.
 */
export type RpcResult<TSuccess extends object> =
  | ({ ok: true } & TSuccess)
  | {
      ok: false;
      status: number;
      reason: string;
      transient?: boolean;
    };

function asRpcResult<T extends object>(
  raw: unknown,
): RpcResult<T> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ok !== "boolean") return null;
  if (r.ok === true) {
    return { ...(r as object), ok: true } as RpcResult<T>;
  }
  if (typeof r.status !== "number" || typeof r.reason !== "string") return null;
  return {
    ok: false,
    status: r.status,
    reason: r.reason,
  };
}

function transientError(): RpcResult<never> {
  return {
    ok: false,
    status: 503,
    reason: "service_unavailable",
    transient: true,
  };
}

// =============================================================
// approve_access_request
// =============================================================

export async function approveAccessRequest(args: {
  requestId: string;
  role: Role;
  actorEmail: string;
  actorSessionVersion: number;
  requestMetadata: Record<string, unknown>;
}): Promise<RpcResult<{ email: string; role: Role }>> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("approve_access_request", {
      p_request_id: args.requestId,
      p_role: args.role,
      p_actor_email: args.actorEmail,
      p_actor_session_version: args.actorSessionVersion,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(
        `[app-users] approve_access_request rpc error: ${error.message}`,
      );
      return transientError();
    }
    const result = asRpcResult<{ email: string; role: Role }>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] approve_access_request threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// deny_access_request
// =============================================================

export async function denyAccessRequest(args: {
  requestId: string;
  actorEmail: string;
  actorSessionVersion: number;
  requestMetadata: Record<string, unknown>;
}): Promise<RpcResult<Record<string, never>>> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("deny_access_request", {
      p_request_id: args.requestId,
      p_actor_email: args.actorEmail,
      p_actor_session_version: args.actorSessionVersion,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(
        `[app-users] deny_access_request rpc error: ${error.message}`,
      );
      return transientError();
    }
    const result = asRpcResult<Record<string, never>>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] deny_access_request threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// create_invite
// =============================================================

export async function createInvite(args: {
  email: string;
  role: Role;
  inviteTokenSha256: string;
  expiresAt: Date;
  actorEmail: string;
  actorSessionVersion: number;
  requestMetadata: Record<string, unknown>;
}): Promise<RpcResult<{ invite_id: string; expires_at: string }>> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_invite", {
      p_email: args.email,
      p_role: args.role,
      p_invite_token_sha256: args.inviteTokenSha256,
      p_expires_at: args.expiresAt.toISOString(),
      p_actor_email: args.actorEmail,
      p_actor_session_version: args.actorSessionVersion,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(`[app-users] create_invite rpc error: ${error.message}`);
      return transientError();
    }
    const result = asRpcResult<{ invite_id: string; expires_at: string }>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] create_invite threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// revoke_invite
// =============================================================

export async function revokeInvite(args: {
  inviteId: string;
  actorEmail: string;
  actorSessionVersion: number;
  requestMetadata: Record<string, unknown>;
}): Promise<RpcResult<{ noop?: boolean }>> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("revoke_invite", {
      p_invite_id: args.inviteId,
      p_actor_email: args.actorEmail,
      p_actor_session_version: args.actorSessionVersion,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(`[app-users] revoke_invite rpc error: ${error.message}`);
      return transientError();
    }
    const result = asRpcResult<{ noop?: boolean }>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] revoke_invite threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// accept_invite (unauth path)
// =============================================================

export async function acceptInvite(args: {
  inviteTokenSha256: string;
  authenticatedEmail: string;
  requestMetadata: Record<string, unknown>;
}): Promise<RpcResult<{ email: string; role: Role }>> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_invite", {
      p_invite_token_sha256: args.inviteTokenSha256,
      p_authenticated_email: args.authenticatedEmail,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(`[app-users] accept_invite rpc error: ${error.message}`);
      return transientError();
    }
    const result = asRpcResult<{ email: string; role: Role }>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] accept_invite threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// set_user_role
// =============================================================

export async function setUserRole(args: {
  targetEmail: string;
  newRole: Role;
  actorEmail: string;
  actorSessionVersion: number;
  requestMetadata: Record<string, unknown>;
}): Promise<
  RpcResult<{ before: { role: Role }; after: { role: Role } }>
> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("set_user_role", {
      p_target_email: args.targetEmail,
      p_new_role: args.newRole,
      p_actor_email: args.actorEmail,
      p_actor_session_version: args.actorSessionVersion,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(`[app-users] set_user_role rpc error: ${error.message}`);
      return transientError();
    }
    const result = asRpcResult<{ before: { role: Role }; after: { role: Role } }>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] set_user_role threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// disable_user
// =============================================================

export async function disableUser(args: {
  targetEmail: string;
  actorEmail: string;
  actorSessionVersion: number;
  requestMetadata: Record<string, unknown>;
}): Promise<RpcResult<Record<string, never>>> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("disable_user", {
      p_target_email: args.targetEmail,
      p_actor_email: args.actorEmail,
      p_actor_session_version: args.actorSessionVersion,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(`[app-users] disable_user rpc error: ${error.message}`);
      return transientError();
    }
    const result = asRpcResult<Record<string, never>>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] disable_user threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// enable_user
// =============================================================

export async function enableUser(args: {
  targetEmail: string;
  actorEmail: string;
  actorSessionVersion: number;
  requestMetadata: Record<string, unknown>;
}): Promise<RpcResult<Record<string, never>>> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("enable_user", {
      p_target_email: args.targetEmail,
      p_actor_email: args.actorEmail,
      p_actor_session_version: args.actorSessionVersion,
      p_request_metadata: args.requestMetadata,
    });
    if (error) {
      console.warn(`[app-users] enable_user rpc error: ${error.message}`);
      return transientError();
    }
    const result = asRpcResult<Record<string, never>>(data);
    return result ?? transientError();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-users] enable_user threw: ${message}`);
    return transientError();
  }
}

// =============================================================
// Read paths (no RPC wrapper — direct supabase queries from routes)
// =============================================================

export type AppUser = {
  email: string;
  role: Role;
  added_by: string | null;
  added_at: string;
  disabled_at: string | null;
  notes: string | null;
};

export type AppUserInvite = {
  id: string;
  email: string;
  role: Role;
  invited_by_email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AppAccessRequest = {
  id: string;
  email: string;
  attempted_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: "granted" | "denied" | null;
  email_verified_at_request_time: string | null;
};

export async function listAppUsers(): Promise<AppUser[] | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_users")
      .select("email, role, added_by, added_at, disabled_at, notes")
      .order("added_at", { ascending: false });
    if (error) {
      console.warn(`[app-users] listAppUsers error: ${error.message}`);
      return null;
    }
    return (data ?? []) as AppUser[];
  } catch (err) {
    console.warn(
      `[app-users] listAppUsers threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function listPendingInvites(): Promise<AppUserInvite[] | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_user_invites")
      .select(
        "id, email, role, invited_by_email, expires_at, accepted_at, revoked_at, created_at",
      )
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn(`[app-users] listPendingInvites error: ${error.message}`);
      return null;
    }
    return (data ?? []) as AppUserInvite[];
  } catch (err) {
    console.warn(
      `[app-users] listPendingInvites threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function listPendingAccessRequests(): Promise<
  AppAccessRequest[] | null
> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_access_requests")
      .select(
        "id, email, attempted_at, resolved_at, resolved_by, resolution, email_verified_at_request_time",
      )
      .is("resolved_at", null)
      .order("attempted_at", { ascending: false });
    if (error) {
      console.warn(
        `[app-users] listPendingAccessRequests error: ${error.message}`,
      );
      return null;
    }
    return (data ?? []) as AppAccessRequest[];
  } catch (err) {
    console.warn(
      `[app-users] listPendingAccessRequests threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
