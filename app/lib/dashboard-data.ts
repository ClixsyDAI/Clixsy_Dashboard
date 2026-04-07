import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface Todo {
  id: number;
  title: string;
  list_title: string;
  completed: boolean;
  due_on: string | null;
  created_at: string;
  updated_at: string;
  completed_on: string | null;
  comments_count: number;
  assignees: string;
  app_url: string;
  description: string;
  visible_to_clients: boolean;
}

export interface ScoredTodo extends Todo {
  impact_score: number;
  impact_rationale: string;
}

export interface CategoryData {
  name: string;
  completed: number;
  outstanding: number;
}

export interface CommentData {
  name: string;
  comments: number;
}

export interface TimelineData {
  month: string;
  completed: number;
}

const HIGH_IMPACT_KEYWORDS = [
  "homepage", "sitewide", "site-wide", "all pages", "all forms",
  "tracking", "conversion", "lead", "form", "booking", "schedule",
  "phone number", "call tracking", "chatbot", "review", "gbp",
  "google business", "schema", "restructur", "pruning", "redirect",
  "301", "meta title", "meta description", "h1", "url restructure",
  "compliance", "tcr",
];

function stripHtml(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(
    new RegExp("<bc-attachment[^>]*>.*?</bc-attachment>", "gs"),
    ""
  );
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

function computeImpactScore(todo: Todo): { score: number; rationale: string } {
  let score = 0;
  const reasons: string[] = [];
  const combined = `${(todo.title || "").toLowerCase()} ${stripHtml(
    todo.description || ""
  ).toLowerCase()} ${(todo.list_title || "").toLowerCase()}`;

  const highMatches = HIGH_IMPACT_KEYWORDS.filter((kw) =>
    combined.includes(kw)
  );
  if (highMatches.length > 0) {
    score += Math.min(highMatches.length * 8, 30);
    if (
      ["homepage", "sitewide", "all pages", "all forms"].some((kw) =>
        combined.includes(kw)
      )
    ) {
      reasons.push("Affects homepage or sitewide elements");
    } else if (
      ["form", "lead", "conversion", "booking", "schedule", "chatbot"].some(
        (kw) => combined.includes(kw)
      )
    ) {
      reasons.push("Impacts lead flow or conversion path");
    } else if (
      ["restructur", "pruning", "301", "redirect"].some((kw) =>
        combined.includes(kw)
      )
    ) {
      reasons.push("Sitewide technical/structural change");
    } else if (
      ["gbp", "google business", "review"].some((kw) =>
        combined.includes(kw)
      )
    ) {
      reasons.push("Affects local visibility or reputation");
    } else if (
      ["tracking", "compliance", "tcr"].some((kw) => combined.includes(kw))
    ) {
      reasons.push("Compliance or tracking infrastructure");
    } else {
      reasons.push("Touches high-impact area");
    }
  }

  const comments = todo.comments_count || 0;
  if (comments >= 20) {
    score += 20;
    reasons.push(`Heavy stakeholder discussion (${comments} comments)`);
  } else if (comments >= 10) {
    score += 12;
    reasons.push(`Active discussion (${comments} comments)`);
  } else if (comments >= 5) {
    score += 6;
  }

  if (todo.due_on && !todo.completed) {
    const dueDate = new Date(todo.due_on);
    const now = new Date();
    const daysUntil = Math.floor(
      (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil < 0) {
      score += 15;
      reasons.push(`Overdue by ${Math.abs(daysUntil)} days`);
    } else if (daysUntil <= 7) {
      score += 10;
      reasons.push("Due within 7 days");
    }
  }

  if (todo.list_title.toLowerCase().includes("client change")) {
    score += 5;
    if (!reasons.some((r) => r.toLowerCase().includes("client"))) {
      reasons.push("Client-requested change");
    }
  }

  if (
    ["content plan", "content optimization", "new content", "blog", "faq"].some(
      (kw) => combined.includes(kw)
    )
  ) {
    score += 5;
    reasons.push("Content/SEO impact");
  }

  if (todo.assignees && todo.assignees.includes(",")) {
    score += 3;
  }

  score = Math.min(score, 100);
  const rationale =
    reasons.length > 0 ? reasons.slice(0, 3).join("; ") : "Standard task";
  return { score, rationale };
}

function cleanListTitle(title: string): string {
  return title
    .replace(/:$/, "")
    .trim()
    .replace(/^5\.\s*/, "");
}

function truncate(text: string, maxLen: number = 80): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

export function loadClientTodos(projectId: string): Todo[] | null {
  const filePath = join(
    process.cwd(),
    "app",
    "data",
    "clients",
    `${projectId}.json`
  );
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Todo[];
}

export function getDashboardData(projectId: string, clientName: string) {
  const todos = loadClientTodos(projectId);

  if (!todos || todos.length === 0) {
    return null;
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const allCompleted = todos.filter((t) => t.completed);
  const allOutstanding = todos.filter((t) => !t.completed);
  const total = todos.length;
  const completedCount = allCompleted.length;
  const outstandingCount = allOutstanding.length;
  const completionRate = total > 0 ? (completedCount / total) * 100 : 0;

  const periodCompleted = allCompleted.filter(
    (t) => t.completed_on && new Date(t.completed_on) >= cutoff
  );

  // Last 10 tasks worked on (by updated_at desc)
  const last10Updated = [...todos]
    .filter((t) => t.updated_at)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      title: stripHtml(t.title),
      description: stripHtml(t.description || "").slice(0, 600),
      list_title: cleanListTitle(t.list_title),
      completed: t.completed,
      updated_at: t.updated_at,
      app_url: t.app_url,
    }));

  const topCommented = [...todos]
    .sort((a, b) => (b.comments_count || 0) - (a.comments_count || 0))
    .slice(0, 10)
    .map((t) => ({
      ...t,
      title: stripHtml(t.title),
      list_title: cleanListTitle(t.list_title),
      assignees: truncate(t.assignees, 30),
    }));

  const scoredTodos: ScoredTodo[] = todos.map((t) => {
    const { score, rationale } = computeImpactScore(t);
    return { ...t, impact_score: score, impact_rationale: rationale };
  });

  const topImpact = [...scoredTodos]
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, 10)
    .map((t) => ({
      ...t,
      title: stripHtml(t.title),
      list_title: cleanListTitle(t.list_title),
      assignees: truncate(t.assignees, 25),
      impact_rationale: truncate(t.impact_rationale, 80),
    }));

  // Category data for bar chart
  const categoryMap = new Map<
    string,
    { completed: number; outstanding: number }
  >();
  todos.forEach((t) => {
    const cat = cleanListTitle(t.list_title);
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { completed: 0, outstanding: 0 });
    }
    const entry = categoryMap.get(cat)!;
    if (t.completed) {
      entry.completed++;
    } else {
      entry.outstanding++;
    }
  });
  const categoryData: CategoryData[] = Array.from(categoryMap.entries())
    .map(([name, counts]) => ({
      name: truncate(name, 30),
      completed: counts.completed,
      outstanding: counts.outstanding,
    }))
    .sort(
      (a, b) =>
        b.completed + b.outstanding - (a.completed + a.outstanding)
    );

  // Comment activity data for horizontal bar chart
  const commentData: CommentData[] = [...todos]
    .sort((a, b) => (b.comments_count || 0) - (a.comments_count || 0))
    .slice(0, 10)
    .filter((t) => t.comments_count > 0)
    .map((t) => ({
      name: truncate(stripHtml(t.title), 40),
      comments: t.comments_count,
    }));

  // Timeline data
  const monthMap = new Map<string, number>();
  allCompleted.forEach((t) => {
    if (t.completed_on) {
      const d = new Date(t.completed_on);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}`;
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    }
  });
  const timelineData: TimelineData[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, completed]) => {
      const [y, m] = month.split("-");
      const date = new Date(parseInt(y), parseInt(m) - 1);
      return {
        month: date.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        completed,
      };
    });

  const periodStart = cutoff.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const periodEnd = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const lastRefreshed = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const uniqueLists = new Set(todos.map((t) => t.list_title)).size;

  return {
    clientName,
    periodStart,
    periodEnd,
    lastRefreshed,
    total,
    completedCount,
    outstandingCount,
    completionRate: Math.round(completionRate),
    periodCompletedCount: periodCompleted.length,
    last10Updated,
    topCommented,
    topImpact,
    uniqueLists,
    categoryData,
    commentData,
    timelineData,
  };
}
