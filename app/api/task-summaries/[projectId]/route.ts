import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";
import {
  loadTaskSummaries,
  getTaskSummariesPath,
  type TaskSummaryCache,
} from "@/app/lib/task-summaries";
import { commitFile } from "@/app/lib/github";

export const maxDuration = 60;

const anthropic = new Anthropic();

interface IncomingTask {
  id: number;
  title: string;
  description: string;
  list_title: string;
  updated_at: string;
}

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * POST /api/task-summaries/[projectId]
 * Body: { tasks: IncomingTask[] }
 *
 * Returns the cached summaries for the requested IDs, generating any that are
 * missing or stale (updated_at differs from cached). Generated summaries are
 * persisted to app/data/clients/[id]-task-summaries.json.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;

  let body: { tasks?: IncomingTask[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tasks = body.tasks || [];
  if (tasks.length === 0) {
    return NextResponse.json({ summaries: {} });
  }

  const cache: TaskSummaryCache = loadTaskSummaries(projectId);

  // Determine which tasks need (re)generation
  const stale = tasks.filter((t) => {
    const cached = cache[String(t.id)];
    return !cached || cached.updatedAt !== t.updated_at;
  });

  if (stale.length > 0) {
    // Batch the call: ask Claude to summarize all stale tasks in a single message
    // and return JSON. Cheaper + faster than one call per task.
    const prompt = buildBatchPrompt(stale);

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        message.content[0].type === "text" ? message.content[0].text : "";

      const parsed = parseBatchResponse(text);

      for (const t of stale) {
        const summary = parsed[String(t.id)];
        if (summary) {
          cache[String(t.id)] = {
            id: t.id,
            title: summary.title,
            whyItMatters: summary.whyItMatters,
            updatedAt: t.updated_at,
          };
        }
      }

      // Persist locally and to GitHub (so Vercel re-deploys with cache)
      const path = getTaskSummariesPath(projectId);
      try {
        writeFileSync(path, JSON.stringify(cache, null, 2));
      } catch (e) {
        console.error("Failed to write task-summaries cache locally:", e);
      }

      if (process.env.GITHUB_TOKEN) {
        try {
          await commitFile(
            `app/data/clients/${projectId}-task-summaries.json`,
            JSON.stringify(cache, null, 2),
            `Update task summaries for ${projectId}`
          );
        } catch (e) {
          console.error("Failed to commit task summaries to GitHub:", e);
        }
      }
    } catch (e) {
      console.error("Claude task summary generation failed:", e);
      // Fall through — return whatever we have cached
    }
  }

  // Return only the summaries for the requested IDs
  const out: TaskSummaryCache = {};
  for (const t of tasks) {
    if (cache[String(t.id)]) out[String(t.id)] = cache[String(t.id)];
  }
  return NextResponse.json({ summaries: out });
}

function buildBatchPrompt(tasks: IncomingTask[]): string {
  let p = `You are an SEO account manager at Clixsy. For each Basecamp task below, write:
1. A short layman's-terms title (max 8 words) that a non-technical client would understand.
2. A one-sentence "Why it matters" explaining its SEO impact in plain English.

Return ONLY a JSON object keyed by the task id, in this exact shape:
{
  "12345": { "title": "...", "whyItMatters": "..." },
  "67890": { "title": "...", "whyItMatters": "..." }
}

Do not include any text outside the JSON. Do not wrap in markdown code fences.

TASKS:
`;
  for (const t of tasks) {
    p += `\n--- id: ${t.id} ---\n`;
    p += `List: ${t.list_title}\n`;
    p += `Title: ${t.title}\n`;
    if (t.description) {
      p += `Description: ${t.description.slice(0, 400)}\n`;
    }
  }
  return p;
}

function parseBatchResponse(
  text: string
): Record<string, { title: string; whyItMatters: string }> {
  // Strip code fences if Claude added them despite instructions
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  // Find first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    console.error("Failed to parse Claude task summary JSON:", e);
    return {};
  }
}

