/**
 * Meeting Prep — streaming AI briefing for account managers.
 *
 * Internal only. Generates a 5-section markdown briefing for a specific
 * client (The Good / The Bad / What to Focus On / Coming Up / Behind) so
 * an AM can click once right before a client meeting and get a ready-to-
 * read rundown.
 *
 * Differs from /api/ai-summary in three ways:
 *   1. Fixed rolling windows (last 30d + next 14d), anchored to the latest
 *      available data date for GSC/GA4 to avoid the lag-window problem.
 *   2. Includes matched-window prior-period comparisons and the content
 *      pipeline — both of which the AM needs to brief against.
 *   3. Streams back plain text (no JSON wrapper) so the UI can render
 *      the modal progressively instead of waiting 6-12s for the full body.
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadClientTodos } from "../../lib/dashboard-data";
import { loadGscData, loadGa4Data } from "../../lib/google-data";
import { getBrightLocalSummary } from "../../lib/brightlocal-data";
import { loadContentArticlesForClient } from "../../lib/content-data";
import { calculateHealthScore } from "../../lib/health-score";
import type { ContentArticle } from "../../lib/content-types";
import projects from "../../data/projects.json";

export const runtime = "nodejs";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";
const DAY_MS = 24 * 60 * 60 * 1000;

interface Todo {
  id: number;
  title: string;
  list_title: string;
  completed: boolean;
  due_on: string | null;
  created_at: string;
  completed_on: string | null;
  comments_count: number;
  assignees: string;
  description: string;
}

interface GscDailyRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Ga4DailyRow {
  date: string;
  sessions: number;
  users: number;
  screenPageViews: number;
}

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

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtPct(cur: number | null, prev: number | null): string {
  if (cur === null || prev === null || prev === 0) return "n/a";
  const pct = ((cur - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function sumGsc(rows: GscDailyRow[], from: Date, to: Date) {
  const inRange = rows.filter((r) => {
    const d = new Date(r.date);
    return d >= from && d <= to;
  });
  const clicks = inRange.reduce((s, r) => s + r.clicks, 0);
  const impressions = inRange.reduce((s, r) => s + r.impressions, 0);
  const position =
    inRange.length > 0
      ? inRange.reduce((s, r) => s + r.position, 0) / inRange.length
      : 0;
  return {
    days: inRange.length,
    clicks,
    impressions,
    position,
    ctr: impressions > 0 ? clicks / impressions : 0,
  };
}

function sumGa4(rows: Ga4DailyRow[], from: Date, to: Date) {
  const inRange = rows.filter((r) => {
    const d = new Date(r.date);
    return d >= from && d <= to;
  });
  return {
    days: inRange.length,
    sessions: inRange.reduce((s, r) => s + r.sessions, 0),
    users: inRange.reduce((s, r) => s + r.users, 0),
    pageViews: inRange.reduce((s, r) => s + r.screenPageViews, 0),
  };
}

function iso(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || "");
    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "projectId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const project = projects.find((p) => String(p.id) === projectId);
    if (!project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Load ─────────────────────────────────────────────────
    const todos: Todo[] = (loadClientTodos(projectId) || []) as Todo[];
    const gscData = loadGscData(projectId);
    const ga4Data = loadGa4Data(projectId);
    const blData = getBrightLocalSummary(projectId);
    let articles: ContentArticle[] | null = null;
    try {
      articles = await loadContentArticlesForClient(project.name);
    } catch (err) {
      console.warn("[meeting-prep] content fetch failed:", err);
      articles = null;
    }

    // ── Windows ──────────────────────────────────────────────
    // GSC/GA4 anchored to latest data date (data lags wall-clock by days).
    // Tasks use wall-clock "now" — Basecamp is live.
    const nowWall = new Date();
    const latestGsc =
      gscData?.dailyData?.length
        ? new Date(gscData.dailyData[gscData.dailyData.length - 1].date)
        : null;
    const latestGa4 =
      ga4Data?.dailyData?.length
        ? new Date(ga4Data.dailyData[ga4Data.dailyData.length - 1].date)
        : null;
    const gscEnd = latestGsc || nowWall;
    const ga4End = latestGa4 || nowWall;
    const gscStart = new Date(gscEnd.getTime() - 30 * DAY_MS);
    const gscPrevStart = new Date(gscStart.getTime() - 30 * DAY_MS);
    const ga4Start = new Date(ga4End.getTime() - 30 * DAY_MS);
    const ga4PrevStart = new Date(ga4Start.getTime() - 30 * DAY_MS);
    const taskWindowStart = new Date(nowWall.getTime() - 30 * DAY_MS);
    const upcomingEnd = new Date(nowWall.getTime() + 14 * DAY_MS);

    // ── Task slices ──────────────────────────────────────────
    const completedIn30d = todos
      .filter(
        (t) =>
          t.completed &&
          t.completed_on &&
          new Date(t.completed_on) >= taskWindowStart
      )
      .sort(
        (a, b) =>
          new Date(b.completed_on!).getTime() -
          new Date(a.completed_on!).getTime()
      );
    const dueIn30d = todos.filter(
      (t) =>
        t.due_on &&
        new Date(t.due_on) >= taskWindowStart &&
        new Date(t.due_on) <= nowWall
    );
    const upcoming = todos
      .filter(
        (t) =>
          !t.completed &&
          t.due_on &&
          new Date(t.due_on) >= nowWall &&
          new Date(t.due_on) <= upcomingEnd
      )
      .sort((a, b) => (a.due_on || "").localeCompare(b.due_on || ""));
    const overdue = todos
      .filter(
        (t) => !t.completed && t.due_on && new Date(t.due_on) < nowWall
      )
      .map((t) => ({
        ...t,
        daysOverdue: Math.floor(
          (nowWall.getTime() - new Date(t.due_on!).getTime()) / DAY_MS
        ),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    // ── GSC / GA4 aggregates + trend ────────────────────────
    const gscCurr = gscData ? sumGsc(gscData.dailyData, gscStart, gscEnd) : null;
    const gscPrev = gscData
      ? sumGsc(gscData.dailyData, gscPrevStart, gscStart)
      : null;
    const ga4Curr = ga4Data ? sumGa4(ga4Data.dailyData, ga4Start, ga4End) : null;
    const ga4Prev = ga4Data
      ? sumGa4(ga4Data.dailyData, ga4PrevStart, ga4Start)
      : null;

    // ── Content pipeline rollup ──────────────────────────────
    let contentSummary: {
      totalArticles: number;
      published30: number;
      queued: number;
      inProgress: number;
      forReview: number;
      upcomingTitles: Array<{ title: string; type: string; dueMonth: string | null }>;
      stalledTitles: Array<{ title: string; status: string }>;
    } | null = null;
    if (articles && articles.length > 0) {
      const published30 = articles.filter(
        (a) =>
          a.status === "published" &&
          a.publishDate &&
          new Date(a.publishDate).getTime() >= taskWindowStart.getTime()
      ).length;
      const queued = articles.filter(
        (a) => a.status === "queued-for-launch"
      ).length;
      const inProgress = articles.filter(
        (a) => a.status === "content-in-progress"
      ).length;
      const forReview = articles.filter(
        (a) => a.status === "content-for-review"
      ).length;
      // "Upcoming" = queued-for-launch, surface up to 5 titles.
      const upcomingTitles = articles
        .filter((a) => a.status === "queued-for-launch")
        .slice(0, 5)
        .map((a) => ({
          title: a.title,
          type: a.type,
          dueMonth: a.dueMonth || null,
        }));
      // "Stalled" heuristic: in-progress/for-review with a dueMonth that has
      // already passed. Not perfect (no last-touched timestamp in the sheet)
      // but flags articles that clearly missed their slot.
      const currentYm = `${nowWall.getFullYear()}-${String(
        nowWall.getMonth() + 1
      ).padStart(2, "0")}`;
      const stalledTitles = articles
        .filter(
          (a) =>
            (a.status === "content-in-progress" ||
              a.status === "content-for-review") &&
            a.dueMonth &&
            a.dueYear &&
            `${a.dueYear}-${String(
              new Date(`${a.dueMonth} 1, ${a.dueYear}`).getMonth() + 1
            ).padStart(2, "0")}` < currentYm
        )
        .slice(0, 5)
        .map((a) => ({ title: a.title, status: a.status }));
      contentSummary = {
        totalArticles: articles.length,
        published30,
        queued,
        inProgress,
        forReview,
        upcomingTitles,
        stalledTitles,
      };
    }

    // ── Health score composite (for opening line of brief) ──
    const health = calculateHealthScore({
      tasksDueInPeriod: dueIn30d.length,
      tasksCompletedInPeriod: completedIn30d.length,
      overdueCount: overdue.length,
      gscClicksCurrent: gscCurr?.clicks ?? null,
      gscClicksPrevious: gscPrev?.clicks ?? null,
      gscAvgPositionCurrent:
        gscCurr?.position && gscCurr.position > 0 ? gscCurr.position : null,
      gscAvgPositionPrevious:
        gscPrev?.position && gscPrev.position > 0 ? gscPrev.position : null,
      gscCtrCurrent: gscCurr?.ctr ?? null,
      gscCtrPrevious: gscPrev?.ctr ?? null,
      gscImpressionsCurrent: gscCurr?.impressions ?? null,
      ga4SessionsCurrent: ga4Curr?.sessions ?? null,
      ga4SessionsPrevious: ga4Prev?.sessions ?? null,
      blRankingsUp: blData?.totalRankingsUp ?? null,
      blRankingsDown: blData?.totalRankingsDown ?? null,
      blAvgGoogleRank: blData?.avgGoogleRank ?? null,
      blReviewRating: blData?.reviewRating ?? null,
      contentArticles: articles,
    });

    // ── Build prompt ─────────────────────────────────────────
    const prompt = buildPrompt({
      projectName: project.name,
      description: project.description ?? "",
      nowWall,
      health,
      tasks: {
        total: todos.length,
        completedIn30d,
        dueIn30d: dueIn30d.length,
        upcoming,
        overdue,
      },
      gsc: gscCurr && gscPrev
        ? {
            curr: gscCurr,
            prev: gscPrev,
            windowEnd: iso(gscEnd),
            topQueries: (gscData?.topQueries || []).slice(0, 10),
          }
        : null,
      ga4: ga4Curr && ga4Prev
        ? {
            curr: ga4Curr,
            prev: ga4Prev,
            windowEnd: iso(ga4End),
            organicSessionsFullPeriod: ga4Data?.totals?.organicSessions ?? null,
          }
        : null,
      bl: blData,
      content: contentSummary,
    });

    // ── Stream Claude response back as plain text ───────────
    const aStream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of aStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          console.error("[meeting-prep] stream error:", err);
          try {
            controller.enqueue(
              encoder.encode(
                `\n\n---\n**Briefing generation failed partway through.** ${
                  err instanceof Error ? err.message : String(err)
                }`
              )
            );
          } catch {
            /* ignore */
          }
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meeting-prep] fatal:", err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/* ─── Prompt construction ─────────────────────────────────────── */

interface PromptInput {
  projectName: string;
  description: string;
  nowWall: Date;
  health: ReturnType<typeof calculateHealthScore>;
  tasks: {
    total: number;
    completedIn30d: Todo[];
    dueIn30d: number;
    upcoming: Todo[];
    overdue: Array<Todo & { daysOverdue: number }>;
  };
  gsc: {
    curr: ReturnType<typeof sumGsc>;
    prev: ReturnType<typeof sumGsc>;
    windowEnd: string;
    topQueries: Array<{
      query: string;
      clicks: number;
      impressions: number;
      position: number;
    }>;
  } | null;
  ga4: {
    curr: ReturnType<typeof sumGa4>;
    prev: ReturnType<typeof sumGa4>;
    windowEnd: string;
    organicSessionsFullPeriod: number | null;
  } | null;
  bl: ReturnType<typeof getBrightLocalSummary>;
  content: {
    totalArticles: number;
    published30: number;
    queued: number;
    inProgress: number;
    forReview: number;
    upcomingTitles: Array<{
      title: string;
      type: string;
      dueMonth: string | null;
    }>;
    stalledTitles: Array<{ title: string; status: string }>;
  } | null;
}

function buildPrompt(d: PromptInput): string {
  const today = iso(d.nowWall);
  let p = `You are briefing a Clixsy account manager who walks into a client meeting in 10 minutes. Punchy. Specific numbers. Zero preamble. Produce EXACTLY the 5 sections at the bottom — no intro line, no outro line, no "Here's your briefing", no "Let me know if you want more detail".

CLIENT: ${d.projectName}
DESCRIPTION: ${d.description}
TODAY: ${today}

── HEALTH ──
Composite: ${d.health.overall}/100 (${d.health.label})
Sub-scores (unavailable ones are hidden from the weighted avg):
`;
  for (const s of d.health.subScores) {
    p += `  - ${s.label}: ${
      s.available ? `${s.score}/100` : "unavailable"
    } (weight ${s.weight})\n`;
  }

  p += `\n── TASKS (wall-clock anchored) ──
  Total tracked: ${d.tasks.total}
  Completed in last 30d: ${d.tasks.completedIn30d.length}
  Due in last 30d (for completion-rate context): ${d.tasks.dueIn30d}
  Upcoming next 14d: ${d.tasks.upcoming.length}
  Overdue: ${d.tasks.overdue.length}
`;
  if (d.tasks.completedIn30d.length > 0) {
    p += `\n  Recently completed (top 12 by completed_on desc):\n`;
    for (const t of d.tasks.completedIn30d.slice(0, 12)) {
      p += `    - ${stripHtml(t.title)} [${t.list_title}] — ${
        t.completed_on?.split("T")[0] || "?"
      }\n`;
    }
  }
  if (d.tasks.upcoming.length > 0) {
    p += `\n  Upcoming next 14d:\n`;
    for (const t of d.tasks.upcoming.slice(0, 10)) {
      p += `    - ${stripHtml(t.title)} [${t.list_title}] — due ${t.due_on}\n`;
    }
  }
  if (d.tasks.overdue.length > 0) {
    p += `\n  Overdue (oldest first):\n`;
    for (const t of d.tasks.overdue.slice(0, 10)) {
      p += `    - ${stripHtml(t.title)} [${t.list_title}] — ${t.daysOverdue}d overdue (due ${t.due_on})\n`;
    }
  }

  if (d.gsc) {
    const ctrDelta =
      d.gsc.prev.ctr > 0
        ? ((d.gsc.curr.ctr - d.gsc.prev.ctr) / d.gsc.prev.ctr) * 100
        : null;
    const posDelta = d.gsc.prev.position - d.gsc.curr.position;
    const posDirection =
      posDelta > 0.05
        ? "IMPROVED"
        : posDelta < -0.05
          ? "WORSENED"
          : "FLAT";
    p += `\n── GSC (30d ending ${d.gsc.windowEnd} vs prior 30d) ──
  Clicks (= organic traffic): ${fmtNum(d.gsc.curr.clicks)}  (Δ ${fmtPct(d.gsc.curr.clicks, d.gsc.prev.clicks)})
  Impressions (≠ traffic):    ${fmtNum(d.gsc.curr.impressions)}  (Δ ${fmtPct(d.gsc.curr.impressions, d.gsc.prev.impressions)})
  CTR:                        ${(d.gsc.curr.ctr * 100).toFixed(2)}%  (Δ ${ctrDelta === null ? "n/a" : `${ctrDelta >= 0 ? "+" : ""}${ctrDelta.toFixed(1)}%`})
  Avg pos (lower = better):   was ${d.gsc.prev.position.toFixed(1)}, NOW ${d.gsc.curr.position.toFixed(1)} → ${posDirection} by ${Math.abs(posDelta).toFixed(1)}
`;
    if (d.gsc.topQueries.length > 0) {
      p += `\n  Top queries (from GSC query cache — not necessarily in-window):\n`;
      for (const q of d.gsc.topQueries.slice(0, 8)) {
        p += `    - "${q.query}" — ${q.clicks} clicks, ${fmtNum(q.impressions)} impr, pos ${q.position.toFixed(1)}\n`;
      }
    }
  } else {
    p += `\n── GSC ──\n  No GSC data available.\n`;
  }

  if (d.ga4) {
    p += `\n── GA4 (30d ending ${d.ga4.windowEnd} vs prior 30d) ──
  Sessions:  ${fmtNum(d.ga4.curr.sessions)}  (Δ ${fmtPct(d.ga4.curr.sessions, d.ga4.prev.sessions)})
  Users:     ${fmtNum(d.ga4.curr.users)}
  Pageviews: ${fmtNum(d.ga4.curr.pageViews)}
  Organic sessions (full-period aggregate, not matched-window): ${
    d.ga4.organicSessionsFullPeriod === null
      ? "n/a"
      : fmtNum(d.ga4.organicSessionsFullPeriod)
  }
`;
  } else {
    p += `\n── GA4 ──\n  No GA4 data available.\n`;
  }

  if (d.bl) {
    const netRank = d.bl.totalRankingsUp - d.bl.totalRankingsDown;
    p += `\n── Local SEO (BrightLocal snapshot) ──
  Locations: ${d.bl.locationCount}
  Rankings: ${d.bl.totalRankingsUp} up / ${d.bl.totalRankingsDown} down (net ${netRank >= 0 ? "+" : ""}${netRank})
  Avg Google rank: ${d.bl.avgGoogleRank}
  Avg Local Search Grid rank: ${d.bl.avgLsgRank}
  Reviews: ${d.bl.reviewRating} stars across ${fmtNum(d.bl.totalReviews)} reviews
  Citations: ${fmtNum(d.bl.totalCitations)}
  GBP calls: ${fmtNum(d.bl.totalGmbCalls)}
`;
  } else {
    p += `\n── Local SEO ──\n  No BrightLocal data.\n`;
  }

  if (d.content) {
    p += `\n── Content pipeline ──
  Total articles tracked: ${d.content.totalArticles}
  Published in last 30d: ${d.content.published30}
  Queued for launch:     ${d.content.queued}
  In progress:           ${d.content.inProgress}
  For review:            ${d.content.forReview}
`;
    if (d.content.upcomingTitles.length > 0) {
      p += `\n  Queued-for-launch (upcoming):\n`;
      for (const a of d.content.upcomingTitles) {
        p += `    - "${a.title}" (${a.type}${a.dueMonth ? `, due ${a.dueMonth}` : ""})\n`;
      }
    }
    if (d.content.stalledTitles.length > 0) {
      p += `\n  Stalled (past due-month, still not shipped):\n`;
      for (const a of d.content.stalledTitles) {
        p += `    - "${a.title}" (${a.status})\n`;
      }
    }
  } else {
    p += `\n── Content pipeline ──\n  No content pipeline for this client.\n`;
  }

  p += `
────────────────────────────────────────────────────────────────────
Output format — markdown ONLY, exactly these 5 H2 sections, nothing else:

## The Good
3-5 bullets. Each cites a number or a specific task/article title. Lead with the biggest signal. If there's genuinely nothing positive to report, say so in one honest line.

## The Bad
3-5 bullets. Each cites a number or a specific item. If there's nothing bad, say "No concerns this period."

## What to Focus On
2-3 bullets. Concrete actions tied to items in The Bad or Behind — no generic "publish more content" advice. If a specific overdue task or stalled article is the lever, name it.

## Coming Up
What's in flight in the next 14 days: upcoming tasks + queued-for-launch articles. Group sensibly if there are many. If empty, say "Nothing scheduled in the next 14 days."

## Behind
Overdue tasks (with days-overdue count) and stalled content. If nothing is overdue and nothing is stalled, say "Nothing behind."

Rules:
- Never invent numbers. If a data source is unavailable, don't fabricate claims against it — you can say "GSC not available for this client."
- NEVER invent a location count. If you reference locations, either quote the exact number from the "Locations: N" line in the Local SEO block, or write "across locations" / omit the count. If the Local SEO block says "No BrightLocal data," do not mention location counts at all.
- Use specific task titles and list names, not "the recent task".
- Client-facing numbers (clicks, sessions, rank) should match what's in the data block above.
- POSITION DIRECTION: lower rank = better. The data block tells you IMPROVED/WORSENED/FLAT explicitly — use that word. Never invert it. If the data says "WORSENED by 4.8" you write "worsened" or "dropped"; if it says "IMPROVED by 4.8" you write "improved" or "rose". Do not guess from the numbers alone.
- IMPRESSIONS ≠ TRAFFIC: "organic traffic" / "traffic" / "visits" means CLICKS (or GA4 sessions), never impressions. Impressions are how often you showed up, clicks are how many actually came. If you want to describe impressions, call them "impressions" or "visibility" — never "traffic".
- If GA4 data is present, cite the sessions delta. It's a direct measure of site traffic and AMs want it.
- This is INTERNAL. Use direct language ("position dropped 1.8", not "a slight ranking shift"). Account managers want signal, not corporate fluff.
- Under 450 words total. This is a briefing, not a report.
`;

  return p;
}
