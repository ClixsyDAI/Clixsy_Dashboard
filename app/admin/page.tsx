"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validateReturnPath } from "../lib/return-url";
import { formatClientDisplayName, type Project } from "../lib/projects";
import { useAdminAuth } from "../lib/use-admin-auth";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

/* ── Types ──────────────────────────────────────────────── */
interface TeamData {
  employees: string[];
  assignments: Record<string, string[]>;
}

/* ── Employee badge colours (matches lib/team-assignments) */
const COLORS: Record<string, string> = {
  Dorin: "#5b9bd5",
  Ovidiu: "#e06666",
  Andrei: "#6aa84f",
  Alina: "#d5a53b",
  Mubeen: "#9673d9",
  Naas: "#45b5b5",
  Johan: "#d96ba5",
  Mvelo: "#8cc152",
  Joel: "#e08c4a",
  Sadie: "#6b7fd9",
  Thys: "#c4c44a",
};

function color(name: string) {
  return COLORS[name] || "#888888";
}

/* ── Main Page ──────────────────────────────────────────── */
export default function AdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);

  // Phase 8 proper PR A: if /admin was opened with ?return=<path>,
  // capture it and follow once auth succeeds. Re-validated via the
  // shared helper (defence in depth: never trust a client-side
  // param). window.location.search is used instead of useSearchParams
  // to avoid the Next.js 16 Suspense-boundary requirement on the
  // hook — this component is already "use client" and this read
  // happens once on mount, no rerender on param change needed.
  const followReturnOrDefault = useCallback(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("return");
    const result = validateReturnPath(raw);
    if (result.ok) {
      router.replace(result.path);
    }
    // If invalid or absent: fall through to the existing
    // AdminDashboard render. The page will show the admin
    // dashboard as it did before.
  }, [router]);

  // On mount, check for an existing session
  useEffect(() => {
    const saved = sessionStorage.getItem("admin_token");
    if (saved) {
      fetch(`/api/admin/auth?token=${saved}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.valid) {
            setToken(saved);
            setAuthed(true);
            // Existing-session branch: if there's a return param,
            // follow it now without re-prompting. The GET above
            // refreshed the admin_token cookie (PR #20 behaviour),
            // so the proxy will let us through on the new page.
            followReturnOrDefault();
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [followReturnOrDefault]);

  const handleLogin = async () => {
    setAuthError("");
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const { token: t } = await res.json();
      sessionStorage.setItem("admin_token", t);
      setToken(t);
      setAuthed(true);
      // Fresh sign-in branch: POST set the admin_token cookie in
      // the response. Following the return param now lands the
      // user on the page they originally tried to reach.
      followReturnOrDefault();
    } else {
      setAuthError("Incorrect password");
    }
  };

  // Phase 1 PR B: kick off the Google OAuth handshake. Supabase
  // redirects the browser to Google with hd=clixsy.com so the
  // account picker is restricted to clixsy.com Workspace accounts.
  // The PKCE auth code lands on /admin/auth/callback which does
  // the email-domain + app_users checks before minting cookies.
  //
  // hd=clixsy.com is the PRIMARY enforcement layer because the
  // Google Cloud project that owns the OAuth client has an
  // External consent screen (see docs/phase1-oauth-setup.md).
  // The /admin/auth/callback route adds two more layers
  // (email_verified + email.endsWith('@clixsy.com')) for
  // belt-and-braces.
  const handleGoogleSignIn = async () => {
    setAuthError("");
    const supabase = getSupabaseBrowserClient();
    const origin = window.location.origin;
    const returnRaw = new URLSearchParams(window.location.search).get("return");
    const callbackUrl = returnRaw
      ? `${origin}/admin/auth/callback?return=${encodeURIComponent(returnRaw)}`
      : `${origin}/admin/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        queryParams: { hd: "clixsy.com" },
      },
    });
    if (error) {
      setAuthError(`Google sign-in failed: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "#0a0a0a" }}
      >
        <p style={{ color: "#888" }}>Loading...</p>
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen
      password={password}
      setPassword={setPassword}
      error={authError}
      onLogin={handleLogin}
      onGoogleSignIn={handleGoogleSignIn}
    />;
  }

  return <AdminDashboard token={token} />;
}

/* ── Login Screen ───────────────────────────────────────── */
function LoginScreen({
  password,
  setPassword,
  error,
  onLogin,
  onGoogleSignIn,
}: {
  password: string;
  setPassword: (v: string) => void;
  error: string;
  onLogin: () => void;
  onGoogleSignIn: () => void;
}) {
  // Hide the "← Dashboard" escape link when the user arrived here
  // via a return-URL flow. If they're being asked to sign in to
  // reach a specific page, "Dashboard" isn't a useful escape hatch
  // — it drops them at / and silently loses the ?return= param,
  // so the next /admin click (e.g. from the header) lands them at
  // Team Assignments instead of their original destination.
  //
  // Safe to read window inline: LoginScreen only renders after
  // AdminPage's loading-state useEffect completes (post-hydration),
  // so window is always defined here.
  const hasReturnParam =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("return");

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      <div
        className="w-full max-w-sm rounded-sm border p-8"
        style={{ backgroundColor: "#111111", borderColor: "#1a1a1a" }}
      >
        {!hasReturnParam && (
          <Link
            href="/"
            className="mb-6 flex items-center gap-3"
          >
            <img
              src="https://res.cloudinary.com/dovgh19xr/image/upload/v1766427227/new_logo_nvrux0.svg"
              alt="CLIXSY"
              className="h-7 w-auto"
            />
            <span
              className="text-xs tracking-wider uppercase"
              style={{ color: "#888" }}
            >
              &larr; Dashboard
            </span>
          </Link>
        )}
        <h1
          className="mb-1 text-lg font-bold tracking-wide uppercase"
          style={{ color: "#f0ede8" }}
        >
          Admin Access
        </h1>
        <p className="mb-6 text-xs" style={{ color: "#888" }}>
          Enter the admin password to manage team assignments.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onLogin()}
          placeholder="Password"
          className="mb-3 w-full rounded-sm border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[#C8A882]"
          style={{
            backgroundColor: "#0a0a0a",
            borderColor: "#333",
            color: "#f0ede8",
          }}
          autoFocus
        />
        {error && (
          <p className="mb-3 text-xs" style={{ color: "#e06666" }}>
            {error}
          </p>
        )}
        <button
          onClick={onLogin}
          className="w-full rounded-sm py-2.5 text-sm font-semibold tracking-wide uppercase transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
        >
          Sign In
        </button>
        <div
          className="my-4 flex items-center gap-3 text-[0.65rem] uppercase tracking-wider"
          style={{ color: "#555" }}
        >
          <div style={{ flex: 1, height: 1, backgroundColor: "#222" }} />
          <span>or</span>
          <div style={{ flex: 1, height: 1, backgroundColor: "#222" }} />
        </div>
        <button
          onClick={onGoogleSignIn}
          className="flex w-full items-center justify-center gap-2 rounded-sm py-2.5 text-sm font-semibold tracking-wide uppercase transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#0a0a0a", color: "#f0ede8", border: "1px solid #333" }}
        >
          <GoogleGlyph />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

/* ── Admin Dashboard ────────────────────────────────────── */
type AdminTab = "team" | "clients";

function AdminDashboard({ token }: { token: string }) {
  const [tab, setTab] = useState<AdminTab>("team");
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [search, setSearch] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("all");
  // Wraps save actions so an expired-mid-edit session prompts an
  // inline sign-in instead of dropping a generic error.
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();

  // Load projects + assignments on mount. Projects load from the
  // admin-gated /api/admin/clients (live master via getFileContents),
  // NOT from the bundled JSON — so an AM logging in 30s after a GHL
  // webhook fire sees the just-created entry without waiting for the
  // next Vercel redeploy.
  useEffect(() => {
    fetch("/api/team-assignments")
      .then((r) => r.json())
      .then((d) => setTeamData(d))
      .catch(() => {});
    fetch("/api/admin/clients", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.projects)) setProjects(d.projects as Project[]);
      })
      .catch(() => {});
  }, [token]);

  const handleToggle = useCallback(
    (projectId: string, employee: string) => {
      if (!teamData) return;
      setTeamData((prev) => {
        if (!prev) return prev;
        const current = prev.assignments[projectId] || [];
        let next: string[];
        if (current.includes(employee)) {
          next = current.filter((e) => e !== employee);
        } else {
          if (current.length >= 3) return prev; // max 3
          next = [...current, employee];
        }
        return {
          ...prev,
          assignments: { ...prev.assignments, [projectId]: next },
        };
      });
      setDirty(true);
      setSaveMsg("");
    },
    [teamData]
  );

  const handleSave = async () => {
    if (!teamData) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetchWithAuth("/api/team-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamData),
      });
      if (res.ok) {
        setDirty(false);
        setSaveMsg("Saved successfully");
      } else {
        const err = await res.json();
        setSaveMsg(err.error || "Save failed");
      }
    } catch {
      setSaveMsg("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("admin_token");
    window.location.reload();
  };

  const filtered = useMemo(() => {
    if (!projects.length || !teamData) return [];
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => {
        // Match the search query against the formatted display name so AMs
        // can type "J153" (or just "153") to find a project.
        if (q && !formatClientDisplayName(p).toLowerCase().includes(q)) return false;
        if (filterEmployee !== "all") {
          const team = teamData.assignments[String(p.id)] || [];
          if (filterEmployee === "unassigned") return team.length === 0;
          return team.includes(filterEmployee);
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, search, filterEmployee, teamData]);

  // Calculate per-employee client counts (must stay before early return)
  const employeeCounts = useMemo(() => {
    if (!teamData) return {};
    const counts: Record<string, number> = {};
    teamData.employees.forEach((e) => (counts[e] = 0));
    Object.values(teamData.assignments).forEach((team) => {
      (team as string[]).forEach((e) => {
        counts[e] = (counts[e] || 0) + 1;
      });
    });
    return counts;
  }, [teamData]);

  const unassignedCount = useMemo(() => {
    if (!teamData) return 0;
    return Object.values(teamData.assignments).filter(
      (t) => (t as string[]).length === 0
    ).length;
  }, [teamData]);

  if (!teamData) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "#0a0a0a" }}
      >
        <p style={{ color: "#888" }}>Loading assignments...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <img
                  src="https://res.cloudinary.com/dovgh19xr/image/upload/v1766427227/new_logo_nvrux0.svg"
                  alt="CLIXSY"
                  className="h-8 w-auto"
                />
              </Link>
              <div>
                <h1
                  className="text-2xl font-bold tracking-wide uppercase"
                  style={{ color: "#ffffff", letterSpacing: "0.05em" }}
                >
                  Admin
                </h1>
                <p className="text-xs" style={{ color: "#888" }}>
                  {tab === "team"
                    ? `${projects.length} clients · ${teamData.employees.length} team members`
                    : `${projects.length} clients · edit name, J-number, description`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="rounded-sm border px-4 py-2 text-xs font-medium tracking-wide uppercase transition-colors hover:border-[#C8A882]"
                style={{ borderColor: "#333", color: "#888" }}
              >
                &larr; Dashboard
              </Link>
              <button
                onClick={handleLogout}
                className="rounded-sm border px-4 py-2 text-xs font-medium tracking-wide uppercase transition-colors hover:border-[#e06666]"
                style={{ borderColor: "#333", color: "#888" }}
              >
                Sign Out
              </button>
            </div>
          </div>
          <div
            className="mt-4 h-[2px] w-full"
            style={{ backgroundColor: "#C8A882" }}
          />
        </header>

        {/* Tab strip */}
        <nav
          className="mb-6 flex gap-1 border-b"
          style={{ borderColor: "#1a1a1a" }}
        >
          <TabButton
            label="Team Assignments"
            active={tab === "team"}
            onClick={() => setTab("team")}
          />
          <TabButton
            label="Edit Clients"
            active={tab === "clients"}
            onClick={() => setTab("clients")}
          />
        </nav>

        {tab === "clients" && (
          <ClientEditorView
            projects={projects}
            setProjects={setProjects}
          />
        )}

        {tab === "team" && (
        <>
        {/* Employee summary strip */}
        <section
          className="mb-6 rounded-sm border p-4"
          style={{ backgroundColor: "#111111", borderColor: "#1a1a1a" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className="mr-2 text-xs font-semibold tracking-widest uppercase"
              style={{ color: "#888" }}
            >
              Team
            </h2>
            <div className="h-4 w-[1px]" style={{ backgroundColor: "#333" }} />
            <FilterChip
              label={`All (${projects.length})`}
              active={filterEmployee === "all"}
              color="#C8A882"
              onClick={() => setFilterEmployee("all")}
            />
            {teamData.employees.map((emp) => (
              <FilterChip
                key={emp}
                label={`${emp} (${employeeCounts[emp] || 0})`}
                active={filterEmployee === emp}
                color={color(emp)}
                onClick={() =>
                  setFilterEmployee(filterEmployee === emp ? "all" : emp)
                }
              />
            ))}
            <FilterChip
              label={`Unassigned (${unassignedCount})`}
              active={filterEmployee === "unassigned"}
              color="#555"
              onClick={() =>
                setFilterEmployee(
                  filterEmployee === "unassigned" ? "all" : "unassigned"
                )
              }
            />
          </div>
        </section>

        {/* Search + Save bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[240px] flex-1 rounded-sm border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[#C8A882]"
            style={{
              backgroundColor: "#111",
              borderColor: "#333",
              color: "#f0ede8",
              maxWidth: 380,
            }}
          />
          <div className="flex items-center gap-3">
            {saveMsg && (
              <span
                className="text-xs"
                style={{
                  color: saveMsg === "Saved successfully" ? "#6aa84f" : "#e06666",
                }}
              >
                {saveMsg}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="rounded-sm px-6 py-2.5 text-sm font-semibold tracking-wide uppercase transition-opacity disabled:opacity-40"
              style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
            >
              {saving ? "Saving..." : dirty ? "Save Changes" : "Saved"}
            </button>
          </div>
        </div>

        {/* Assignment table */}
        <div
          className="overflow-x-auto rounded-sm border"
          style={{ borderColor: "#1a1a1a" }}
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ backgroundColor: "#1a1a1a" }}>
                <th
                  className="sticky left-0 z-10 px-4 py-3 text-xs font-semibold tracking-wide"
                  style={{ color: "#f0ede8", backgroundColor: "#1a1a1a", minWidth: 220 }}
                >
                  Client
                </th>
                {teamData.employees.map((emp) => (
                  <th
                    key={emp}
                    className="px-2 py-3 text-center text-[10px] font-semibold tracking-wide uppercase"
                    style={{ color: color(emp), minWidth: 72 }}
                  >
                    {emp}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const team = teamData.assignments[String(p.id)] || [];
                return (
                  <tr
                    key={p.id}
                    style={{
                      backgroundColor: i % 2 === 0 ? "#111111" : "#0e0e0e",
                    }}
                  >
                    <td
                      className="sticky left-0 z-10 px-4 py-2.5"
                      style={{
                        backgroundColor: i % 2 === 0 ? "#111111" : "#0e0e0e",
                      }}
                    >
                      <span
                        className="text-sm font-medium"
                        style={{ color: "#f0ede8" }}
                      >
                        {formatClientDisplayName(p)}
                      </span>
                    </td>
                    {teamData.employees.map((emp) => {
                      const active = team.includes(emp);
                      const atMax = team.length >= 3 && !active;
                      return (
                        <td key={emp} className="px-2 py-2.5 text-center">
                          <button
                            onClick={() => handleToggle(String(p.id), emp)}
                            disabled={atMax}
                            className="mx-auto flex h-7 w-7 items-center justify-center rounded-sm transition-all"
                            style={{
                              backgroundColor: active
                                ? `${color(emp)}33`
                                : "transparent",
                              border: active
                                ? `2px solid ${color(emp)}`
                                : "1px solid #2a2a2a",
                              opacity: atMax ? 0.25 : 1,
                              cursor: atMax ? "not-allowed" : "pointer",
                            }}
                            title={
                              atMax
                                ? "Max 3 members per client"
                                : active
                                  ? `Remove ${emp}`
                                  : `Assign ${emp}`
                            }
                          >
                            {active && (
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 14 14"
                                fill="none"
                              >
                                <path
                                  d="M3 7L6 10L11 4"
                                  stroke={color(emp)}
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm" style={{ color: "#888" }}>
              No clients match your search or filter.
            </p>
          </div>
        )}

        <footer className="mt-8 pb-8">
          <div className="h-[1px] w-full" style={{ backgroundColor: "#1a1a1a" }} />
          <p className="mt-4 text-xs italic" style={{ color: "#888" }}>
            Click a cell to toggle assignment. Maximum 3 team members per client.
            Changes are saved to Vercel Blob storage when you click Save.
          </p>
        </footer>
        </>
        )}
      </div>
      {signInPromptJsx}
    </div>
  );
}

/* ── TabButton ──────────────────────────────────────────── */
function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-b-2 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase transition-colors"
      style={{
        borderColor: active ? "#C8A882" : "transparent",
        color: active ? "#f0ede8" : "#888",
      }}
    >
      {label}
    </button>
  );
}

/* ── ClientEditorView ───────────────────────────────────── */
function ClientEditorView({
  projects,
  setProjects,
}: {
  projects: Project[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
}) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!projects.length) return [];
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => {
        if (!q) return true;
        return (
          formatClientDisplayName(p).toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q)
        );
      })
      // J-number ASC, then bare name. Numeric sort so J9 < J100; entries
      // with j_number=null (fresh GHL-created) sink to the end.
      .sort((a, b) => {
        const an = a.j_number ? parseInt(a.j_number, 10) : Number.MAX_SAFE_INTEGER;
        const bn = b.j_number ? parseInt(b.j_number, 10) : Number.MAX_SAFE_INTEGER;
        if (an !== bn) return an - bn;
        return a.name.localeCompare(b.name);
      });
  }, [projects, search]);

  return (
    <div>
      {/* Search bar (matches team-assignments search styling) */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, J-number, id, or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[260px] flex-1 rounded-sm border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[#C8A882]"
          style={{
            backgroundColor: "#111",
            borderColor: "#333",
            color: "#f0ede8",
            maxWidth: 480,
          }}
        />
        <p className="text-xs" style={{ color: "#888" }}>
          {search ? `${filtered.length} of ${projects.length}` : `${projects.length} clients`}
        </p>
      </div>

      {/* Client table */}
      <div
        className="overflow-x-auto rounded-sm border"
        style={{ borderColor: "#1a1a1a" }}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: "#1a1a1a" }}>
              <th className="px-4 py-3 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                Client
              </th>
              <th className="px-4 py-3 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8", width: 90 }}>
                J-number
              </th>
              <th className="px-4 py-3 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
                Description
              </th>
              <th className="px-4 py-3 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8", width: 120 }}>
                Vertical
              </th>
              <th className="px-4 py-3 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8", width: 90 }}>
                Edit
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const isEditing = editingId === p.id;
              const rowBg = i % 2 === 0 ? "#111" : "#0e0e0e";
              return (
                <Fragment key={p.id}>
                  <tr style={{ backgroundColor: rowBg }}>
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-medium" style={{ color: "#f0ede8" }}>
                        {formatClientDisplayName(p)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm" style={{ color: p.j_number ? "#f0ede8" : "#555" }}>
                      {p.j_number ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: p.description ? "#888" : "#555" }}>
                      {p.description ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <VerticalBadge vertical={p.vertical} />
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => setEditingId(isEditing ? null : p.id)}
                        className="rounded-sm border px-3 py-1 text-[10px] font-semibold tracking-wide uppercase transition-colors hover:border-[#C8A882] hover:text-[#C8A882]"
                        style={{ borderColor: "#333", color: "#f0ede8" }}
                      >
                        {isEditing ? "Close" : "Edit"}
                      </button>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr style={{ backgroundColor: "#0a0a0a" }}>
                      <td colSpan={5} className="px-4 py-4">
                        <EditForm
                          project={p}
                          onSaved={(updated) => {
                            setProjects((prev) =>
                              prev.map((row) => (row.id === updated.id ? updated : row)),
                            );
                            setEditingId(null);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm" style={{ color: "#888" }}>
            No clients match your search.
          </p>
        </div>
      )}

      <footer className="mt-8 pb-8">
        <div className="h-[1px] w-full" style={{ backgroundColor: "#1a1a1a" }} />
        <p className="mt-4 text-xs italic" style={{ color: "#888" }}>
          Edits commit a new `sync: update projects manifest` commit. The
          dashboard home page picks up changes 1-2 minutes later when Vercel
          finishes the auto-redeploy.
        </p>
      </footer>
    </div>
  );
}

/* ── VerticalBadge ──────────────────────────────────────── */
function VerticalBadge({ vertical }: { vertical: Project["vertical"] }) {
  const palette: Record<Project["vertical"], { bg: string; fg: string }> = {
    law_firm: { bg: "rgba(91, 155, 213, 0.15)", fg: "#5b9bd5" },
    home_services: { bg: "rgba(106, 168, 79, 0.15)", fg: "#6aa84f" },
    other: { bg: "rgba(136, 136, 136, 0.15)", fg: "#888" },
  };
  const c = palette[vertical];
  return (
    <span
      className="inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {vertical.replace("_", " ")}
    </span>
  );
}

/* ── EditForm ───────────────────────────────────────────── */
function EditForm({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (updated: Project) => void;
}) {
  const [name, setName] = useState(project.name);
  const [jNumber, setJNumber] = useState(project.j_number ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fetchWithAuth, signInPromptJsx } = useAdminAuth();

  // Block save if j_number has non-digit content. The server-side Zod
  // schema enforces this too — the UI hint mirrors it so the AM sees
  // the problem before submitting.
  const jNumberInvalid = jNumber.length > 0 && !/^\d+$/.test(jNumber);
  const nameInvalid = name.trim().length === 0;
  const canSave = !nameInvalid && !jNumberInvalid && !saving;

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${project.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          j_number: jNumber.trim() || null,
          description: description.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      onSaved(body.updated as Project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Editable fields */}
      <div className="space-y-3">
        <h4
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "#C8A882" }}
        >
          Editable
        </h4>
        <Field label="Client name (J-prefix excluded)">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-sm border px-3 py-2 text-sm outline-none transition-colors focus:border-[#C8A882]"
            style={{
              backgroundColor: "#0a0a0a",
              borderColor: nameInvalid ? "#e06666" : "#333",
              color: "#f0ede8",
            }}
          />
        </Field>
        <Field label="J-number (digits only, blank if unassigned)">
          <input
            type="text"
            inputMode="numeric"
            placeholder="412"
            value={jNumber}
            onChange={(e) => setJNumber(e.target.value)}
            className="w-full rounded-sm border px-3 py-2 text-sm outline-none transition-colors focus:border-[#C8A882]"
            style={{
              backgroundColor: "#0a0a0a",
              borderColor: jNumberInvalid ? "#e06666" : "#333",
              color: "#f0ede8",
            }}
          />
          {jNumberInvalid && (
            <p className="mt-1 text-[10px]" style={{ color: "#e06666" }}>
              J-number must contain digits only
            </p>
          )}
        </Field>
        <Field label="Description (free text)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-sm border px-3 py-2 text-sm outline-none transition-colors focus:border-[#C8A882]"
            style={{
              backgroundColor: "#0a0a0a",
              borderColor: "#333",
              color: "#f0ede8",
              resize: "vertical",
            }}
          />
        </Field>
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-sm px-4 py-2 text-xs font-semibold tracking-wide uppercase transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {error && (
            <span className="text-xs" style={{ color: "#e06666" }}>
              {error}
            </span>
          )}
        </div>
      </div>

      {/* Read-only context */}
      <div className="space-y-3">
        <h4
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "#555" }}
        >
          Read-only context
        </h4>
        <Field label="Workbook id">
          <div
            className="w-full rounded-sm border px-3 py-2 font-mono text-xs"
            style={{ backgroundColor: "#0a0a0a", borderColor: "#222", color: "#888" }}
          >
            {project.id}
          </div>
        </Field>
        <Field label="Vertical">
          <VerticalBadge vertical={project.vertical} />
        </Field>
        <Field label="GHL contact id">
          <div
            className="w-full rounded-sm border px-3 py-2 font-mono text-xs"
            style={{ backgroundColor: "#0a0a0a", borderColor: "#222", color: project.ghl_contact_id ? "#888" : "#555" }}
          >
            {project.ghl_contact_id ?? "—"}
          </div>
        </Field>
        <Field label="GHL user id (assigned to)">
          <div
            className="w-full rounded-sm border px-3 py-2 font-mono text-xs"
            style={{ backgroundColor: "#0a0a0a", borderColor: "#222", color: project.am_ghl_user_id ? "#888" : "#555" }}
          >
            {project.am_ghl_user_id ?? "—"}
          </div>
        </Field>
        <Field label="Website URL">
          <div
            className="w-full break-all rounded-sm border px-3 py-2 text-xs"
            style={{ backgroundColor: "#0a0a0a", borderColor: "#222", color: project.website_url ? "#888" : "#555" }}
          >
            {project.website_url ?? "—"}
          </div>
        </Field>
      </div>
      {signInPromptJsx}
    </div>
  );
}

/* ── Field (label wrapper) ──────────────────────────────── */
function Field({ label, children }: { label: string; children: ReactNode }) {
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

/* ── FilterChip ─────────────────────────────────────────── */
function FilterChip({
  label,
  color: c,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-all hover:opacity-90"
      style={{
        backgroundColor: active ? c : "transparent",
        border: `1px solid ${active ? c : "#2a2a2a"}`,
        color: active ? "#0a0a0a" : "#f0ede8",
        fontWeight: active ? 700 : 500,
      }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: active ? "#0a0a0a" : c }}
      />
      {label}
    </button>
  );
}
