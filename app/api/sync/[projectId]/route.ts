import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, syncProject } from "@/app/lib/basecamp";
import { storeBasecampTokens } from "@/app/lib/vercel-env";
import { commitClientData } from "@/app/lib/github";
import projects from "@/app/data/projects.json";

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;

  try {
    // Check for optional API key protection
    const apiKey = process.env.SYNC_API_KEY;
    if (apiKey) {
      const authHeader = request.headers.get("Authorization");
      if (authHeader !== `Bearer ${apiKey}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Find the project
    const project = projects.find((p) => String(p.id) === projectId);
    if (!project) {
      return NextResponse.json(
        { error: `Project ${projectId} not found in projects.json` },
        { status: 404 }
      );
    }

    // Get a valid access token
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

    // Sync the project
    const todos = await syncProject(project.id, project.todoset_id, accessToken);

    // Commit to GitHub if token is available
    let committed = false;
    let commitUrl = "";
    if (process.env.GITHUB_TOKEN) {
      try {
        const result = await commitClientData(project.id, todos);
        committed = true;
        commitUrl = result.url;
      } catch (commitErr) {
        console.error(`Failed to commit data for ${project.name}:`, commitErr);
      }
    }

    return NextResponse.json({
      status: "complete",
      tokenRefreshed: refreshed,
      project: {
        id: project.id,
        name: project.name,
      },
      todoCount: todos.length,
      committed,
      commitUrl,
      // Include the data in the response so the client can use it immediately
      todos,
    });
  } catch (e) {
    console.error(`Sync error for project ${projectId}:`, e);
    return NextResponse.json(
      {
        status: "error",
        error: e instanceof Error ? e.message : "Unknown sync error",
      },
      { status: 500 }
    );
  }
}
