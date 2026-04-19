import Link from "next/link";
import ClientGrid from "./components/ClientGrid";
import SyncControls from "./components/SyncControls";
import AuthCallbackBanner from "./components/AuthCallbackBanner";
import {
  getAllClientHealthSummaries,
  summarizeCounts,
} from "./lib/client-health-summary";
import { getTeamAssignments } from "./lib/team-assignments";

export default async function Home() {
  const summaries = await getAllClientHealthSummaries();
  const counts = summarizeCounts(summaries);
  const withData = summaries.filter((s) => s.hasData).length;
  const teamData = getTeamAssignments();

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Auth callback banner */}
        <AuthCallbackBanner />

        {/* Header */}
        <header className="mb-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <img
                src="https://res.cloudinary.com/dovgh19xr/image/upload/v1766427227/new_logo_nvrux0.svg"
                alt="CLIXSY"
                className="h-10 w-auto"
              />
              <div>
                <h1
                  className="text-3xl font-bold tracking-wide uppercase"
                  style={{ color: "#ffffff", letterSpacing: "0.05em" }}
                >
                  Client Workbook Dashboard
                </h1>
                <p className="text-sm" style={{ color: "#888888" }}>
                  {summaries.length} client projects &nbsp;|&nbsp; {withData} with
                  data loaded
                </p>
              </div>
            </div>
            <Link
              href="/admin"
              className="flex items-center gap-2 rounded-sm border px-4 py-2 text-xs font-medium tracking-wide uppercase transition-all hover:border-[#C8A882] hover:text-[#C8A882]"
              style={{ borderColor: "#333", color: "#888" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Admin
            </Link>
          </div>

          {/* Basecamp sync controls */}
          <SyncControls />

          <div
            className="mt-4 h-[2px] w-full"
            style={{ backgroundColor: "#c8a882" }}
          />
        </header>

        {/* Client grid with triage, search, sort, filter (client component) */}
        <ClientGrid
          summaries={summaries}
          counts={counts}
          teamAssignments={teamData.assignments}
        />

        {/* Footer */}
        <footer className="mt-12 pb-8">
          <div
            className="h-[1px] w-full"
            style={{ backgroundColor: "#1a1a1a" }}
          />
          <p className="mt-4 text-xs italic" style={{ color: "#888888" }}>
            Account Health is an internal triage signal computed from Basecamp,
            GSC, GA4, BrightLocal, and the content pipeline. It is not shown on
            client share pages.
          </p>
        </footer>
      </div>
    </div>
  );
}
