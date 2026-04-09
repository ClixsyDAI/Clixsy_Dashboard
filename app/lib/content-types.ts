export type ContentStatus =
  | "content-in-progress"
  | "content-for-review"
  | "queued-for-launch"
  | "published";

export interface ContentArticle {
  id: string;
  month: string; // YYYY-MM (legacy / local)
  title: string;
  type: string;
  status: ContentStatus;
  rawStatus?: string;
  contentLink?: string;
  liveUrl?: string;
  brief?: string;
  // Google Sheets-backed fields
  writer?: string | null;
  publishDate?: string | null;
  dueMonth?: string | null;
  dueYear?: number | null;
  domain?: string | null;
  source?: "google_sheets" | "local";
}

export const CONTENT_STATUS_META: Record<
  ContentStatus,
  { label: string; color: string }
> = {
  "content-in-progress": { label: "In Progress", color: "#3b82f6" },
  "content-for-review": { label: "For Review", color: "#f59e0b" },
  "queued-for-launch": { label: "Queued for Launch", color: "#8b5cf6" },
  published: { label: "Published", color: "#22c55e" },
};

export function contentStorageKey(projectId: string) {
  return `clixsy-content-${projectId}`;
}

/** Map any sheet status value to a dashboard workflow stage. */
export function mapSheetStatus(raw: string | null | undefined): {
  status: ContentStatus;
  mapped: boolean;
} {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return { status: "content-in-progress", mapped: false };
  if (v.includes("complet") || v.includes("publish") || v.includes("live")) {
    return { status: "published", mapped: true };
  }
  if (v.includes("review") || v.includes("edit")) {
    return { status: "content-for-review", mapped: true };
  }
  if (v.includes("queue") || v.includes("schedul") || v.includes("ready")) {
    return { status: "queued-for-launch", mapped: true };
  }
  if (v.includes("progress") || v.includes("writ") || v.includes("draft")) {
    return { status: "content-in-progress", mapped: true };
  }
  return { status: "content-in-progress", mapped: false };
}

/** Strip "J### " prefix from project name → "J153 Sunset Heating" → "Sunset Heating" */
export function normalizeClientName(name: string): string {
  return name.replace(/^J\d+\s+/i, "").trim();
}
