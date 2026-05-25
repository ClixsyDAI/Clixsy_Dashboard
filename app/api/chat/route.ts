import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { loadClientTodos } from "../../lib/dashboard-data";
import { loadGscData, loadGa4Data } from "../../lib/google-data";
import { getBrightLocalSummary } from "../../lib/brightlocal-data";
import { getOnboardingByWorkbookId } from "../../lib/onboarding/get-by-workbook-id";
import { SECTION_CONFIGS } from "../../lib/onboarding/field-config";
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
      "List Basecamp tasks for this client. Use to find tasks by status, search term, or recency. Returns id, title, list_title, completed status, due_on, completed_on, comments_count, assignees. Returns ALL matching tasks by default — only set `limit` if you explicitly want fewer.",
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
        assignee: {
          type: "string",
          description: "Optional case-insensitive substring match against the assignees field. Use this whenever the user asks about tasks belonging to a specific person.",
        },
        list_title: {
          type: "string",
          description: "Optional exact-match filter on list_title (must match the names returned by list_task_lists).",
        },
        completed_since: {
          type: "string",
          description: "ISO date (YYYY-MM-DD). Only include tasks completed on or after this date.",
        },
        sort_by: {
          type: "string",
          enum: ["comments_count", "due_on", "completed_on", "created_at"],
          description: "Optional sort key (descending for counts, ascending for dates).",
        },
        limit: { type: "number", description: "Max results (default 500 — effectively all). Only set this if the user explicitly asks for a top-N list." },
      },
      required: ["status"],
    },
  },
  {
    name: "list_task_lists",
    description:
      "Get the exact set of Basecamp task list names for this client, with the count of tasks in each list. Use this whenever the user asks about lists, categories, or how work is organised — never guess list names.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_assignee_stats",
    description:
      "Get exact task counts per assignee across ALL tasks for this client, sorted descending. Use this for any 'who is assigned to most tasks', 'top assignees', or 'workload' question — never sample or estimate from list_basecamp_tasks.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max assignees to return (default 20)" },
      },
    },
  },
  {
    name: "get_task_creation_stats",
    description:
      "Get exact counts of tasks bucketed by created_at year (or year-month) AND the oldest_task and newest_task by creation date. Use this for any 'tasks created in year X', 'when were tasks created', 'oldest task', or 'newest task' question — never sort or count creation dates from list_basecamp_tasks rows.",
    input_schema: {
      type: "object",
      properties: {
        granularity: {
          type: "string",
          enum: ["year", "year_month"],
          description: "Bucket size (default 'year').",
        },
      },
    },
  },
  {
    name: "get_gsc_query_aggregate",
    description:
      "Compute exact aggregates over the FULL GSC query cache: total clicks, total impressions, weighted CTR, simple-average position, impression-weighted average position, and matched query count — optionally split by brand_terms or filtered by min_clicks / position_lt / position_gte / contains. Use this for ANY 'how many queries match X', 'sum of X', 'average position', or 'CTR for queries matching X' question. Never sum, count, or average GSC rows yourself.",
    input_schema: {
      type: "object",
      properties: {
        brand_terms: {
          type: "array",
          items: { type: "string" },
          description: "List of case-insensitive substrings that classify a query as branded. If omitted, no split is performed and you get just totals.",
        },
        min_clicks: { type: "number", description: "Only include queries with clicks >= this value." },
        position_lt: { type: "number", description: "Only include queries with avg position strictly less than this (e.g. 3 for 'position better than 3')." },
        position_gte: { type: "number", description: "Only include queries with avg position >= this." },
        contains: { type: "string", description: "Optional case-insensitive substring filter on query text." },
      },
    },
  },
  {
    name: "get_task_stats",
    description:
      "Get aggregate statistics for this client's tasks: total, open, completed, overdue, completion rate, completed-in-last-N-days, total comments, average comments per task, single vs multi assignee counts, and tasks with vs without a due date. Always use this instead of counting from list_basecamp_tasks.",
    input_schema: {
      type: "object",
      properties: {
        completed_window_days: { type: "number", description: "Window for 'completed in last N days' (default 30)" },
      },
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
    description: "Get GSC queries with optional filters and sort. Use sort_by/sort_order to get the best/worst by any metric. Use min_clicks/min_impressions/position_lt/position_gte to constrain. Always prefer this over manually filtering get_gsc_query_aggregate when you need to identify specific queries.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 15, max 200 (full cache)" },
        contains: { type: "string", description: "Optional case-insensitive substring filter applied to the full query list." },
        min_clicks: { type: "number", description: "Only include queries with clicks >= this value." },
        min_impressions: { type: "number", description: "Only include queries with impressions >= this value." },
        position_lt: { type: "number", description: "Only include queries with avg position strictly less than this." },
        position_gte: { type: "number", description: "Only include queries with avg position >= this." },
        sort_by: {
          type: "string",
          enum: ["clicks", "impressions", "ctr", "position"],
          description: "Sort key. Default: clicks.",
        },
        sort_order: {
          type: "string",
          enum: ["desc", "asc"],
          description: "Sort order. Default: desc (descending). Use 'asc' to find worst/lowest values.",
        },
      },
    },
  },
  {
    name: "get_gsc_top_pages",
    description: "Get top Google Search Console pages by clicks for this client.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 15, max 200 (full cache)" },
        contains: { type: "string", description: "Optional case-insensitive substring filter on page URL." },
      },
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
  {
    name: "get_onboarding_status",
    description:
      "Get headline onboarding state for this client: status (draft/in_progress/submitted), vertical (law_firm/home_services), account manager, primary contact name/email (when filled), submission timestamp (when submitted), and how many of the 12 onboarding steps are completed. Use this for any 'what is their onboarding status', 'have they submitted', 'who is the contact', 'which AM owns this', or 'how far along are they' question — never guess from other tools. Returns { kind: 'no_client' } if the workbook id has no client row, or { kind: 'no_session' } if the client exists but hasn't started onboarding.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_onboarding_steps",
    description:
      "List all 12 onboarding steps for this client, in form order, with each step's completed flag and the count of fields the client has answered so far. Use this to scan the whole onboarding at a glance, to identify which sections are blank vs. partially filled, or to find the right step_key to drill into via get_onboarding_step. Returns { kind: 'no_client' } or { kind: 'no_session' } on the empty-state cases.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_onboarding_step",
    description:
      "Get the answers the client provided for one onboarding step. Returns the step's display name, completed flag, and a map of field_key → value covering every field the client has filled in that step. Use this for any specific-detail question ('what did they say about X', 'what is their physical address', 'what are their brand colours', 'what languages do they support'). The step_key must match one of the 12 form steps — call list_onboarding_steps first if you don't know the key. Returns { kind: 'step_not_found', available_steps: [...] } if the key is unknown, or { kind: 'no_client' } / { kind: 'no_session' } on the empty-state cases.",
    input_schema: {
      type: "object",
      properties: {
        step_key: {
          type: "string",
          description:
            "Onboarding step key (e.g. 'primary_contact', 'business_overview', 'brand_design', 'goals_strategy'). Use list_onboarding_steps to discover valid keys for this client.",
        },
      },
      required: ["step_key"],
    },
  },
  {
    name: "get_site_intelligence",
    description:
      "Get one of the four site-intelligence snapshots captured by the onboarding system's Firecrawl extraction (run when the AM first created the session). These are LARGE JSON blobs (each can be 200-6000 tokens). Use ONLY when the AM explicitly asks about branding extraction, site-intelligence insights, competitive analysis from the website, or pre-filled values vs. operator overrides. For everyday questions about what the client wrote in the form, prefer get_onboarding_step. snapshot_type values: 'branding' (extracted colours/fonts/logo URL), 'insights' (Firecrawl narrative summary of the site — largest), 'overrides' (operator-edited values that diverged from the prefill), 'prefill' (the auto-populated initial values). Returns { kind: 'no_snapshot' } when the column is null for this session.",
    input_schema: {
      type: "object",
      properties: {
        snapshot_type: {
          type: "string",
          enum: ["branding", "insights", "overrides", "prefill"],
          description: "Which snapshot column to fetch.",
        },
      },
      required: ["snapshot_type"],
    },
  },
];

function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: Awaited<ReturnType<typeof loadProjectContext>>
): unknown {
  switch (name) {
    case "list_basecamp_tasks": {
      const status = (input.status as string) || "all";
      const search = ((input.search as string) || "").toLowerCase();
      const completedSince = input.completed_since ? new Date(input.completed_since as string) : null;
      const limit = Math.min(Number(input.limit) || 500, 500);
      const sortBy = input.sort_by as string | undefined;
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
      const assigneeFilter = ((input.assignee as string) || "").toLowerCase();
      if (assigneeFilter)
        rows = rows.filter((t) =>
          (t.assignees || "").toLowerCase().includes(assigneeFilter)
        );
      const listFilter = (input.list_title as string) || "";
      if (listFilter)
        rows = rows.filter((t) => (t.list_title || "") === listFilter);
      if (sortBy === "comments_count") {
        rows.sort((a, b) => b.comments_count - a.comments_count);
      } else if (sortBy === "due_on") {
        rows.sort((a, b) => {
          if (!a.due_on) return 1;
          if (!b.due_on) return -1;
          return new Date(a.due_on).getTime() - new Date(b.due_on).getTime();
        });
      } else if (sortBy === "completed_on") {
        rows.sort((a, b) => {
          if (!a.completed_on) return 1;
          if (!b.completed_on) return -1;
          return new Date(b.completed_on).getTime() - new Date(a.completed_on).getTime();
        });
      } else if (sortBy === "created_at") {
        rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
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
          created_at: t.created_at,
          completed_on: t.completed_on,
          comments_count: t.comments_count,
          assignees: t.assignees,
        })),
      };
    }
    case "list_task_lists": {
      const counts: Record<string, { total: number; open: number; completed: number }> = {};
      for (const t of ctx.todos) {
        const k = t.list_title || "(unnamed)";
        if (!counts[k]) counts[k] = { total: 0, open: 0, completed: 0 };
        counts[k].total++;
        if (t.completed) counts[k].completed++;
        else counts[k].open++;
      }
      return {
        list_count: Object.keys(counts).length,
        lists: Object.entries(counts)
          .map(([name, c]) => ({ name, ...c }))
          .sort((a, b) => b.total - a.total),
      };
    }
    case "get_assignee_stats": {
      const limit = Math.min(Number(input.limit) || 20, 100);
      const counts: Record<string, number> = {};
      for (const t of ctx.todos) {
        const names = (t.assignees || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const n of names) counts[n] = (counts[n] || 0) + 1;
      }
      const total_unique_assignees = Object.keys(counts).length;
      const assignees = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([name, task_count]) => ({ name, task_count }));
      return { total_unique_assignees, total_tasks: ctx.todos.length, assignees };
    }
    case "get_task_creation_stats": {
      const granularity = (input.granularity as string) || "year";
      const buckets: Record<string, number> = {};
      for (const t of ctx.todos) {
        const c = t.created_at || "";
        if (!c) continue;
        const key = granularity === "year_month" ? c.slice(0, 7) : c.slice(0, 4);
        buckets[key] = (buckets[key] || 0) + 1;
      }
      const withCreated = ctx.todos.filter((t) => !!t.created_at);
      const sortedAsc = [...withCreated].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const oldest = sortedAsc[0];
      const newest = sortedAsc[sortedAsc.length - 1];
      const compact = (t: typeof oldest) =>
        t
          ? {
              id: t.id,
              title: stripHtml(t.title),
              list_title: t.list_title,
              created_at: t.created_at,
              completed: t.completed,
            }
          : null;
      return {
        granularity,
        total_tasks_with_created_at: withCreated.length,
        total_tasks: ctx.todos.length,
        buckets: Object.entries(buckets)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([bucket, count]) => ({ bucket, count })),
        oldest_task: compact(oldest),
        newest_task: compact(newest),
      };
    }
    case "get_gsc_query_aggregate": {
      if (!ctx.gscData) return { error: "No GSC data" };
      const terms = Array.isArray(input.brand_terms)
        ? (input.brand_terms as string[]).map((s) => s.toLowerCase())
        : [];
      const minClicks = input.min_clicks !== undefined ? Number(input.min_clicks) : null;
      const positionLt = input.position_lt !== undefined ? Number(input.position_lt) : null;
      const positionGte = input.position_gte !== undefined ? Number(input.position_gte) : null;
      const contains = ((input.contains as string) || "").toLowerCase();
      const universe = ctx.gscData.topQueries.length;
      const all = ctx.gscData.topQueries.filter((q) => {
        if (minClicks !== null && q.clicks < minClicks) return false;
        if (positionLt !== null && !(q.position < positionLt)) return false;
        if (positionGte !== null && !(q.position >= positionGte)) return false;
        if (contains && !q.query.toLowerCase().includes(contains)) return false;
        return true;
      });
      const totalClicks = all.reduce((s, q) => s + q.clicks, 0);
      const totalImpressions = all.reduce((s, q) => s + q.impressions, 0);
      const sumPositions = all.reduce((s, q) => s + q.position, 0);
      const sumPositionsWeighted = all.reduce((s, q) => s + q.position * q.impressions, 0);
      const result: Record<string, unknown> = {
        total_queries_in_cache: universe,
        matched_queries: all.length,
        total_clicks: totalClicks,
        total_impressions: totalImpressions,
        ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
        avg_position_simple: all.length > 0 ? sumPositions / all.length : 0,
        avg_position_weighted_by_impressions:
          totalImpressions > 0 ? sumPositionsWeighted / totalImpressions : 0,
        filters_applied: { min_clicks: minClicks, position_lt: positionLt, position_gte: positionGte, contains: contains || null },
      };
      if (terms.length > 0) {
        const isBranded = (q: string) => terms.some((t) => q.toLowerCase().includes(t));
        const branded = all.filter((q) => isBranded(q.query));
        const nonBranded = all.filter((q) => !isBranded(q.query));
        const sum = (arr: typeof all) => {
          const c = arr.reduce((s, q) => s + q.clicks, 0);
          const i = arr.reduce((s, q) => s + q.impressions, 0);
          const sp = arr.reduce((s, q) => s + q.position, 0);
          const spw = arr.reduce((s, q) => s + q.position * q.impressions, 0);
          return {
            query_count: arr.length,
            clicks: c,
            impressions: i,
            ctr: i > 0 ? c / i : 0,
            avg_position_simple: arr.length > 0 ? sp / arr.length : 0,
            avg_position_weighted_by_impressions: i > 0 ? spw / i : 0,
          };
        };
        const b = sum(branded);
        const nb = sum(nonBranded);
        result.brand_terms = terms;
        result.branded = b;
        result.non_branded = nb;
        result.branded_share_of_clicks = totalClicks > 0 ? b.clicks / totalClicks : 0;
      }
      return result;
    }
    case "get_task_stats": {
      const window = Number(input.completed_window_days) || 30;
      const now = new Date();
      const cutoff = new Date(now.getTime() - window * 86400000);
      const total = ctx.todos.length;
      const completed = ctx.todos.filter((t) => t.completed).length;
      const open = total - completed;
      const overdue = ctx.todos.filter(
        (t) => !t.completed && t.due_on && new Date(t.due_on) < now
      ).length;
      const completedInWindow = ctx.todos.filter(
        (t) => t.completed && t.completed_on && new Date(t.completed_on) >= cutoff
      ).length;
      const totalComments = ctx.todos.reduce((s, t) => s + (t.comments_count || 0), 0);
      const withDueDate = ctx.todos.filter((t) => !!t.due_on).length;
      const withoutDueDate = total - withDueDate;
      let single = 0;
      let multi = 0;
      let unassigned = 0;
      for (const t of ctx.todos) {
        const n = (t.assignees || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean).length;
        if (n === 0) unassigned++;
        else if (n === 1) single++;
        else multi++;
      }
      return {
        total,
        open,
        completed,
        overdue,
        completion_rate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
        completed_in_last_n_days: completedInWindow,
        completed_window_days: window,
        total_comments: totalComments,
        average_comments_per_task: total > 0 ? Math.round((totalComments / total) * 100) / 100 : 0,
        with_due_date: withDueDate,
        without_due_date: withoutDueDate,
        single_assignee_count: single,
        multi_assignee_count: multi,
        unassigned_count: unassigned,
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
      const limit = Math.min(Number(input.limit) || 15, 200);
      const contains = ((input.contains as string) || "").toLowerCase();
      const minClicks = input.min_clicks !== undefined ? Number(input.min_clicks) : null;
      const minImp = input.min_impressions !== undefined ? Number(input.min_impressions) : null;
      const positionLt = input.position_lt !== undefined ? Number(input.position_lt) : null;
      const positionGte = input.position_gte !== undefined ? Number(input.position_gte) : null;
      const sortBy = (input.sort_by as string) || "clicks";
      const sortOrder = (input.sort_order as string) || "desc";
      let q = ctx.gscData.topQueries.slice();
      if (contains) q = q.filter((row) => row.query.toLowerCase().includes(contains));
      if (minClicks !== null) q = q.filter((row) => row.clicks >= minClicks);
      if (minImp !== null) q = q.filter((row) => row.impressions >= minImp);
      if (positionLt !== null) q = q.filter((row) => row.position < positionLt);
      if (positionGte !== null) q = q.filter((row) => row.position >= positionGte);
      const keyOf = (row: { clicks: number; impressions: number; position: number }) => {
        if (sortBy === "impressions") return row.impressions;
        if (sortBy === "ctr") return row.impressions > 0 ? row.clicks / row.impressions : 0;
        if (sortBy === "position") return row.position;
        return row.clicks;
      };
      q.sort((a, b) => {
        const av = keyOf(a);
        const bv = keyOf(b);
        return sortOrder === "asc" ? av - bv : bv - av;
      });
      return {
        total_queries_in_cache: ctx.gscData.topQueries.length,
        matched: q.length,
        sort_by: sortBy,
        sort_order: sortOrder,
        queries: q.slice(0, limit).map((row) => ({
          ...row,
          ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
        })),
      };
    }
    case "get_gsc_top_pages": {
      if (!ctx.gscData) return { error: "No GSC data" };
      const limit = Math.min(Number(input.limit) || 15, 200);
      const contains = ((input.contains as string) || "").toLowerCase();
      let p = ctx.gscData.topPages || [];
      if (contains) p = p.filter((row) => row.page.toLowerCase().includes(contains));
      return {
        total_pages_in_cache: (ctx.gscData.topPages || []).length,
        matched: p.length,
        pages: p.slice(0, limit),
      };
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
    case "get_onboarding_status": {
      const ob = ctx.onboarding;
      if (ob.kind === "invalid_id") return { kind: "no_client", message: ob.message };
      if (ob.kind === "not_found") {
        return ob.reason === "no_client"
          ? { kind: "no_client", message: "No client row matches this workbook id." }
          : { kind: "no_session", message: "Client exists but has no onboarding session." };
      }
      if (ob.kind === "error") return { error: `Onboarding fetch failed: ${ob.message}` };
      const { client, session, answers } = ob.payload;
      const completed = answers.filter((a) => a.completed).length;
      return {
        kind: "ok",
        status: session.status,
        vertical: session.vertical,
        account_manager: session.account_manager,
        primary_contact_name: client.primary_contact_name,
        primary_contact_email: client.primary_contact_email,
        submitted_at: session.submitted_at,
        last_saved_at: session.last_saved_at,
        total_steps: SECTION_CONFIGS.length,
        completed_steps: completed,
      };
    }
    case "list_onboarding_steps": {
      const ob = ctx.onboarding;
      if (ob.kind === "invalid_id") return { kind: "no_client", message: ob.message };
      if (ob.kind === "not_found") {
        return ob.reason === "no_client"
          ? { kind: "no_client", message: "No client row matches this workbook id." }
          : { kind: "no_session", message: "Client exists but has no onboarding session." };
      }
      if (ob.kind === "error") return { error: `Onboarding fetch failed: ${ob.message}` };
      const byStepKey = new Map(
        ob.payload.answers.map((a) => [a.step_key, a]),
      );
      const steps = SECTION_CONFIGS.map((s) => {
        const row = byStepKey.get(s.stepKey);
        const ans = (row?.answers as Record<string, unknown> | undefined) ?? {};
        return {
          step_key: s.stepKey,
          step_name: s.name,
          completed: row?.completed ?? false,
          answer_count: Object.keys(ans).length,
        };
      });
      return { steps };
    }
    case "get_onboarding_step": {
      const stepKey = String(input.step_key || "");
      const ob = ctx.onboarding;
      if (ob.kind === "invalid_id") return { kind: "no_client", message: ob.message };
      if (ob.kind === "not_found") {
        return ob.reason === "no_client"
          ? { kind: "no_client", message: "No client row matches this workbook id." }
          : { kind: "no_session", message: "Client exists but has no onboarding session." };
      }
      if (ob.kind === "error") return { error: `Onboarding fetch failed: ${ob.message}` };
      const section = SECTION_CONFIGS.find((s) => s.stepKey === stepKey);
      if (!section) {
        return {
          kind: "step_not_found",
          available_steps: SECTION_CONFIGS.map((s) => s.stepKey),
        };
      }
      const row = ob.payload.answers.find((a) => a.step_key === stepKey);
      const answers = (row?.answers as Record<string, unknown> | undefined) ?? {};
      return {
        step_key: section.stepKey,
        step_name: section.name,
        completed: row?.completed ?? false,
        answers,
      };
    }
    case "get_site_intelligence": {
      const snapshotType = String(input.snapshot_type || "");
      const ob = ctx.onboarding;
      if (ob.kind === "invalid_id") return { kind: "no_client", message: ob.message };
      if (ob.kind === "not_found") {
        return ob.reason === "no_client"
          ? { kind: "no_client", message: "No client row matches this workbook id." }
          : { kind: "no_session", message: "Client exists but has no onboarding session." };
      }
      if (ob.kind === "error") return { error: `Onboarding fetch failed: ${ob.message}` };
      const column = (
        {
          branding: "si_branding_snapshot",
          insights: "si_insights_snapshot",
          overrides: "si_overrides_snapshot",
          prefill: "si_prefill_snapshot",
        } as const
      )[snapshotType as "branding" | "insights" | "overrides" | "prefill"];
      if (!column) {
        return {
          error: `Unknown snapshot_type: ${snapshotType}. Expected one of branding, insights, overrides, prefill.`,
        };
      }
      const snapshot = (ob.payload.session as Record<string, unknown>)[column];
      if (snapshot === null || snapshot === undefined) {
        return { kind: "no_snapshot", snapshot_type: snapshotType };
      }
      return { kind: "ok", snapshot_type: snapshotType, snapshot };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function loadProjectContext(projectId: string) {
  const todos = loadClientTodos(projectId) || [];
  const gscData = loadGscData(projectId);
  const ga4Data = loadGa4Data(projectId);
  const blData = getBrightLocalSummary(projectId);
  // Fetch onboarding via Supabase (server-side, service-role) — same
  // helper the Onboarding tab uses, returned as the discriminated
  // union so tool implementations can branch on kind === "ok" vs the
  // not_found / error cases. One fetch per request, memoized into ctx
  // for all subsequent tool calls in the loop below.
  const onboarding = await getOnboardingByWorkbookId(projectId);
  return { todos, gscData, ga4Data, blData, onboarding };
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

    const ctx = await loadProjectContext(String(projectId));

    // Onboarding availability flag + headline status. `kind === "ok"`
    // means the client has at least started an onboarding session;
    // anything else (no_client, no_session, invalid_id, error) means
    // the tools will return their respective empty-state objects when
    // the model calls them. The headline fields below let the model
    // decide whether to bother calling the onboarding tools at all
    // for questions where the answer is obvious from the status.
    const onboardingPresent = ctx.onboarding.kind === "ok";
    let onboardingStatus: string | undefined;
    let onboardingCompletion: string | undefined;
    if (onboardingPresent && ctx.onboarding.kind === "ok") {
      onboardingStatus = ctx.onboarding.payload.session.status;
      const completedSteps = ctx.onboarding.payload.answers.filter(
        (a) => a.completed,
      ).length;
      onboardingCompletion = `${completedSteps}/${SECTION_CONFIGS.length} steps`;
    }

    const availability = {
      basecamp_tasks: ctx.todos.length,
      gsc: !!ctx.gscData,
      ga4: !!ctx.ga4Data,
      brightlocal: !!ctx.blData,
      onboarding: onboardingPresent,
      ...(onboardingStatus ? { onboarding_status: onboardingStatus } : {}),
      ...(onboardingCompletion
        ? { onboarding_completion: onboardingCompletion }
        : {}),
    };

    const system = `You are an internal assistant for Clixsy account managers. You answer questions about a single client's data: Basecamp project tasks, Google Search Console, Google Analytics 4, BrightLocal local SEO, and the client's onboarding form responses (when available).

CLIENT: ${project.name}
DESCRIPTION: ${project.description}
DATA AVAILABLE: ${JSON.stringify(availability)}
TODAY: ${new Date().toISOString().split("T")[0]}

Rules:
- Use the provided tools to look up real data before answering. Do not invent numbers, names, list titles, or assignees — if a tool can return it, you must call the tool.
- For questions about task LISTS or CATEGORIES, always call list_task_lists. Never guess list names.
- For questions about ASSIGNEES or WORKLOAD, always call get_assignee_stats. Never compute assignee counts by sampling list_basecamp_tasks.
- To find the actual tasks belonging to a specific person, call list_basecamp_tasks with the 'assignee' filter. Never put a person's name in 'search' (which only matches title/list). Never invent assignee names — if a name isn't in get_assignee_stats, it doesn't exist for this client.
- For aggregate task counts (open/completed/overdue/completion rate/total comments), call get_task_stats rather than counting tasks yourself.
- For 'tasks created in year/month X' questions, call get_task_creation_stats. Never compute creation buckets from list_basecamp_tasks.
- For sums or branded-vs-non-branded splits across hundreds of GSC queries, call get_gsc_query_aggregate. Never sum the long tail in your head.
- list_basecamp_tasks returns ALL matching tasks by default. Do not pass a small limit unless the user explicitly asked for a top-N view.
- After listing tasks, double-check any arithmetic in your closing summary against the rows you actually returned.
- If a data source is unavailable, say so explicitly.
- Be concise and direct — account managers want answers, not preamble.
- When citing tasks, include the task title and list. When citing metrics, include the time window.
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
