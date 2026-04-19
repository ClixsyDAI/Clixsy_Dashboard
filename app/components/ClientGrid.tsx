"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import MeetingPrepButton from "./MeetingPrepButton";
import TeamBadges from "./TeamBadges";
import type {
  ClientHealthSummary,
  TriageCounts,
} from "../lib/client-health-summary";

type Filter = "all" | "at-risk" | "needs-attention" | "strong" | "no-data";
type Sort = "risk" | "name" | "score-high" | "score-low" | "j-number";

interface ClientGridProps {
  summaries: ClientHealthSummary[];
  counts: TriageCounts;
  teamAssignments?: Record<string, string[]>;
}

function filterBucket(s: ClientHealthSummary): Filter {
  if (!s.hasData || !s.health) return "no-data";
  if (s.health.overall >= 70) return "strong";
  if (s.health.overall >= 40) return "needs-attention";
  return "at-risk";
}

/**
 * Map a 0–100 health score to a continuous hue on a red→yellow→green
 * gradient. 0 renders red, ~50 yellow, 100 green. Keeps saturation and
 * lightness fixed so every card reads at roughly the same visual weight,
 * regardless of score — only the hue shifts. Triage-strip buckets still
 * use the 3 discrete colors; the per-card circle is the fine-grained view.
 */
function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(100, score)) / 100;
  const hue = t * 120;
  return `hsl(${hue}, 70%, 48%)`;
}

function extractJCode(name: string): string {
  const m = name.match(/^J\d+/i);
  return m ? m[0] : "";
}

function jCodeNumber(name: string): number {
  const m = name.match(/^J(\d+)/i);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export default function ClientGrid({ summaries, counts, teamAssignments }: ClientGridProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<Sort>("risk");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const passesSearch = (s: ClientHealthSummary) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q);
    const passesFilter = (s: ClientHealthSummary) =>
      filter === "all" || filterBucket(s) === filter;

    const rows = summaries.filter((s) => passesSearch(s) && passesFilter(s));

    rows.sort((a, b) => {
      if (sortBy === "name") {
        return a.displayName.localeCompare(b.displayName);
      }
      if (sortBy === "j-number") {
        return jCodeNumber(a.name) - jCodeNumber(b.name);
      }
      // Risk / score sorts: no-data rows always sink to the bottom
      const aHas = a.hasData && a.health;
      const bHas = b.hasData && b.health;
      if (!aHas && !bHas) return 0;
      if (!aHas) return 1;
      if (!bHas) return -1;
      const aScore = a.health!.overall;
      const bScore = b.health!.overall;
      if (sortBy === "risk" || sortBy === "score-low") return aScore - bScore;
      if (sortBy === "score-high") return bScore - aScore;
      return 0;
    });

    return rows;
  }, [summaries, search, filter, sortBy]);

  return (
    <>
      {/* ── TRIAGE STRIP ────────────────────────────────────── */}
      <section
        className="mt-8 rounded-sm border p-4"
        style={{ backgroundColor: "#111111", borderColor: "#1a1a1a" }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "#888888" }}
          >
            Account Health
          </h2>
          <div
            className="h-4 w-[1px]"
            style={{ backgroundColor: "#333" }}
          />
          <TriageChip
            label={`${counts.atRisk} At Risk`}
            color="#e74c3c"
            active={filter === "at-risk"}
            onClick={() =>
              setFilter(filter === "at-risk" ? "all" : "at-risk")
            }
          />
          <TriageChip
            label={`${counts.needsAttention} Needs Attention`}
            color="#C8A882"
            active={filter === "needs-attention"}
            onClick={() =>
              setFilter(filter === "needs-attention" ? "all" : "needs-attention")
            }
          />
          <TriageChip
            label={`${counts.strong} Strong`}
            color="#2d6a4f"
            active={filter === "strong"}
            onClick={() => setFilter(filter === "strong" ? "all" : "strong")}
          />
          <TriageChip
            label={`${counts.noData} No Data`}
            color="#555555"
            active={filter === "no-data"}
            onClick={() => setFilter(filter === "no-data" ? "all" : "no-data")}
          />
          {filter !== "all" && (
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="ml-1 text-[11px] underline transition-colors hover:opacity-80"
              style={{ color: "#888888" }}
            >
              clear filter
            </button>
          )}
        </div>
      </section>

      {/* ── SEARCH + SORT CONTROLS ──────────────────────────── */}
      <div className="mt-4 mb-6 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search clients by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[260px] flex-1 rounded-sm border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[#C8A882]"
          style={{
            backgroundColor: "#111111",
            borderColor: "#333333",
            color: "#f0ede8",
            maxWidth: 420,
          }}
        />
        <label
          className="flex items-center gap-2 text-xs tracking-wide uppercase"
          style={{ color: "#888888" }}
        >
          Sort
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as Sort)}
            className="rounded-sm border px-3 py-2 text-xs outline-none transition-colors focus:border-[#C8A882]"
            style={{
              backgroundColor: "#111111",
              borderColor: "#333333",
              color: "#f0ede8",
            }}
          >
            <option value="risk">Risk first</option>
            <option value="score-high">Score: high → low</option>
            <option value="score-low">Score: low → high</option>
            <option value="name">Name (A→Z)</option>
            <option value="j-number">J-number</option>
          </select>
        </label>
        {(search || filter !== "all") && (
          <p className="text-xs" style={{ color: "#888888" }}>
            Showing {filtered.length} of {summaries.length}
          </p>
        )}
      </div>

      {/* ── GRID ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((s) => (
          <ClientCard
            key={s.id}
            summary={s}
            team={teamAssignments?.[String(s.id)] || []}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-sm" style={{ color: "#888888" }}>
            No clients match your search or filter.
          </p>
        </div>
      )}
    </>
  );
}

/* ── SUB-COMPONENTS ──────────────────────────────────────── */

function TriageChip({
  label,
  color,
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
      className="flex items-center gap-2 rounded-sm px-2.5 py-1 text-xs transition-all hover:opacity-90"
      style={{
        backgroundColor: active ? color : "transparent",
        border: `1px solid ${active ? color : "#2a2a2a"}`,
        color: active ? "#0a0a0a" : "#f0ede8",
        fontWeight: active ? 700 : 500,
      }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: active ? "#0a0a0a" : color }}
      />
      {label}
    </button>
  );
}

function ClientCard({ summary: s, team }: { summary: ClientHealthSummary; team: string[] }) {
  const jCode = extractJCode(s.name);
  const overall = s.health?.overall ?? null;
  const label = s.health?.label ?? null;

  // The whole card used to be a single <Link>, but we've added a Meeting
  // Prep button that opens a modal — a <button> inside a <Link> has weird
  // semantics and the modal click would also navigate. So the card is now
  // a styled <div>, and we expose TWO explicit targets:
  //   • a <Link> that covers the main body (j-code, score, name, desc)
  //   • a <MeetingPrepButton> in the footer that doesn't navigate
  return (
    <div
      className="group relative flex flex-col rounded-sm border transition-all hover:border-[#C8A882]"
      style={{
        backgroundColor: "#111111",
        borderColor: "#1a1a1a",
      }}
    >
      <Link
        href={`/client/${s.id}`}
        className="block flex-1 p-5 pb-0"
        aria-label={`Open dashboard for ${s.displayName}`}
      >
        {/* Top row: J-code + health score */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <span
            className="rounded-sm px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
            style={{
              backgroundColor: s.hasData
                ? "rgba(45, 106, 79, 0.15)"
                : "rgba(136, 136, 136, 0.1)",
              color: s.hasData ? "#2d6a4f" : "#555555",
            }}
          >
            {jCode || "—"}
          </span>
          {overall !== null ? (
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full"
              style={{
                backgroundColor: scoreColor(overall),
                boxShadow: `0 0 0 2px rgba(255,255,255,0.04), 0 2px 10px ${scoreColor(overall)}55`,
              }}
              title={`${overall}/100 — ${label}`}
            >
              <span
                className="text-base font-bold leading-none"
                style={{ color: "#0a0a0a" }}
              >
                {overall}
              </span>
            </div>
          ) : (
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-dashed"
              style={{ borderColor: "#333" }}
              title="No data"
            >
              <span className="text-sm" style={{ color: "#555" }}>
                —
              </span>
            </div>
          )}
        </div>

        {/* Client name */}
        <h3
          className="text-sm font-semibold leading-tight transition-colors group-hover:text-[#C8A882]"
          style={{ color: "#f0ede8" }}
        >
          {s.displayName}
        </h3>

        {/* Description */}
        <p
          className="mt-1.5 line-clamp-2 text-xs leading-relaxed"
          style={{ color: "#888888" }}
        >
          {s.description}
        </p>

        {/* Team members */}
        {team.length > 0 && (
          <div className="mt-2">
            <TeamBadges members={team} variant="compact" />
          </div>
        )}
      </Link>

      {/* Footer with Meeting Prep action + nav hint.
          Kept OUTSIDE the <Link> so clicking Meeting Prep doesn't navigate. */}
      <div className="flex items-center justify-between gap-2 px-5 pt-3 pb-4">
        {s.hasData ? (
          <MeetingPrepButton
            projectId={String(s.id)}
            projectName={s.displayName}
            variant="compact"
          />
        ) : (
          <span
            className="text-[10px] tracking-wide uppercase"
            style={{ color: "#555555" }}
          >
            No data yet
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {s.missingSources.length > 0 && s.hasData && (
            <span
              className="text-[9px] tracking-wide"
              style={{ color: "#555555" }}
              title={`Missing: ${s.missingSources.join(", ")}`}
            >
              -{s.missingSources.length} src
            </span>
          )}
          <Link
            href={`/client/${s.id}`}
            className="text-[10px] font-medium tracking-wide uppercase transition-colors hover:opacity-80"
            style={{ color: s.hasData ? "#C8A882" : "#555555" }}
          >
            View &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}

