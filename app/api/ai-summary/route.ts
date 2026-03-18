import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { loadClientTodos } from "../../lib/dashboard-data";
import { loadGscData, loadGa4Data } from "../../lib/google-data";
import { getBrightLocalSummary } from "../../lib/brightlocal-data";
import projects from "../../data/projects.json";

const anthropic = new Anthropic();

export async function POST(request: Request) {
  try {
    const { projectId, startDate, endDate } = await request.json();

    if (!projectId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "projectId, startDate, and endDate are required" },
        { status: 400 }
      );
    }

    const project = projects.find((p) => String(p.id) === String(projectId));
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // ── Gather data ──────────────────────────────────────────

    // 1. Tasks completed in date range
    const allTodos = loadClientTodos(String(projectId)) || [];
    const completedInRange = allTodos.filter((t) => {
      if (!t.completed || !t.completed_on) return false;
      const d = new Date(t.completed_on);
      return d >= start && d <= end;
    });
    const openTasks = allTodos.filter((t) => !t.completed);
    const overdueTasks = openTasks.filter((t) => {
      if (!t.due_on) return false;
      return new Date(t.due_on) < new Date();
    });

    // 2. GSC data filtered to date range
    const gscData = loadGscData(String(projectId));
    let gscInRange = null;
    if (gscData) {
      const filteredDaily = gscData.dailyData.filter((d) => {
        const date = new Date(d.date);
        return date >= start && date <= end;
      });
      const clicks = filteredDaily.reduce((s, d) => s + d.clicks, 0);
      const impressions = filteredDaily.reduce((s, d) => s + d.impressions, 0);
      const avgPosition =
        filteredDaily.length > 0
          ? filteredDaily.reduce((s, d) => s + d.position, 0) / filteredDaily.length
          : 0;

      // Top queries (from full data — GSC doesn't have daily per-query)
      const topQueries = gscData.topQueries.slice(0, 15);

      gscInRange = {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        avgPosition: Math.round(avgPosition * 10) / 10,
        daysOfData: filteredDaily.length,
        topQueries,
      };
    }

    // 3. GA4 data filtered to date range
    const ga4Data = loadGa4Data(String(projectId));
    let ga4InRange = null;
    if (ga4Data) {
      const filteredDaily = ga4Data.dailyData.filter((d) => {
        const date = new Date(d.date);
        return date >= start && date <= end;
      });
      const sessions = filteredDaily.reduce((s, d) => s + d.sessions, 0);
      const users = filteredDaily.reduce((s, d) => s + d.users, 0);
      const pageViews = filteredDaily.reduce((s, d) => s + d.screenPageViews, 0);

      ga4InRange = {
        sessions,
        users,
        pageViews,
        daysOfData: filteredDaily.length,
        channels: ga4Data.channelData.slice(0, 8),
        organicSessions: ga4Data.totals.organicSessions,
      };
    }

    // 4. BrightLocal data (current snapshot — not date-filtered)
    const blData = getBrightLocalSummary(String(projectId));

    // ── Build AI prompt ──────────────────────────────────────

    const dataContext = buildDataContext({
      projectName: project.name,
      description: project.description,
      startDate,
      endDate,
      completedTasks: completedInRange,
      openTasks,
      overdueTasks,
      totalTasks: allTodos.length,
      gsc: gscInRange,
      ga4: ga4InRange,
      brightLocal: blData,
    });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: dataContext,
        },
      ],
    });

    const aiText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // ── Return structured response ───────────────────────────

    return NextResponse.json({
      projectName: project.name,
      dateRange: { start: startDate, end: endDate },
      stats: {
        tasksCompleted: completedInRange.length,
        tasksOpen: openTasks.length,
        tasksOverdue: overdueTasks.length,
        totalTasks: allTodos.length,
        gscClicks: gscInRange?.clicks || 0,
        gscImpressions: gscInRange?.impressions || 0,
        gscAvgPosition: gscInRange?.avgPosition || 0,
        ga4Sessions: ga4InRange?.sessions || 0,
        ga4Users: ga4InRange?.users || 0,
        ga4OrganicSessions: ga4InRange?.organicSessions || 0,
        blLocations: blData?.locationCount || 0,
        blRankingsUp: blData?.totalRankingsUp || 0,
        blRankingsDown: blData?.totalRankingsDown || 0,
        blCitations: blData?.totalCitations || 0,
      },
      completedTasks: completedInRange.map((t) => ({
        title: stripHtml(t.title),
        list_title: t.list_title,
        completed_on: t.completed_on,
        assignees: t.assignees,
      })),
      aiSummary: aiText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function stripHtml(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(new RegExp("<bc-attachment[^>]*>.*?</bc-attachment>", "gs"), "");
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  cleaned = cleaned.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

function buildDataContext(data: {
  projectName: string;
  description: string;
  startDate: string;
  endDate: string;
  completedTasks: Array<{ title: string; list_title: string; completed_on: string | null; assignees: string }>;
  openTasks: Array<{ title: string; list_title: string; due_on: string | null }>;
  overdueTasks: Array<{ title: string; due_on: string | null }>;
  totalTasks: number;
  gsc: { clicks: number; impressions: number; ctr: number; avgPosition: number; daysOfData: number; topQueries: Array<{ query: string; clicks: number; impressions: number; position: number }> } | null;
  ga4: { sessions: number; users: number; pageViews: number; daysOfData: number; channels: Array<{ channel: string; sessions: number }>; organicSessions: number } | null;
  brightLocal: { locationCount: number; totalRankingsUp: number; totalRankingsDown: number; totalCitations: number; avgGoogleRank: number; avgLsgRank: number; reviewRating: number; totalReviews: number; totalGmbCalls: number } | null;
}): string {
  let prompt = `You are an SEO account manager at Clixsy, a digital marketing agency. Analyze the following client performance data and provide a structured report.

CLIENT: ${data.projectName}
DESCRIPTION: ${data.description}
REPORTING PERIOD: ${data.startDate} to ${data.endDate}

=== PROJECT TASKS ===
- Tasks completed in period: ${data.completedTasks.length}
- Total open tasks: ${data.openTasks.length}
- Overdue tasks: ${data.overdueTasks.length}
- Total tasks tracked: ${data.totalTasks}
`;

  if (data.completedTasks.length > 0) {
    prompt += `\nCompleted tasks:\n`;
    for (const t of data.completedTasks.slice(0, 20)) {
      prompt += `  - ${stripHtml(t.title)} [${t.list_title}] (${t.completed_on?.split("T")[0] || "unknown date"})\n`;
    }
    if (data.completedTasks.length > 20) {
      prompt += `  ... and ${data.completedTasks.length - 20} more\n`;
    }
  }

  if (data.overdueTasks.length > 0) {
    prompt += `\nOverdue tasks:\n`;
    for (const t of data.overdueTasks.slice(0, 10)) {
      prompt += `  - ${stripHtml(t.title)} (due: ${t.due_on})\n`;
    }
  }

  if (data.gsc) {
    prompt += `\n=== GOOGLE SEARCH CONSOLE (${data.gsc.daysOfData} days of data) ===
- Total clicks: ${data.gsc.clicks.toLocaleString()}
- Total impressions: ${data.gsc.impressions.toLocaleString()}
- Average CTR: ${(data.gsc.ctr * 100).toFixed(1)}%
- Average position: ${data.gsc.avgPosition}
`;
    if (data.gsc.topQueries.length > 0) {
      prompt += `\nTop search queries:\n`;
      for (const q of data.gsc.topQueries.slice(0, 10)) {
        prompt += `  - "${q.query}" — ${q.clicks} clicks, ${q.impressions.toLocaleString()} impressions, pos ${q.position.toFixed(1)}\n`;
      }
    }
  }

  if (data.ga4) {
    prompt += `\n=== GOOGLE ANALYTICS (${data.ga4.daysOfData} days of data) ===
- Sessions: ${data.ga4.sessions.toLocaleString()}
- Users: ${data.ga4.users.toLocaleString()}
- Page views: ${data.ga4.pageViews.toLocaleString()}
- Organic sessions (full period): ${data.ga4.organicSessions.toLocaleString()}
`;
    if (data.ga4.channels.length > 0) {
      prompt += `\nTraffic channels:\n`;
      for (const c of data.ga4.channels) {
        prompt += `  - ${c.channel}: ${c.sessions.toLocaleString()} sessions\n`;
      }
    }
  }

  if (data.brightLocal) {
    prompt += `\n=== LOCAL SEO (BrightLocal - current snapshot) ===
- Locations tracked: ${data.brightLocal.locationCount}
- Rankings up: ${data.brightLocal.totalRankingsUp}
- Rankings down: ${data.brightLocal.totalRankingsDown}
- Live citations: ${data.brightLocal.totalCitations}
- Average Google rank: ${data.brightLocal.avgGoogleRank}
- Local Search Grid avg: ${data.brightLocal.avgLsgRank}
- Review rating: ${data.brightLocal.reviewRating}
- Total reviews: ${data.brightLocal.totalReviews}
- GBP calls: ${data.brightLocal.totalGmbCalls}
`;
  }

  prompt += `
=== YOUR TASK ===
Provide a structured performance report with these exact sections. Use markdown formatting.

## Period Summary
A 2-3 sentence executive summary of overall performance this period.

## What Went Well
Bullet points of positive highlights (completed tasks, ranking improvements, traffic gains, etc.)

## Areas of Concern
Bullet points of issues that need attention (overdue tasks, ranking drops, low CTR, etc.)

## Recommendations
3-5 specific, actionable recommendations for the next period. Be specific to this client's data.

Keep the tone professional but direct. Reference specific numbers from the data. Be concise — this is for an internal account manager, not the client.`;

  return prompt;
}
