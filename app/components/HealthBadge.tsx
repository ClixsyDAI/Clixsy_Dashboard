"use client";

/**
 * HealthBadge — compact account-health indicator for the per-client
 * dashboard header. Internal-only (not rendered on /share/[token]).
 *
 * Shows the overall 0-100 score inside a colored ring, the label under
 * it, and a hover tooltip with each sub-score. Clicking scrolls the AI
 * Report tab into view (where the full breakdown lives).
 */

import type { HealthScoreResult } from "../lib/health-score";

export default function HealthBadge({
  health,
  missingSources,
}: {
  health: HealthScoreResult;
  missingSources: string[];
}) {
  const { overall, label, color, subScores } = health;
  const circumference = 2 * Math.PI * 32; // r=32
  const dashOffset = circumference * (1 - overall / 100);

  const tooltip = [
    `Account Health: ${overall}/100 (${label})`,
    "",
    ...subScores.map(
      (s) =>
        `${s.available ? "●" : "○"} ${s.label}: ${
          s.available ? `${s.score}` : "no data"
        } (weight ${s.weight})`
    ),
    missingSources.length > 0 ? "" : "",
    missingSources.length > 0
      ? `Missing sources: ${missingSources.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className="flex items-center gap-3 rounded-sm border px-3 py-2"
      style={{ backgroundColor: "#111111", borderColor: "#1a1a1a" }}
      title={tooltip}
    >
      <div className="relative flex items-center justify-center">
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle
            cx="36"
            cy="36"
            r="32"
            fill="none"
            stroke="#222"
            strokeWidth="6"
          />
          <circle
            cx="36"
            cy="36"
            r="32"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 36 36)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <span
          className="absolute text-xl font-bold leading-none"
          style={{ color }}
        >
          {overall}
        </span>
      </div>
      <div className="flex flex-col">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "#888888" }}
        >
          Account Health
        </span>
        <span className="text-sm font-semibold" style={{ color }}>
          {label}
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          {subScores.map((s) => (
            <span
              key={s.id}
              title={`${s.label}: ${s.available ? s.score : "no data"}`}
              className="inline-block h-1.5 w-5 rounded-full"
              style={{
                backgroundColor: !s.available
                  ? "#2a2a2a"
                  : s.score >= 70
                    ? "#2d6a4f"
                    : s.score >= 40
                      ? "#C8A882"
                      : "#e74c3c",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
