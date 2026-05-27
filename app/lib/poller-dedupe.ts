// =============================================================
// Basecamp poller — dedupe layer
// =============================================================
//
// Phase 3 Step 2. Sits between [[basecamp-poller]]'s listJProjects()
// and the per-project processor: given the list of J-numbered
// Basecamp projects, drop anything we already have an entry for in
// app/data/projects.json so the cron doesn't re-process the same
// project on every run.
//
// Dedupe is by Basecamp project id, not by name — names can change
// in Basecamp without affecting the workbook's link. The id is the
// stable workbook_id we wrote in Phase 2a's onboarding-repo update.
//
// Best-effort within a single cron run. The bundled projects.json
// is the source of truth for "already known"; mid-run commits via
// commitProjectsManifest update GitHub but not the Vercel function's
// local filesystem. The onboarding repo's 409
// "workbook_id_already_linked" response (Phase 2a, [[onboarding-repo]])
// is the ultimate idempotency guarantee against a same-id retry.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { BasecampProject } from "./basecamp-poller";

/**
 * Read app/data/projects.json and return the Basecamp project ids
 * already present in the manifest. Reads fresh from disk each call
 * rather than relying on the cached `import projects from ...`
 * pattern used elsewhere in the codebase, so that within a single
 * runtime instance subsequent reads can see filesystem updates
 * (currently the bundle is read-only at runtime, but the explicit
 * read makes the contract clear if that ever changes).
 *
 * Returns an array per spec; callers wrap in a Set for O(1)
 * membership in filterNewProjects.
 */
export function getExistingProjectIds(): number[] {
  // app/data/projects.json is two directories up from this file
  // (app/lib/poller-dedupe.ts → app/data/projects.json).
  const manifestPath = path.join(
    process.cwd(),
    "app",
    "data",
    "projects.json",
  );
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as Array<{ id: number }>;
  return manifest.map((p) => p.id);
}

/**
 * Filter the list of Basecamp J-projects down to those whose id
 * isn't already in the manifest. Pure function — no I/O, no global
 * state. Caller passes a `Set<number>` (from getExistingProjectIds
 * wrapped) to keep the membership check O(1).
 */
export function filterNewProjects(
  basecampProjects: BasecampProject[],
  existing: Set<number>,
): BasecampProject[] {
  return basecampProjects.filter((p) => !existing.has(p.id));
}
