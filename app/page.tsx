import { existsSync } from "fs";
import { join } from "path";
import projects from "./data/projects.json";
import ClientGrid from "./components/ClientGrid";
import SyncControls from "./components/SyncControls";
import AuthCallbackBanner from "./components/AuthCallbackBanner";

interface ProjectMeta {
  id: number;
  name: string;
  description: string;
  todoset_id: number;
  hasData: boolean;
}

export default function Home() {
  const projectsWithStatus: ProjectMeta[] = projects.map((p) => {
    const filePath = join(process.cwd(), "app", "data", "clients", `${p.id}.json`);
    return {
      ...p,
      hasData: existsSync(filePath),
    };
  });

  const withData = projectsWithStatus.filter((p) => p.hasData).length;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Auth callback banner */}
        <AuthCallbackBanner />

        {/* Header */}
        <header className="mb-2">
          <div className="flex items-center gap-4">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-sm text-sm font-bold"
              style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
            >
              CX
            </div>
            <div>
              <h1
                className="text-3xl font-bold tracking-wide uppercase"
                style={{ color: "#ffffff", letterSpacing: "0.05em" }}
              >
                Client Workbook Dashboard
              </h1>
              <p className="text-sm" style={{ color: "#888888" }}>
                {projects.length} client projects &nbsp;|&nbsp; {withData} with
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

        {/* Client grid with search (client component) */}
        <ClientGrid projects={projectsWithStatus} />

        {/* Footer */}
        <footer className="mt-12 pb-8">
          <div
            className="h-[1px] w-full"
            style={{ backgroundColor: "#1a1a1a" }}
          />
          <p className="mt-4 text-xs italic" style={{ color: "#888888" }}>
            Data source: Basecamp project management. Run data sync to populate
            client dashboards.
          </p>
        </footer>
      </div>
    </div>
  );
}
