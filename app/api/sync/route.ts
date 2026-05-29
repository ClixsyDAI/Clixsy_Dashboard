import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, syncProject } from "@/app/lib/basecamp";
import { storeBasecampTokens } from "@/app/lib/vercel-env";
import { commitClientData } from "@/app/lib/github";
import type { Project } from "@/app/lib/projects";
import projectsRaw from "@/app/data/projects.json";

// Asserted as Project[] so the deprecated `todoset_id?: number` field is
// reachable below. Route is scheduled for removal alongside the Basecamp
// poller; until then we read todoset_id (which is now undefined on every
// migrated entry, so the route will runtime-fail on call — acceptable).
const projects = projectsRaw as Project[];

export const maxDuration = 300; // 5 minutes for Vercel Pro

interface SyncResult {
  projectId: string;
  projectName: string;
  todoCount: number;
  committed: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Check for optional API key protection
    const apiKey = process.env.SYNC_API_KEY;
    if (apiKey) {
      const authHeader = request.headers.get("Authorization");
      if (authHeader !== `Bearer ${apiKey}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Get a valid access token (auto-refresh if expired)
    const { accessToken, refreshed, newTokens } = await getValidAccessToken();

    // If token was refreshed, try to update Vercel env vars
    if (refreshed && newTokens) {
      if (process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID) {
        try {
          await storeBasecampTokens(
            newTokens.access_token,
            newTokens.refresh_token
          );
        } catch (e) {
          console.error("Failed to update tokens in Vercel:", e);
        }
      }
    }

    // Parse request body for optional filters
    let projectFilter: string[] | null = null;
    try {
      const body = await request.json();
      if (body.projectIds && Array.isArray(body.projectIds)) {
        projectFilter = body.projectIds.map((x: unknown) => String(x));
      }
    } catch {
      // No body or invalid JSON — sync all projects
    }

    const projectsToSync = projectFilter
      ? projects.filter((p) => projectFilter!.includes(p.id))
      : projects;

    const results: SyncResult[] = [];
    const hasGithubToken = !!process.env.GITHUB_TOKEN;

    // Sync projects sequentially to respect rate limits
    for (const project of projectsToSync) {
      try {
        const todos = await syncProject(
          project.id,
          project.todoset_id,
          accessToken
        );

        let committed = false;
        if (hasGithubToken) {
          try {
            await commitClientData(project.id, todos);
            committed = true;
          } catch (commitErr) {
            console.error(
              `Failed to commit data for ${project.name}:`,
              commitErr
            );
          }
        }

        results.push({
          projectId: project.id,
          projectName: project.name,
          todoCount: todos.length,
          committed,
        });
      } catch (err) {
        results.push({
          projectId: project.id,
          projectName: project.name,
          todoCount: 0,
          committed: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successful = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    const totalTodos = results.reduce((sum, r) => sum + r.todoCount, 0);

    return NextResponse.json({
      status: "complete",
      tokenRefreshed: refreshed,
      summary: {
        total: projectsToSync.length,
        successful: successful.length,
        failed: failed.length,
        totalTodos,
      },
      results,
    });
  } catch (e) {
    console.error("Sync error:", e);
    return NextResponse.json(
      {
        status: "error",
        error: e instanceof Error ? e.message : "Unknown sync error",
      },
      { status: 500 }
    );
  }
}
