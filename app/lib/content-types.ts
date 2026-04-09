export type ContentStatus =
  | "content-in-progress"
  | "content-for-review"
  | "queued-for-launch"
  | "published";

export interface ContentArticle {
  id: string;
  month: string; // YYYY-MM
  title: string;
  type: string;
  status: ContentStatus;
  contentLink?: string;
  liveUrl?: string;
  brief?: string;
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
