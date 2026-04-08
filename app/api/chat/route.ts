import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { loadClientTodos } from "../../lib/dashboard-data";
import { loadGscData, loadGa4Data } from "../../lib/google-data";
import { getBrightLocalSummary } from "../../lib/brightlocal-data";
import projects from "../../data/projects.json";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOOL_TURNS = 8;

function stripHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(new RegExp("<bc-attachment[^>]*>.*?</bc-attachment>", "gs"), "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tools: Anthropic.Tool[] = [
  {
    name: "list_basecamp_tasks",
    description:
      "List Basecamp tasks for this client. Use to find tasks by status, search term, or recency. Returns id, title, list_title, completed status, due_on, completed_on, comments_count, assignees.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "open", "completed", "overdue"],
          description: "Filter by status. 'overdue' = open with due_on in the past.",
        },
        search: {
          type: "string",
          description: "Optional case-insensitive substring match against task title and list_title.",
        },
        completed_since: {
          type: "string",
          description: "ISO date (YYYY-MM-DD). Only include tasks completed on or after this date.",
        },
        limit: { type: "number", description: "Max results (default 25, max 100)" },
      },
      required: ["status"],
    },
  },
  {
    name: "get_task_details",
    description: "Get the full description and metadata for a specific Basecamp task by id.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "number" } },
      required: ["task_id"],
    },
  },
  {
    name: "get_gsc_summary",
    description:
      "Get Google Search Console totals (clicks, impressions, CTR, avg position) for the last N days.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Lookback window in days (default 30)" } },
    },
  },
  {
    name: "get_gsc_top_queries",
    description: "Get top Google Search Console queries by clicks for this client.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 15, max 50" } },
    },
  },
  {
    name: "get_gsc_top_pages",
    description: "Get top Google Search Console pages by clicks for this client.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 15, max 50" } },
    },
  },
  {
    name: "get_ga4_summary",
    description:
      "Get Google Analytics 4 totals (sessions, users, page views) for the last N days, plus full-period organic sessions.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Lookback window in days (default 30)" } },
    },
  },
  {
    name: "get_ga4_channels",
    description: "Get GA4 traffic breakdown by acquisition channel.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_brightlocal_summary",
    description:
      "Get BrightLocal local SEO snapshot: locations, ranking movements, citations, GBP rank, reviews, GBP calls.",
    input_schema: { type: "object", properties: {} },
  },
];

function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ReturnType<typeof loadProjectContext>
): unknown {
  switch (name) {
    case "list_basecamp_tasks": {
      const status = (input.status as string) || "all";
      const search = ((input.search as string) || "").toLowerCase();
      const completedSince = input.completed_since ? new Date(input.completed_since as string) : null;
      const limit = Math.min(Number(input.limit) || 25, 100);
      const now = new Date();
      let rows = ctx.todos.slice();
      if (status === "open") rows = rows.filter((t) => !t.completed);
      else if (status === "completed") rows = rows.filter((t) => t.completed);
      else if (status === "overdue")
        rows = rows.filter((t) => !t.completed && t.due_on && new Date(t.due_on) < now);
      if (completedSince)
        rows = rows.filter(
          (t) => t.completed && t.completed_on && new Date(t.completed_on) >= completedSince
        );
      if (search)
        rows = rows.filter(
          (t) =>
            stripHtml(t.title).toLowerCase().includes(search) ||
            (t.list_title || "").toLowerCase().includes(search)
        );
      const totalMatched = rows.length;
      rows = rows.slice(0, limit);
      return {
        total_matched: totalMatched,
        returned: rows.length,
        tasks: rows.map((t) => ({
          id: t.id,
          title: stripHtml(t.title),
          list_title: t.list_title,
          completed: t.completed,
          due_on: t.due_on,
          completed_on: t.completed_on,
          comments_count: t.comments_count,
          assignees: t.assignees,
        })),
      };
    }
    case "get_task_details": {
      const id = Number(input.task_id);
      const t = ctx.todos.find((x) => x.id === id);
      if (!t) return { error: "Task not found" };
      return {
        id: t.id,
        title: stripHtml(t.title),
        list_title: t.list_title,
        completed: t.completed,
        due_on: t.due_on,
        created_at: t.created_at,
        completed_on: t.completed_on,
        comments_count: t.comments_count,
        assignees: t.assignees,
        description: stripHtml(t.description || ""),
      };
    }
    case "get_gsc_summary": {
      if (!ctx.gscData) return { error: "No GSC data for this client" };
      const days = Number(input.days) || 30;
      const cutoff = new Date(Date.now() - days * 86400000);
      const rows = ctx.gscData.dailyData.filter((d) => new Date(d.date) >= cutoff);
      const clicks = rows.reduce((s, d) => s + d.clicks, 0);
      const impressions = rows.reduce((s, d) => s + d.impressions, 0);
      const avgPosition =
        rows.length > 0 ? rows.reduce((s, d) => s + d.position, 0) / rows.length : 0;
      return {
        days_window: days,
        days_of_data: rows.length,
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        avg_position: Math.round(avgPosition * 10) / 10,
        property: ctx.gscData.property,
      };
    }
    case "get_gsc_top_queries": {
      if (!ctx.gscData) return { error: "No GSC data" };
      const limit = Math.min(Number(input.limit) || 15, 50);
      return { queries: ctx.gscData.topQueries.slice(0, limit) };
    }
    case "get_gsc_top_pages": {
      if (!ctx.gscData) return { error: "No GSC data" };
      const limit = Math.min(Number(input.limit) || 15, 50);
      return { pages: (ctx.gscData.topPages || []).slice(0, limit) };
    }
    case "get_ga4_summary": {
      if (!ctx.ga4Data) return { error: "No GA4 data for this client" };
      const days = Number(input.days) || 30;
      const cutoff = new Date(Date.now() - days * 86400000);
      const rows = ctx.ga4Data.dailyData.filter((d) => new Date(d.date) >= cutoff);
      return {
        days_window: days,
        days_of_data: rows.length,
        sessions: rows.reduce((s, d) => s + d.sessions, 0),
        users: rows.reduce((s, d) => s + d.users, 0),
        page_views: rows.reduce((s, d) => s + d.screenPageViews, 0),
        organic_sessions_full_period: ctx.ga4Data.totals.organicSessions,
      };
    }
    case "get_ga4_channels": {
      if (!ctx.ga4Data) return { error: "No GA4 data" };
      return { channels: ctx.ga4Data.channelData };
    }
    case "get_brightlocal_summary": {
      if (!ctx.blData) return { error: "No BrightLocal data" };
      return ctx.blData;
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function loadProjectContext(projectId: string) {
  const todos = loadClientTodos(projectId) || [];
  const gscData = loadGscData(projectId);
  const ga4Data = loadGa4Data(projectId);
  const blData = getBrightLocalSummary(projectId);
  return { todos, gscData, ga4Data, blData };
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: Request) {
  try {
    const { projectId, messages } = (await request.json()) as {
      projectId: string;
      messages: IncomingMessage[];
    };

    if (!projectId || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "projectId and messages[] are required" },
        { status: 400 }
      );
    }

    const project = projects.find((p) => String(p.id) === String(projectId));
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const ctx = loadProjectContext(String(projectId));

    const availability = {
      basecamp_tasks: ctx.todos.length,
      gsc: !!ctx.gscData,
      ga4: !!ctx.ga4Data,
      brightlocal: !!ctx.blData,
    };

    const system = `You are an internal assistant for Clixsy account managers. You answer questions about a single client's data: Basecamp project tasks, Google Search Console, Google Analytics 4, and BrightLocal local SEO.

CLIENT: ${project.name}
DESCRIPTION: ${project.description}
DATA AVAILABLE: ${JSON.stringify(availability)}
TODAY: ${new Date().toISOString().split("T")[0]}

Rules:
- Use the provided tools to look up real data before answering. Do not invent numbers.
- If a data source is unavailable, say so explicitly.
- Be concise and direct — account managers want answers, not preamble.
- When citing tasks, include the task title and list. When citing metrics, include the time window.
- If asked something the tools cannot answer, say what you do and don't have access to.
- Format with markdown when it helps readability (lists, bold, tables).`;

    // Convert incoming messages into the API shape. The conversation may already
    // contain prior tool_use/tool_result turns, but the client only stores text.
    const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools,
      messages: apiMessages,
    });

    let turns = 0;
    while (response.stop_reason === "tool_use" && turns < MAX_TOOL_TURNS) {
      turns++;
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      apiMessages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => {
        let result: unknown;
        try {
          result = runTool(tu.name, tu.input as Record<string, unknown>, ctx);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        };
      });

      apiMessages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system,
        tools,
        messages: apiMessages,
      });
    }

    const finalText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({
      reply: finalText || "(no response)",
      tool_turns: turns,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
