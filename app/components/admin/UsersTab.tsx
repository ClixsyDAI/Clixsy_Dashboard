"use client";

// =============================================================
// UsersTab — super_admin user management tab inside /admin
// =============================================================
//
// Lives inside the existing admin shell at /admin and is rendered
// only for actors with role === 'super_admin'. Lower-role actors
// see a polite "no access" panel instead of the management UI.
//
// Four sub-sections:
//   (a) Add a user      — form: email + role -> POST /api/admin/users/add
//   (b) Active users    — GET /api/admin/users (client filter !disabled_at)
//                         per-row role change + disable
//   (c) Disabled users  — same GET, filter where disabled_at; re-enable
//   (d) Access requests — GET /api/admin/access-requests; approve / deny
//
// All API calls go through fetchWithAuth() from useAdminAuth so
// expired sessions surface the inline SignInPrompt instead of a
// raw 401 — matches the pattern set by AdminDashboard /
// EditForm earlier in the codebase.

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/app/components/onboarding/Modal";
import { useAdminAuth } from "@/app/lib/use-admin-auth";

/* ── Types ──────────────────────────────────────────────── */

type Role = "super_admin" | "admin" | "viewer";

const ROLE_OPTIONS: readonly Role[] = ["viewer", "admin", "super_admin"] as const;

export type ActorIdentity = {
  email: string;
  role: Role;
};

type AppUserRow = {
  email: string;
  role: Role;
  added_at: string;
  added_by: string | null;
  disabled_at: string | null;
};

type AccessRequestRow = {
  id: string;
  email: string;
  attempted_at: string;
  email_verified_at_request_time: string | null;
  resolved_at?: string | null;
};

type UsersListResponse = { users: AppUserRow[] };
type AccessRequestsListResponse = { requests: AccessRequestRow[] };
type ErrorResponse = { reason?: string; error?: string };

/* ── Error message mapping ──────────────────────────────── */
//
// The operator's plain-language reason map. The server emits
// machine-readable `reason` codes in the JSON body of 4xx
// responses; this maps them to wording an admin can act on.
function reasonToMessage(reason: string | undefined, fallbackVerb = "do that"): string {
  switch (reason) {
    case "email_already_in_users":
      return "That email is already on the list.";
    case "actor_session_stale":
      return "Your session expired, refresh and sign in again.";
    case "invalid_email":
      return "That doesn't look like a valid email.";
    case "invalid_role":
      return "Pick a valid access level.";
    case "validation_failed":
      return "Check the email and role and try again.";
    case "origin_rejected":
    case "rate_limited":
      return "Something blocked the request. Try again in a moment.";
    default:
      return `Couldn't ${fallbackVerb}. (${reason ?? "unknown"})`;
  }
}

/* ── Runtime narrows ────────────────────────────────────── */

function isAppUserRow(v: unknown): v is AppUserRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.email === "string" &&
    (r.role === "viewer" || r.role === "admin" || r.role === "super_admin") &&
    typeof r.added_at === "string" &&
    (r.added_by === null || typeof r.added_by === "string") &&
    (r.disabled_at === null || typeof r.disabled_at === "string")
  );
}

function isAccessRequestRow(v: unknown): v is AccessRequestRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.email === "string" &&
    typeof r.attempted_at === "string" &&
    (r.email_verified_at_request_time === null ||
      typeof r.email_verified_at_request_time === "string")
  );
}

/* ── Date formatting (compact, locale-safe) ─────────────── */

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ── Main component ─────────────────────────────────────── */

export function UsersTab({ actor }: { actor: ActorIdentity }) {
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();

  // Loaded server data + load/refresh state per data source.
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  // Granular in-flight flags so each section can show its own
  // "Refreshing..." banner without blocking the others.
  const [usersBusy, setUsersBusy] = useState(false);
  const [requestsBusy, setRequestsBusy] = useState(false);

  // Per-section transient error banners (fade after 6s).
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [activeSectionError, setActiveSectionError] = useState<string | null>(null);
  const [disabledSectionError, setDisabledSectionError] = useState<string | null>(null);
  const [requestsSectionError, setRequestsSectionError] = useState<string | null>(null);

  /* ── Loaders ──────────────────────────────────────────── */

  const loadUsers = useCallback(async () => {
    setUsersBusy(true);
    try {
      const res = await fetchWithAuth("/api/admin/users");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setUsersError(reasonToMessage(body.reason, "load users"));
        return;
      }
      const data = (await res.json()) as UsersListResponse;
      if (!Array.isArray(data.users)) {
        setUsersError("Couldn't load users. (bad response)");
        return;
      }
      const narrowed = data.users.filter(isAppUserRow);
      setUsers(narrowed);
      setUsersError(null);
    } catch (err) {
      // Sign-in cancelled (rejected by useAdminAuth) lands here too.
      const msg = err instanceof Error ? err.message : "Network error";
      setUsersError(`Couldn't load users. (${msg})`);
    } finally {
      setUsersBusy(false);
    }
  }, [fetchWithAuth]);

  const loadRequests = useCallback(async () => {
    setRequestsBusy(true);
    try {
      const res = await fetchWithAuth("/api/admin/access-requests");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setRequestsError(reasonToMessage(body.reason, "load access requests"));
        return;
      }
      const data = (await res.json()) as AccessRequestsListResponse;
      if (!Array.isArray(data.requests)) {
        setRequestsError("Couldn't load access requests. (bad response)");
        return;
      }
      const narrowed = data.requests.filter(isAccessRequestRow);
      setRequests(narrowed);
      setRequestsError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setRequestsError(`Couldn't load access requests. (${msg})`);
    } finally {
      setRequestsBusy(false);
    }
  }, [fetchWithAuth]);

  // Initial load — guarded by the super_admin check below, but
  // mounting the hooks unconditionally keeps the hook order stable
  // across the role gate's early return.
  useEffect(() => {
    if (actor.role !== "super_admin") return;
    void loadUsers();
    void loadRequests();
  }, [actor.role, loadUsers, loadRequests]);

  /* ── Auto-clear banners ───────────────────────────────── */

  useEffect(() => {
    if (!addSuccess) return;
    const t = setTimeout(() => setAddSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [addSuccess]);

  useEffect(() => {
    if (!addError) return;
    const t = setTimeout(() => setAddError(null), 6000);
    return () => clearTimeout(t);
  }, [addError]);

  useEffect(() => {
    if (!activeSectionError) return;
    const t = setTimeout(() => setActiveSectionError(null), 6000);
    return () => clearTimeout(t);
  }, [activeSectionError]);

  useEffect(() => {
    if (!disabledSectionError) return;
    const t = setTimeout(() => setDisabledSectionError(null), 6000);
    return () => clearTimeout(t);
  }, [disabledSectionError]);

  useEffect(() => {
    if (!requestsSectionError) return;
    const t = setTimeout(() => setRequestsSectionError(null), 6000);
    return () => clearTimeout(t);
  }, [requestsSectionError]);

  /* ── Derived lists ────────────────────────────────────── */

  const activeUsers = useMemo(
    () => users.filter((u) => !u.disabled_at),
    [users],
  );
  const disabledUsers = useMemo(
    () => users.filter((u) => !!u.disabled_at),
    [users],
  );
  const pendingRequests = useMemo(
    () => requests.filter((r) => !r.resolved_at),
    [requests],
  );

  /* ── Add user form state ──────────────────────────────── */

  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<Role>("viewer");
  const [addSubmitting, setAddSubmitting] = useState(false);

  const handleAddUser = useCallback(async () => {
    setAddError(null);
    setAddSuccess(null);
    const email = addEmail.trim().toLowerCase();
    if (!email) {
      setAddError("That doesn't look like a valid email.");
      return;
    }
    setAddSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/admin/users/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: addRole }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setAddError(reasonToMessage(body.reason, "add that user"));
        return;
      }
      setAddSuccess(`Added ${email}`);
      setAddEmail("");
      setAddRole("viewer");
      void loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setAddError(`Couldn't add that user. (${msg})`);
    } finally {
      setAddSubmitting(false);
    }
  }, [addEmail, addRole, fetchWithAuth, loadUsers]);

  /* ── Confirm modal state ──────────────────────────────── */

  type ConfirmState =
    | {
        kind: "disable";
        email: string;
      }
    | {
        kind: "demote_super_admin";
        email: string;
        nextRole: Role;
      }
    | {
        kind: "deny_request";
        requestId: string;
        email: string;
      };

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  /* ── Row actions: role change ─────────────────────────── */

  const performRoleChange = useCallback(
    async (email: string, nextRole: Role) => {
      try {
        const res = await fetchWithAuth(
          `/api/admin/users/${encodeURIComponent(email)}/role`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: nextRole }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ErrorResponse;
          setActiveSectionError(reasonToMessage(body.reason, "change role"));
          return;
        }
        void loadUsers();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setActiveSectionError(`Couldn't change role. (${msg})`);
      }
    },
    [fetchWithAuth, loadUsers],
  );

  const handleRoleDropdownChange = useCallback(
    (row: AppUserRow, nextRole: Role) => {
      if (nextRole === row.role) return;
      // Demoting a super_admin is high-stakes — confirm first.
      if (row.role === "super_admin" && nextRole !== "super_admin") {
        setConfirmState({
          kind: "demote_super_admin",
          email: row.email,
          nextRole,
        });
        return;
      }
      void performRoleChange(row.email, nextRole);
    },
    [performRoleChange],
  );

  /* ── Row actions: disable ─────────────────────────────── */

  const performDisable = useCallback(
    async (email: string) => {
      try {
        const res = await fetchWithAuth(
          `/api/admin/users/${encodeURIComponent(email)}/disable`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: `Disabled by ${actor.email}` }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ErrorResponse;
          setActiveSectionError(reasonToMessage(body.reason, "disable user"));
          return;
        }
        void loadUsers();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setActiveSectionError(`Couldn't disable user. (${msg})`);
      }
    },
    [actor.email, fetchWithAuth, loadUsers],
  );

  /* ── Row actions: enable ──────────────────────────────── */

  const handleEnable = useCallback(
    async (email: string) => {
      try {
        const res = await fetchWithAuth(
          `/api/admin/users/${encodeURIComponent(email)}/enable`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: `Re-enabled by ${actor.email}` }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ErrorResponse;
          setDisabledSectionError(reasonToMessage(body.reason, "re-enable user"));
          return;
        }
        void loadUsers();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setDisabledSectionError(`Couldn't re-enable user. (${msg})`);
      }
    },
    [actor.email, fetchWithAuth, loadUsers],
  );

  /* ── Row actions: access request approve / deny ──────── */

  const performApprove = useCallback(
    async (requestId: string, role: Role) => {
      try {
        const res = await fetchWithAuth(
          `/api/admin/access-requests/${encodeURIComponent(requestId)}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve", role }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ErrorResponse;
          setRequestsSectionError(reasonToMessage(body.reason, "approve request"));
          return;
        }
        // Approving may also add a row to users; refresh both.
        void loadRequests();
        void loadUsers();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setRequestsSectionError(`Couldn't approve request. (${msg})`);
      }
    },
    [fetchWithAuth, loadRequests, loadUsers],
  );

  const performDeny = useCallback(
    async (requestId: string) => {
      try {
        const res = await fetchWithAuth(
          `/api/admin/access-requests/${encodeURIComponent(requestId)}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deny" }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ErrorResponse;
          setRequestsSectionError(reasonToMessage(body.reason, "deny request"));
          return;
        }
        void loadRequests();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setRequestsSectionError(`Couldn't deny request. (${msg})`);
      }
    },
    [fetchWithAuth, loadRequests],
  );

  /* ── Confirm modal handler ────────────────────────────── */

  const handleConfirm = useCallback(async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      if (confirmState.kind === "disable") {
        await performDisable(confirmState.email);
      } else if (confirmState.kind === "demote_super_admin") {
        await performRoleChange(confirmState.email, confirmState.nextRole);
      } else if (confirmState.kind === "deny_request") {
        await performDeny(confirmState.requestId);
      }
    } finally {
      setConfirmBusy(false);
      setConfirmState(null);
    }
  }, [confirmState, performDeny, performDisable, performRoleChange]);

  /* ── Role gate ────────────────────────────────────────── */

  if (actor.role !== "super_admin") {
    return (
      <div
        className="rounded-sm border p-8 text-center"
        style={{ borderColor: "#333", color: "#888" }}
      >
        <p className="text-sm">You don&apos;t have access to this page.</p>
        <p className="mt-2 text-xs">Users management is super_admin-only.</p>
      </div>
    );
  }

  /* ── Confirm modal config ─────────────────────────────── */

  const confirmConfig = (() => {
    if (!confirmState) return null;
    if (confirmState.kind === "disable") {
      return {
        title: "Disable user",
        target: confirmState.email,
        action: "disable",
      };
    }
    if (confirmState.kind === "demote_super_admin") {
      return {
        title: "Demote super_admin",
        target: confirmState.email,
        action: `change role to ${confirmState.nextRole}`,
      };
    }
    return {
      title: "Deny access request",
      target: confirmState.email,
      action: "deny",
    };
  })();

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="space-y-8">
      {/* (a) Add a user */}
      <section
        className="rounded-sm border p-5"
        style={{ backgroundColor: "#111111", borderColor: "#1a1a1a" }}
      >
        <SectionHeading title="Add a user" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end">
          <FieldLabel label="Email">
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="name@clixsy.com"
              autoComplete="off"
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none transition-colors focus:border-[#C8A882]"
              style={{
                backgroundColor: "#111",
                borderColor: "#333",
                color: "#f0ede8",
              }}
            />
          </FieldLabel>
          <FieldLabel label="Role">
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as Role)}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none transition-colors focus:border-[#C8A882]"
              style={{
                backgroundColor: "#111",
                borderColor: "#333",
                color: "#f0ede8",
              }}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FieldLabel>
          <button
            type="button"
            onClick={() => void handleAddUser()}
            disabled={addSubmitting}
            className="h-[38px] rounded-sm px-5 text-xs font-semibold tracking-wide uppercase transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
          >
            {addSubmitting ? "Adding..." : "Add user"}
          </button>
        </div>
        {addSuccess && (
          <p className="mt-3 text-xs" style={{ color: "#6aa84f" }}>
            {addSuccess}
          </p>
        )}
        {addError && (
          <p className="mt-3 text-xs" style={{ color: "#e06666" }}>
            {addError}
          </p>
        )}
      </section>

      {/* (b) Active users */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionHeading title="Active users" inline />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "#555" }}>
            {activeUsers.length} active
          </span>
        </div>
        {usersBusy && <RefreshingBanner />}
        {usersError && <ErrorBanner message={usersError} />}
        {activeSectionError && <ErrorBanner message={activeSectionError} />}
        {activeUsers.length === 0 ? (
          <EmptyState message="No active users." />
        ) : (
          <div
            className="overflow-x-auto rounded-sm border"
            style={{ borderColor: "#1a1a1a" }}
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#1a1a1a" }}>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Added</Th>
                  <Th>Added by</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u, i) => {
                  const bg = i % 2 === 0 ? "#111111" : "#0e0e0e";
                  const isSelf = u.email === actor.email;
                  return (
                    <tr key={u.email} style={{ backgroundColor: bg }}>
                      <Td>
                        <span style={{ color: "#f0ede8" }}>{u.email}</span>
                        {isSelf && (
                          <span
                            className="ml-2 text-[10px] uppercase tracking-wider"
                            style={{ color: "#C8A882" }}
                          >
                            (you)
                          </span>
                        )}
                      </Td>
                      <Td>
                        <select
                          value={u.role}
                          onChange={(e) =>
                            handleRoleDropdownChange(u, e.target.value as Role)
                          }
                          className="rounded-sm border px-2 py-1 text-xs outline-none transition-colors focus:border-[#C8A882]"
                          style={{
                            backgroundColor: "#0a0a0a",
                            borderColor: "#333",
                            color: "#f0ede8",
                          }}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        <span style={{ color: "#888" }}>{fmtDate(u.added_at)}</span>
                      </Td>
                      <Td>
                        <span style={{ color: u.added_by ? "#888" : "#555" }}>
                          {u.added_by ?? "—"}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmState({ kind: "disable", email: u.email })
                          }
                          className="rounded-sm border px-3 py-1 text-[10px] font-semibold tracking-wide uppercase transition-colors hover:border-[#C8A882] hover:text-[#C8A882]"
                          style={{ borderColor: "#333", color: "#f0ede8" }}
                        >
                          Disable
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* (c) Disabled users */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionHeading title="Disabled users" inline />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "#555" }}>
            {disabledUsers.length} disabled
          </span>
        </div>
        {usersBusy && <RefreshingBanner />}
        {disabledSectionError && <ErrorBanner message={disabledSectionError} />}
        {disabledUsers.length === 0 ? (
          <EmptyState message="No disabled users." />
        ) : (
          <div
            className="overflow-x-auto rounded-sm border"
            style={{ borderColor: "#1a1a1a" }}
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#1a1a1a" }}>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Disabled at</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {disabledUsers.map((u, i) => {
                  const bg = i % 2 === 0 ? "#111111" : "#0e0e0e";
                  return (
                    <tr key={u.email} style={{ backgroundColor: bg }}>
                      <Td>
                        <span style={{ color: "#f0ede8" }}>{u.email}</span>
                      </Td>
                      <Td>
                        <span style={{ color: "#888" }}>{u.role}</span>
                      </Td>
                      <Td>
                        <span style={{ color: "#888" }}>
                          {u.disabled_at ? fmtDate(u.disabled_at) : "—"}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          onClick={() => void handleEnable(u.email)}
                          className="rounded-sm border px-3 py-1 text-[10px] font-semibold tracking-wide uppercase transition-colors hover:border-[#C8A882] hover:text-[#C8A882]"
                          style={{ borderColor: "#333", color: "#f0ede8" }}
                        >
                          Re-enable
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* (d) Access requests */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionHeading title="Access requests" inline />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "#555" }}>
            {pendingRequests.length} pending
          </span>
        </div>
        {requestsBusy && <RefreshingBanner />}
        {requestsError && <ErrorBanner message={requestsError} />}
        {requestsSectionError && <ErrorBanner message={requestsSectionError} />}
        {pendingRequests.length === 0 ? (
          <EmptyState message="No pending access requests." />
        ) : (
          <div
            className="overflow-x-auto rounded-sm border"
            style={{ borderColor: "#1a1a1a" }}
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#1a1a1a" }}>
                  <Th>Email</Th>
                  <Th>Requested</Th>
                  <Th>Email verified</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((r, i) => {
                  const bg = i % 2 === 0 ? "#111111" : "#0e0e0e";
                  const verified = !!r.email_verified_at_request_time;
                  return (
                    <tr key={r.id} style={{ backgroundColor: bg }}>
                      <Td>
                        <span style={{ color: "#f0ede8" }}>{r.email}</span>
                      </Td>
                      <Td>
                        <span style={{ color: "#888" }}>{fmtDate(r.attempted_at)}</span>
                      </Td>
                      <Td>
                        <span
                          style={{ color: verified ? "#6aa84f" : "#e06666" }}
                          className="text-xs uppercase tracking-wider"
                        >
                          {verified ? "yes" : "no"}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {ROLE_OPTIONS.map((role) => (
                            <button
                              key={role}
                              type="button"
                              onClick={() => void performApprove(r.id, role)}
                              className="rounded-sm border px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase transition-colors hover:border-[#C8A882] hover:text-[#C8A882]"
                              style={{ borderColor: "#333", color: "#f0ede8" }}
                            >
                              Approve as {role}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmState({
                                kind: "deny_request",
                                requestId: r.id,
                                email: r.email,
                              })
                            }
                            className="rounded-sm border px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase transition-colors hover:border-[#e06666] hover:text-[#e06666]"
                            style={{ borderColor: "#333", color: "#f0ede8" }}
                          >
                            Deny
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Confirmation modal — one shared dialog for disable / demote / deny */}
      <ConfirmModal
        open={!!confirmState && !!confirmConfig}
        title={confirmConfig?.title ?? ""}
        target={confirmConfig?.target ?? ""}
        action={confirmConfig?.action ?? ""}
        actor={actor.email}
        busy={confirmBusy}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          if (confirmBusy) return;
          setConfirmState(null);
        }}
      />

      {/* SignInPrompt portal from useAdminAuth — kicks in on 401 */}
      {signInPromptJsx}
    </div>
  );
}

/* ── ConfirmModal sub-component ─────────────────────────── */
//
// Single shared dialog used by Disable, Demote-super_admin, and
// Deny-request flows. Title + action verb change per caller; body
// always shows the target email and the actor's email so audit
// trail expectations are clear before the click.

function ConfirmModal({
  open,
  title,
  target,
  action,
  actor,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  target: string;
  action: string;
  actor: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      title={title}
      subtitle="This action will be recorded in the audit log."
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-sm border px-4 py-2 text-xs font-semibold tracking-wide uppercase transition-colors hover:border-[#888] disabled:opacity-40"
            style={{ borderColor: "#333", color: "#f0ede8", backgroundColor: "transparent" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-sm px-4 py-2 text-xs font-semibold tracking-wide uppercase transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
          >
            {busy ? "Working..." : "Confirm"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm" style={{ color: "#f0ede8" }}>
        <p>
          <span style={{ color: "#888" }}>Target: </span>
          <span style={{ color: "#f0ede8" }}>{target}</span>
        </p>
        <p>
          <span style={{ color: "#888" }}>Action: </span>
          <span style={{ color: "#f0ede8" }}>{action}</span>
        </p>
        <p>
          <span style={{ color: "#888" }}>by </span>
          <span style={{ color: "#f0ede8" }}>{actor}</span>
        </p>
      </div>
    </Modal>
  );
}

/* ── Small helpers (visual primitives) ──────────────────── */

function SectionHeading({
  title,
  inline = false,
}: {
  title: string;
  inline?: boolean;
}) {
  return (
    <h3
      className={
        inline
          ? "text-xs font-semibold tracking-widest uppercase"
          : "mb-4 text-xs font-semibold tracking-widest uppercase"
      }
      style={{ color: "#C8A882" }}
    >
      {title}
    </h3>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="mb-1 block text-[10px] font-semibold tracking-wider uppercase"
        style={{ color: "#888" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-semibold tracking-wide ${className}`}
      style={{ color: "#f0ede8" }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}

function RefreshingBanner() {
  return (
    <div
      className="mb-2 rounded-sm border px-3 py-1.5 text-[10px] uppercase tracking-wider"
      style={{ borderColor: "#1a1a1a", backgroundColor: "#111", color: "#888" }}
    >
      Refreshing...
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="mb-2 rounded-sm border px-3 py-2 text-xs"
      style={{
        borderColor: "rgba(224, 102, 102, 0.4)",
        backgroundColor: "rgba(224, 102, 102, 0.08)",
        color: "#e06666",
      }}
    >
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-sm border p-8 text-center"
      style={{ borderColor: "#1a1a1a", backgroundColor: "#0e0e0e" }}
    >
      <p className="text-sm" style={{ color: "#888" }}>
        {message}
      </p>
    </div>
  );
}
