import ClientGrid from "./components/ClientGrid";
import SyncControls from "./components/SyncControls";
import AuthCallbackBanner from "./components/AuthCallbackBanner";
import {
  getAllClientHealthSummaries,
  summarizeCounts,
} from "./lib/client-health-summary";

export default async function Home() {
  const summaries = await getAllClientHealthSummaries();
  const counts = summarizeCounts(summaries);
  const withData = summaries.filter((s) => s.hasData).length;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Auth callback banner */}
        <AuthCallbackBanner />

        {/* Header */}
        <header className="mb-2">
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

          {/* Basecamp sync controls */}
          <SyncControls />

          <div
            className="mt-4 h-[2px] w-full"
            style={{ backgroundColor: "#c8a882" }}
          />
        </header>

        {/* Client grid with triage, search, sort, filter (client component) */}
        <ClientGrid summaries={summaries} counts={counts} />

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
