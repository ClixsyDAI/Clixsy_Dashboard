import type { DetectedItem } from "../lib/win-flag-detection";

interface OverviewTopWinsProps {
  wins: DetectedItem[];
}

const SOURCE_COLORS: Record<string, string> = {
  Basecamp: "#60a5fa",
  GSC: "#34d399",
  GA4: "#c8a882",
  BrightLocal: "#e879f9",
};

export default function OverviewTopWins({ wins }: OverviewTopWinsProps) {
  return (
    <div className="rounded-sm p-5" style={{ backgroundColor: "#111111" }}>
      <h3
        className="mb-4 text-base font-semibold tracking-widest uppercase"
        style={{ color: "#2d6a4f" }}
      >
        Top Wins This Period
      </h3>
      {wins.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: "#666" }}>
          No standout wins detected this period
        </p>
      ) : (
        <ul className="space-y-3">
          {wins.map((w, i) => (
            <li
              key={i}
              className="rounded-sm border-l-2 px-3 py-2"
              style={{
                borderColor: SOURCE_COLORS[w.source] || "#c8a882",
                backgroundColor: "#181818",
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className="text-sm font-semibold"
                  style={{ color: "#f0ede8" }}
                >
                  {w.title}
                </span>
                <span
                  className="text-[10px] tracking-widest uppercase"
                  style={{ color: SOURCE_COLORS[w.source] || "#c8a882" }}
                >
                  {w.source}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "#888" }}>
                {w.detail}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
