"use client";

interface BrightLocalLocation {
  locationId: number;
  locationName: string;
  ref: string;
  clientName: string;
  city: string;
  lsrcUp: number;
  lsrcDown: number;
  lsrcNew: number;
  lsrcAvgGoogleRank: number;
  lsrcAvgGoogleRankChange: number;
  lsgAllKeywordAvg: number;
  lsgAllKeywordAvgChange: number;
  ctScore: number;
  ctLive: number;
  ctLiveChange: number;
  rmRating: number;
  rmTotal: number;
  gmbCalls: number;
  gmbTotal: number;
}

interface CitationReport {
  reportId: number;
  reportName: string;
  locationId: number;
  city: string;
  address: string;
  liveCitations: number;
  citationsChange: number;
  totalSources: number;
  lastRun: string;
}

interface BrightLocalPanelProps {
  locationCount: number;
  locations: BrightLocalLocation[];
  totalRankingsUp: number;
  totalRankingsDown: number;
  totalCitations: number;
  totalGmbCalls: number;
  totalGmbInteractions: number;
  avgGoogleRank: number;
  avgLsgRank: number;
  reviewRating: number;
  totalReviews: number;
  citations: CitationReport[];
  mainLocationName?: string | null;
  mainGridImage?: string | null;
  mainGridCapturedAt?: string | null;
}

function ChangeIndicator({ value, inverse = false }: { value: number; inverse?: boolean }) {
  if (!value || value === 0) return <span style={{ color: "#666" }}>-</span>;
  const isPositive = inverse ? value < 0 : value > 0;
  const color = isPositive ? "#2d6a4f" : "#e74c3c";
  const arrow = isPositive ? "\u25B2" : "\u25BC";
  return (
    <span style={{ color, fontSize: 11 }}>
      {arrow} {Math.abs(value).toFixed(1)}
    </span>
  );
}

export default function BrightLocalPanel({
  locationCount,
  locations,
  totalRankingsUp,
  totalRankingsDown,
  totalCitations,
  totalGmbCalls,
  totalGmbInteractions,
  avgGoogleRank,
  avgLsgRank,
  reviewRating,
  totalReviews,
  citations,
  mainLocationName,
  mainGridImage,
  mainGridCapturedAt,
}: BrightLocalPanelProps) {
  return (
    <div>
      {/* KPI Summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
        <KpiBox value={locationCount.toString()} label="LOCATIONS" />
        <KpiBox
          value={totalRankingsUp.toString()}
          label="RANKINGS UP"
          valueColor="#2d6a4f"
          icon="\u25B2"
        />
        <KpiBox
          value={totalRankingsDown.toString()}
          label="RANKINGS DOWN"
          valueColor="#e74c3c"
          icon="\u25BC"
        />
        <KpiBox value={avgGoogleRank > 0 ? avgGoogleRank.toString() : "-"} label="AVG GOOGLE RANK" accent />
        <KpiBox value={avgLsgRank > 0 ? avgLsgRank.toString() : "-"} label="GRID AVG RANK" accent />
        <KpiBox value={totalCitations.toString()} label="LIVE CITATIONS" />
        <KpiBox value={reviewRating > 0 ? reviewRating.toString() : "-"} label="AVG STAR RATING" />
        <KpiBox value={totalReviews.toString()} label="TOTAL REVIEWS" />
        <KpiBox value={totalGmbCalls.toString()} label="GBP CALLS" accent />
        <KpiBox value={totalGmbInteractions.toString()} label="GBP INTERACTIONS" accent />
      </div>

      {/* Main location grid screenshot */}
      {mainGridImage && (
        <div className="mt-8">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
              LOCAL SEARCH GRID — {mainLocationName || "Main Location"}
            </h3>
            {mainGridCapturedAt && (
              <span className="text-[11px]" style={{ color: "#666" }}>
                Captured {new Date(mainGridCapturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
          <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
          <div className="mt-3 rounded-sm p-2" style={{ backgroundColor: "#111111" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mainGridImage}
              alt={`Local Search Grid for ${mainLocationName || "main location"}`}
              className="mx-auto block max-w-full rounded-sm"
            />
          </div>
        </div>
      )}

      {/* Location Table */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
          LOCATIONS
        </h3>
        <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ backgroundColor: "#1a1a1a" }}>
                <Th>Location</Th>
                <Th>City</Th>
                <Th className="text-center">Avg Google Rank</Th>
                <Th className="text-center">Grid Avg</Th>
                <Th className="text-center">Rankings Up</Th>
                <Th className="text-center">Rankings Down</Th>
                <Th className="text-center">Citations</Th>
                <Th className="text-center">Rating</Th>
                <Th className="text-center">Reviews</Th>
                <Th className="text-center">GBP Calls</Th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => (
                <tr
                  key={loc.locationId}
                  style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}
                >
                  <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8", maxWidth: 250 }}>
                    <div className="truncate" title={loc.locationName}>
                      {loc.locationName}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: "#888" }}>
                    {loc.city}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span style={{ color: "#f0ede8" }}>
                      {loc.lsrcAvgGoogleRank > 0 ? loc.lsrcAvgGoogleRank.toFixed(1) : "-"}
                    </span>
                    {loc.lsrcAvgGoogleRankChange !== 0 && (
                      <span className="ml-1">
                        <ChangeIndicator value={-loc.lsrcAvgGoogleRankChange} inverse />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span style={{ color: "#C8A882" }}>
                      {loc.lsgAllKeywordAvg > 0 ? loc.lsgAllKeywordAvg.toFixed(1) : "-"}
                    </span>
                    {loc.lsgAllKeywordAvgChange !== 0 && (
                      <span className="ml-1">
                        <ChangeIndicator value={loc.lsgAllKeywordAvgChange} />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center font-bold" style={{ color: "#2d6a4f" }}>
                    {loc.lsrcUp > 0 ? `+${loc.lsrcUp}` : "-"}
                  </td>
                  <td className="px-3 py-2 text-center font-bold" style={{ color: "#e74c3c" }}>
                    {loc.lsrcDown > 0 ? `-${loc.lsrcDown}` : "-"}
                  </td>
                  <td className="px-3 py-2 text-center" style={{ color: "#888" }}>
                    {loc.ctLive || "-"}
                  </td>
                  <td className="px-3 py-2 text-center" style={{ color: loc.rmRating >= 4.5 ? "#2d6a4f" : loc.rmRating >= 4 ? "#C8A882" : "#888" }}>
                    {loc.rmRating > 0 ? loc.rmRating.toFixed(1) : "-"}
                  </td>
                  <td className="px-3 py-2 text-center" style={{ color: "#888" }}>
                    {loc.rmTotal || "-"}
                  </td>
                  <td className="px-3 py-2 text-center" style={{ color: "#C8A882" }}>
                    {loc.gmbCalls || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Citation Reports Table */}
      {citations.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#f0ede8" }}>
            CITATION TRACKER
          </h3>
          <div className="mt-1 h-[1px] w-full" style={{ backgroundColor: "#333" }} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#1a1a1a" }}>
                  <Th>Report</Th>
                  <Th>City</Th>
                  <Th>Address</Th>
                  <Th className="text-center">Live Citations</Th>
                  <Th className="text-center">Change</Th>
                  <Th className="text-center">Total Sources</Th>
                  <Th>Last Run</Th>
                </tr>
              </thead>
              <tbody>
                {citations.map((c, i) => (
                  <tr
                    key={c.reportId}
                    style={{ backgroundColor: i % 2 === 0 ? "#111111" : "#1a1a1a" }}
                  >
                    <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8", maxWidth: 250 }}>
                      <div className="truncate" title={c.reportName}>{c.reportName}</div>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "#888" }}>{c.city}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: "#666", maxWidth: 200 }}>
                      <div className="truncate">{c.address}</div>
                    </td>
                    <td className="px-3 py-2 text-center font-bold" style={{ color: "#C8A882" }}>
                      {c.liveCitations}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.citationsChange > 0 ? (
                        <span style={{ color: "#2d6a4f" }}>+{c.citationsChange}</span>
                      ) : c.citationsChange < 0 ? (
                        <span style={{ color: "#e74c3c" }}>{c.citationsChange}</span>
                      ) : (
                        <span style={{ color: "#666" }}>-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center" style={{ color: "#888" }}>{c.totalSources}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: "#666" }}>
                      {c.lastRun ? new Date(c.lastRun).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiBox({ value, label, accent = false, valueColor, icon }: {
  value: string;
  label: string;
  accent?: boolean;
  valueColor?: string;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm px-3 py-4" style={{ backgroundColor: "#111111" }}>
      <span className="text-2xl font-bold" style={{ color: valueColor || (accent ? "#c8a882" : "#ffffff") }}>
        {icon && <span className="text-sm mr-1">{icon}</span>}
        {value}
      </span>
      <span className="mt-1 text-[9px] tracking-widest uppercase" style={{ color: "#888888" }}>{label}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2.5 text-xs font-semibold tracking-wide ${className}`} style={{ color: "#f0ede8" }}>
      {children}
    </th>
  );
}
