import rawTodos from "../data/bc_raw_todos.json";

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

const HIGH_IMPACT_KEYWORDS = [
  "homepage",
  "sitewide",
  "site-wide",
  "all pages",
  "all forms",
  "tracking",
  "conversion",
  "lead",
  "form",
  "booking",
  "schedule",
  "phone number",
  "call tracking",
  "chatbot",
  "review",
  "gbp",
  "google business",
  "schema",
  "restructur",
  "pruning",
  "redirect",
  "301",
  "meta title",
  "meta description",
  "h1",
  "url restructure",
  "compliance",
  "tcr",
];

function stripHtml(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(new RegExp("<bc-attachment[^>]*>.*?</bc-attachment>", "gs"), "");
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
  const combined = `${(todo.title || "").toLowerCase()} ${stripHtml(todo.description || "").toLowerCase()} ${(todo.list_title || "").toLowerCase()}`;

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

export function getDashboardData() {
  const todos = rawTodos as Todo[];
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
    clientName: "J153 Sunset Heating",
    clientDomain: "sunsethc.com",
    periodStart,
    periodEnd,
    lastRefreshed,
    total,
    completedCount,
    outstandingCount,
    completionRate: Math.round(completionRate),
    periodCompletedCount: periodCompleted.length,
    topCommented,
    topImpact,
    uniqueLists,
  };
}
