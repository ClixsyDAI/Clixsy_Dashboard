import { getFileContents, commitProjectsManifest } from "./github";

/**
 * Canonical Project type for the workbook's master client list
 * (app/data/projects.json).
 *
 * Shape post-GHL-pivot:
 *
 *   - `id` is the **GHL opportunity id** (20-char alphanumeric string)
 *     for entries created via the webhook receiver. Existing migrated
 *     entries hold the prior Basecamp numeric id, stringified.
 *   - `name` is the **display name with the J-prefix stripped**.
 *     For migrated entries the prefix was parsed out into `j_number`.
 *   - `j_number` is the numeric portion of the historical J-tag
 *     (e.g. "412"), without the "J". New entries via GHL arrive
 *     `null` and get filled in by an AM later in the admin UI.
 *   - `vertical` distinguishes routing for downstream automations
 *     (e.g. law-firm onboarding form vs. home-services flow).
 *     All historical entries are hardcoded `"law_firm"` (per Johan).
 *   - `ghl_contact_id` / `am_ghl_user_id` come from the GHL webhook
 *     payload for new entries. `null` for historical entries with
 *     no GHL counterpart.
 *   - `website_url` mirrors the GHL Website URL custom field.
 */
export interface Project {
  id: string;
  name: string;
  j_number: string | null;
  description: string | null;
  vertical: "law_firm" | "home_services" | "other";
  ghl_contact_id: string | null;
  am_ghl_user_id: string | null;
  website_url: string | null;
}

/**
 * Format a project's name for display in internal AM-facing UI (the home
 * page card title, the client detail page header, the admin list). Restores
 * the "J<number> " prefix that the GHL-shape migration moved out of `name`
 * into the separate `j_number` field — AMs identify clients by J-number.
 *
 * Null/missing j_number falls back to bare name; this is the case for new
 * GHL-created entries before an AM assigns a J-number via the admin UI.
 *
 * Pure display layer. Do NOT use this for data-matching keys (content
 * article lookup, GSC/GA4 client matching, etc.) — those compare against
 * the bare `name`.
 *
 * Accepts the minimal subset of Project fields it needs so callers can pass
 * either a full Project, a ClientHealthSummary that exposes them, or any
 * other narrow shape.
 */
export function formatClientDisplayName(p: {
  name: string;
  j_number: string | null;
}): string {
  if (p.j_number) {
    return `J${p.j_number} ${p.name}`;
  }
  return p.name;
}

/**
 * Append a new project entry to app/data/projects.json on the default
 * branch and return the resulting commit SHA. Reads the live manifest
 * from GitHub (not the deployed bundle) so back-to-back webhook calls
 * within the same Vercel instance don't clobber each other — same
 * pattern the Basecamp poller used pre-pivot.
 *
 * Idempotent: if an entry with the same id already exists, returns
 * { skipped: true } without committing. Callers should still short-
 * circuit on this so the rest of the onboarding pipeline doesn't
 * double-fire.
 */
export async function appendProjectAndCommitManifest(
  newProject: Project,
): Promise<
  | { skipped: true; existing: Project }
  | { skipped: false; sha: string; url: string }
> {
  const file = await getFileContents("app/data/projects.json");
  if (!file) {
    throw new Error(
      "projects.json missing on default branch — cannot append safely",
    );
  }
  const current = JSON.parse(file.content) as Project[];
  const existing = current.find((p) => p.id === newProject.id);
  if (existing) {
    return { skipped: true, existing };
  }
  const next = [...current, newProject];
  const commit = await commitProjectsManifest(next);
  return { skipped: false, sha: commit.sha, url: commit.url };
}

/**
 * Update an existing project entry in app/data/projects.json. Used by
 * the admin UI's client editor — only the AM-editable fields (name,
 * j_number, description) are accepted as patch values. Read-only fields
 * (id, vertical, ghl_contact_id, am_ghl_user_id, website_url) are
 * preserved from the existing entry.
 *
 * Read-from-master pattern matches the append helper: never trust the
 * deployed bundle, always fetch the live manifest first. Returns
 * { found: false } when the id doesn't exist so the route can 404
 * cleanly; throws on GitHub I/O failures so the route 500s.
 */
export type ProjectEditableFields = Pick<
  Project,
  "name" | "j_number" | "description"
>;

export async function updateProjectInManifest(
  id: string,
  patch: ProjectEditableFields,
): Promise<
  | { found: false }
  | { found: true; updated: Project; sha: string; url: string }
> {
  const file = await getFileContents("app/data/projects.json");
  if (!file) {
    throw new Error(
      "projects.json missing on default branch — cannot update safely",
    );
  }
  const current = JSON.parse(file.content) as Project[];
  const idx = current.findIndex((p) => p.id === id);
  if (idx === -1) {
    return { found: false };
  }
  const existing = current[idx];
  const updated: Project = {
    ...existing,
    name: patch.name,
    j_number: patch.j_number,
    description: patch.description,
  };
  const next = [...current];
  next[idx] = updated;
  const commit = await commitProjectsManifest(next);
  return { found: true, updated, sha: commit.sha, url: commit.url };
}
