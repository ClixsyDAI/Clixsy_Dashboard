"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validateReturnPath } from "../lib/return-url";
import type { Project } from "../lib/projects";

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
}: {
  password: string;
  setPassword: (v: string) => void;
  error: string;
  onLogin: () => void;
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      <div
        className="w-full max-w-sm rounded-sm border p-8"
        style={{ backgroundColor: "#111111", borderColor: "#1a1a1a" }}
      >
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
      </div>
    </div>
  );
}

/* ── Admin Dashboard ────────────────────────────────────── */
function AdminDashboard({ token }: { token: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [search, setSearch] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("all");

  // Load projects + assignments on mount
  useEffect(() => {
    fetch("/api/team-assignments")
      .then((r) => r.json())
      .then((d) => setTeamData(d))
      .catch(() => {});
    import("../data/projects.json").then((m) => setProjects(m.default as Project[]));
  }, []);

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
      const res = await fetch("/api/team-assignments", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
        if (q && !p.name.toLowerCase().includes(q)) return false;
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
                  Team Assignments
                </h1>
                <p className="text-xs" style={{ color: "#888" }}>
                  {projects.length} clients &middot;{" "}
                  {teamData.employees.length} team members
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
                        {p.name}
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
      </div>
    </div>
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
