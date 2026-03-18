"use client";

import { useState, useMemo } from "react";

interface Todo {
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
}

interface ProjectLogTableProps {
  todos: Todo[];
}

type SortKey = "created_at" | "due_on" | "list_title" | "title" | "completed" | "comments_count" | "assignees";
type SortDir = "asc" | "desc";

function stripHtml(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(new RegExp("<bc-attachment[^>]*>.*?</bc-attachment>", "gs"), "");
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  cleaned = cleaned.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(todo: Todo): boolean {
  if (todo.completed || !todo.due_on) return false;
  return new Date(todo.due_on) < new Date();
}

export default function ProjectLogTable({ todos }: ProjectLogTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [tasklistFilter, setTasklistFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Get unique tasklists
  const tasklists = useMemo(() => {
    const lists = new Set(todos.map((t) => t.list_title));
    return Array.from(lists).sort();
  }, [todos]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = [...todos];

    // Status filter
    if (filter === "open") result = result.filter((t) => !t.completed);
    if (filter === "done") result = result.filter((t) => t.completed);

    // Tasklist filter
    if (tasklistFilter !== "all") {
      result = result.filter((t) => t.list_title === tasklistFilter);
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          stripHtml(t.description).toLowerCase().includes(q) ||
          t.assignees.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "created_at":
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case "due_on":
          cmp = (a.due_on || "9999").localeCompare(b.due_on || "9999");
          break;
        case "list_title":
          cmp = a.list_title.localeCompare(b.list_title);
          break;
        case "title":
          cmp = stripHtml(a.title).localeCompare(stripHtml(b.title));
          break;
        case "completed":
          cmp = (a.completed ? 1 : 0) - (b.completed ? 1 : 0);
          break;
        case "comments_count":
          cmp = a.comments_count - b.comments_count;
          break;
        case "assignees":
          cmp = a.assignees.localeCompare(b.assignees);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [todos, filter, tasklistFilter, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const openCount = todos.filter((t) => !t.completed).length;
  const doneCount = todos.filter((t) => t.completed).length;
  const overdueCount = todos.filter(isOverdue).length;

  return (
    <div>
      {/* Summary Bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex gap-2">
          <StatPill label="Total" value={todos.length} />
          <StatPill label="Open" value={openCount} color="#C8A882" />
          <StatPill label="Done" value={doneCount} color="#2d6a4f" />
          {overdueCount > 0 && <StatPill label="Overdue" value={overdueCount} color="#e74c3c" />}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-sm px-3 py-1.5 text-sm outline-none"
          style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #333", width: 220 }}
        />

        <div className="flex gap-1">
          {(["all", "open", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="rounded-sm px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-all"
              style={{
                backgroundColor: filter === f ? "#C8A882" : "#1a1a1a",
                color: filter === f ? "#0a0a0a" : "#888",
                border: `1px solid ${filter === f ? "#C8A882" : "#333"}`,
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <select
          value={tasklistFilter}
          onChange={(e) => setTasklistFilter(e.target.value)}
          className="rounded-sm px-3 py-1.5 text-xs outline-none"
          style={{ backgroundColor: "#1a1a1a", color: "#f0ede8", border: "1px solid #333" }}
        >
          <option value="all">All Tasklists</option>
          {tasklists.map((tl) => (
            <option key={tl} value={tl}>{tl}</option>
          ))}
        </select>

        <span className="text-xs ml-auto" style={{ color: "#888" }}>
          Showing {filtered.length} of {todos.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-sm" style={{ border: "1px solid #222" }}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: "#1a1a1a" }}>
              <SortTh label="Created" sortKey="created_at" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortTh label="Due" sortKey="due_on" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortTh label="Done?" sortKey="completed" current={sortKey} dir={sortDir} onClick={handleSort} width={70} />
              <SortTh label="Tasklist" sortKey="list_title" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortTh label="Title" sortKey="title" current={sortKey} dir={sortDir} onClick={handleSort} />
              <th className="px-3 py-2.5 text-xs font-semibold tracking-wide" style={{ color: "#f0ede8" }}>Description</th>
              <SortTh label="Assigned to" sortKey="assignees" current={sortKey} dir={sortDir} onClick={handleSort} />
              <th className="px-3 py-2.5 text-xs font-semibold tracking-wide text-center" style={{ color: "#f0ede8", width: 50 }}>BC</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => {
              const overdue = isOverdue(t);
              const rowBg = t.completed
                ? i % 2 === 0 ? "rgba(45,106,79,0.08)" : "rgba(45,106,79,0.04)"
                : overdue
                ? "rgba(231,76,60,0.08)"
                : i % 2 === 0 ? "#111111" : "#141414";

              return (
                <tr key={t.id} style={{ backgroundColor: rowBg }}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: "#888" }}>
                    {formatDate(t.created_at)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: overdue ? "#e74c3c" : "#888" }}>
                    {formatDate(t.due_on)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: t.completed ? "#2d6a4f" : overdue ? "#e74c3c" : "#333",
                      }}
                      title={t.completed ? `Done ${formatDate(t.completed_on)}` : overdue ? "Overdue" : "Open"}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: "#C8A882" }}>
                    {cleanListTitle(t.list_title)}
                  </td>
                  <td className="px-3 py-2 font-medium" style={{ color: "#f0ede8", maxWidth: 300 }}>
                    <div className="truncate" title={stripHtml(t.title)}>
                      {stripHtml(t.title)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: "#666", maxWidth: 250 }}>
                    <div className="truncate" title={stripHtml(t.description)}>
                      {truncate(stripHtml(t.description), 80)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: "#888" }}>
                    {truncate(t.assignees, 25)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <a
                      href={t.app_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline"
                      style={{ color: "#C8A882" }}
                    >
                      Link
                    </a>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm" style={{ color: "#666" }}>
                  No tasks match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortTh({
  label,
  sortKey,
  current,
  dir,
  onClick,
  width,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  width?: number;
}) {
  const active = current === sortKey;
  const arrow = active ? (dir === "asc" ? " \u25B2" : " \u25BC") : "";
  return (
    <th
      className="px-3 py-2.5 text-xs font-semibold tracking-wide cursor-pointer select-none hover:text-white transition-colors"
      style={{ color: active ? "#C8A882" : "#f0ede8", width }}
      onClick={() => onClick(sortKey)}
    >
      {label}{arrow}
    </th>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-sm px-2.5 py-1" style={{ backgroundColor: "#1a1a1a" }}>
      <span className="text-xs font-bold" style={{ color: color || "#fff" }}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "#888" }}>{label}</span>
    </div>
  );
}

function cleanListTitle(title: string): string {
  return title.replace(/:$/, "").trim().replace(/^5\.\s*/, "");
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}
