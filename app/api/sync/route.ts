import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, syncProject } from "@/app/lib/basecamp";
import { storeBasecampTokens } from "@/app/lib/vercel-env";
import { commitClientData } from "@/app/lib/github";
import projects from "@/app/data/projects.json";

export const maxDuration = 300; // 5 minutes for Vercel Pro

interface SyncResult {
  projectId: number;
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
      if (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) {
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
    let projectFilter: number[] | null = null;
    try {
      const body = await request.json();
      if (body.projectIds && Array.isArray(body.projectIds)) {
        projectFilter = body.projectIds;
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
