// =============================================================
// Basecamp-to-Workbook poller — primitives
// =============================================================
//
// Phase 3 Step 1 per the operator's spec: list every J-numbered
// Basecamp project on the account, and for any single project pull
// the message_board / todoset ids from its dock array.
//
// Later steps wrap these primitives with dedupe logic
// ([[poller-dedupe]]) and a single-project processor that creates
// the onboarding session, commits a projects.json entry, and posts
// the form-ready message to the project's message board.
//
// All functions are pure HTTP wrappers over the existing
// basecampFetch/basecampFetchOne helpers in app/lib/basecamp.ts
// — they don't read or write any local state.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BASECAMP_API_BASE,
  basecampFetch,
  basecampFetchOne,
} from "./basecamp";
import { commitProjectsManifest } from "./github";

const USER_AGENT = "Client Workbook Dashboard (johan@clixsy.com)";
const ONBOARDING_BASE_URL = "https://client-onboarding-tool.vercel.app";
const WORKBOOK_BASE_URL = "https://client-workbook-dashboard.vercel.app";

// =============================================================
// Types
// =============================================================

/**
 * Entry inside a project's `dock` array. Basecamp's project payload
 * carries one entry per tool slot (message_board, todoset, schedule,
 * chat, questionnaire, vault, inbox). The `name` field is the stable
 * machine identifier; `title` is the human-facing label.
 *
 * Only the fields the poller actually reads are typed here. The
 * upstream shape has more (position, url, app_url, …) — the wider
 * type is intentionally elided to keep the surface narrow.
 */
export interface BasecampDockEntry {
  id: number;
  name: string;
  enabled: boolean;
}

/**
 * Project payload returned by GET /projects.json (list) and
 * GET /projects/{id}.json (single). Only the fields the poller
 * uses are typed. The full payload includes status, color,
 * purpose, timesheet_enabled, etc. — see the bc3-api projects
 * section if any of those are needed later.
 */
export interface BasecampProject {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  dock: BasecampDockEntry[];
}

// =============================================================
// J-pattern detection
// =============================================================

/**
 * Project names that should be treated as Clixsy client projects.
 * Examples that match: "J101 Fielding Law", "J353 Andrew Pickett Law",
 * "J999 INTEGRATION TEST 2026-05-26 DO NOT TOUCH".
 * Examples that don't: "Internal Ops", "J", "J354" (no space),
 * "j354 lowercase".
 *
 * Anchored to start. Allows any non-J text in the project description
 * after the J-number — only the leading prefix is significant.
 */
export const J_PATTERN = /^J\d+\s+/;

// =============================================================
// Primitives
// =============================================================

/**
 * List every J-numbered Basecamp project on the account.
 *
 * Uses the existing basecampFetch helper which follows Link-header
 * pagination automatically, so a 200+ project account returns the
 * full list in a single call.
 *
 * Returns only the projects whose `name` matches J_PATTERN. The
 * filter is applied client-side because the Basecamp 3 projects
 * endpoint has no name-filter query param (per bc3-api docs).
 */
export async function listJProjects(
  accessToken: string,
): Promise<BasecampProject[]> {
  const url = `${BASECAMP_API_BASE}/projects.json`;
  const all = await basecampFetch<BasecampProject>(url, accessToken);
  return all.filter((p) => J_PATTERN.test(p.name));
}

/**
 * Get the message-board id from a project's dock array.
 *
 * `dock` entries always include slots for every tool type even if
 * disabled; we don't check `enabled` here because every project we
 * create has the message board enabled by default. Throws if the
 * dock has no message_board entry at all (would indicate a malformed
 * project payload or an API shape change).
 */
export async function getProjectMessageBoardId(
  projectId: number,
  accessToken: string,
): Promise<number> {
  const url = `${BASECAMP_API_BASE}/projects/${projectId}.json`;
  const project = await basecampFetchOne<BasecampProject>(url, accessToken);
  const entry = project.dock.find((d) => d.name === "message_board");
  if (!entry) {
    throw new Error(
      `Project ${projectId} dock has no message_board entry`,
    );
  }
  return entry.id;
}

/**
 * Get the todoset id from a project's dock array. Same shape as
 * getProjectMessageBoardId. The todoset id is what gets written to
 * app/data/projects.json so the workbook's existing sync flow can
 * fetch the project's todos.
 */
export async function getProjectTodosetId(
  projectId: number,
  accessToken: string,
): Promise<number> {
  const url = `${BASECAMP_API_BASE}/projects/${projectId}.json`;
  const project = await basecampFetchOne<BasecampProject>(url, accessToken);
  const entry = project.dock.find((d) => d.name === "todoset");
  if (!entry) {
    throw new Error(
      `Project ${projectId} dock has no todoset entry`,
    );
  }
  return entry.id;
}

/**
 * Combined dock fetch — single GET, returns both ids. The cron's
 * processNewProject path needs both message_board_id and todoset_id,
 * so doing one fetch instead of two halves the Basecamp API spend
 * per cron run.
 */
export async function getProjectDockIds(
  projectId: number,
  accessToken: string,
): Promise<{ messageBoardId: number; todosetId: number }> {
  const url = `${BASECAMP_API_BASE}/projects/${projectId}.json`;
  const project = await basecampFetchOne<BasecampProject>(url, accessToken);
  const board = project.dock.find((d) => d.name === "message_board");
  const todoset = project.dock.find((d) => d.name === "todoset");
  if (!board || !todoset) {
    throw new Error(
      `Project ${projectId} dock missing message_board or todoset slot: ${JSON.stringify(project.dock.map((d) => d.name))}`,
    );
  }
  return { messageBoardId: board.id, todosetId: todoset.id };
}

// =============================================================
// Per-project processor — Step 3
// =============================================================

/**
 * Strip the J-number prefix from a Basecamp project name.
 *
 *   "J354 Sunset Heating" → "Sunset Heating"
 *   "J999 INTEGRATION TEST" → "INTEGRATION TEST"
 *
 * Mirrors J_PATTERN so anything caller-side accepts here will also
 * match the listJProjects filter.
 */
export function extractClientName(projectName: string): string {
  return projectName.replace(/^J\d+\s+/, "").trim();
}

/**
 * Result of processing a single new Basecamp project. Discriminated
 * by `status` so the cron handler can aggregate counts without a
 * try/catch wrapper around each call.
 */
export type ProcessResult =
  | {
      status: "success";
      project_id: number;
      session_id: string;
      token: string;
      pin: string;
      message_id: number | null;
    }
  | {
      status: "skipped_409";
      project_id: number;
      reason: "workbook_id_already_linked";
    }
  | {
      status: "failed_onboarding_create";
      project_id: number;
      error: string;
      upstream_status?: number;
    }
  | {
      status: "failed_dock_fetch";
      project_id: number;
      error: string;
    }
  | {
      status: "failed_projects_commit";
      project_id: number;
      error: string;
      session_id: string;
      token: string;
    }
  | {
      status: "failed_message_post";
      project_id: number;
      error: string;
      session_id: string;
      token: string;
    };

type OnboardingCreateOutcome =
  | { kind: "ok"; sessionId: string; token: string; pin: string }
  | { kind: "conflict" }
  | { kind: "error"; status: number; message: string };

/** Cross-repo POST to the onboarding repo's create endpoint (Phase 2a). */
async function createOnboardingSession(
  project: BasecampProject,
  clientName: string,
  bearerToken: string,
): Promise<OnboardingCreateOutcome> {
  const res = await fetch(
    `${ONBOARDING_BASE_URL}/api/admin/onboarding/create`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientName,
        // Sentinel for "no human has claimed this yet". The onboarding
        // repo's Zod schema rejects empty strings here (Phase 2a). The
        // AM replaces this via the workbook UI when picking up the
        // client. Follow-up: make account_manager nullable, validate
        // at form-send time instead — would remove the sentinel.
        accountManager: "Auto-created (unassigned)",
        vertical: "law_firm",
        workbookId: project.id,
      }),
    },
  );
  if (res.status === 409) {
    return { kind: "conflict" };
  }
  if (!res.ok) {
    let message = "unknown";
    try {
      message = await res.text();
    } catch {
      /* swallow */
    }
    return { kind: "error", status: res.status, message };
  }
  const body = (await res.json()) as {
    success?: boolean;
    sessionId?: string;
    token?: string;
    pin?: string;
  };
  if (!body.sessionId || !body.token || !body.pin) {
    return {
      kind: "error",
      status: res.status,
      message: "onboarding response missing sessionId/token/pin",
    };
  }
  return {
    kind: "ok",
    sessionId: body.sessionId,
    token: body.token,
    pin: body.pin,
  };
}

/** Append a single entry to the in-memory copy of projects.json and
 * commit the full manifest. Read fresh from disk so concurrent
 * commits (in-process) don't lose entries. */
async function appendAndCommitManifest(
  newEntry: {
    id: number;
    name: string;
    description: string;
    todoset_id: number;
  },
): Promise<void> {
  const manifestPath = path.join(
    process.cwd(),
    "app",
    "data",
    "projects.json",
  );
  const current = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{
    id: number;
    name: string;
    description: string;
    todoset_id: number;
  }>;
  // Guard against an in-process race: if for any reason the entry is
  // already in the manifest (e.g. a previous half-success on this
  // same run), skip the duplicate rather than committing twice.
  if (current.some((p) => p.id === newEntry.id)) return;
  const updated = [...current, newEntry];
  await commitProjectsManifest(updated);
}

/** Post the kickoff "form ready" message to a project's message board. */
async function postKickoffMessage(
  project: BasecampProject,
  messageBoardId: number,
  accessToken: string,
  context: {
    clientName: string;
    workbookId: number;
    formToken: string;
  },
): Promise<number> {
  const workbookUrl = `${WORKBOOK_BASE_URL}/client/${context.workbookId}`;
  const formUrl = `${ONBOARDING_BASE_URL}/onboarding/${context.formToken}`;
  // Plain HTML — Basecamp's rich-text renderer collapses inter-<p>
  // spacing so back-to-back paragraphs read as one wall of text.
  // Explicit <br> between blocks restores the visual separation.
  // Block 2 (PIN instruction header + workbook link) is kept as
  // back-to-back <p>s on purpose — they belong together.
  const content =
    `<p>The onboarding form for ${context.clientName} is ready to send.</p>` +
    `<br>` +
    `<p>To get the access PIN, open the client in the workbook:</p>` +
    `<p><a href="${workbookUrl}">Open ${context.clientName} in workbook</a></p>` +
    `<br>` +
    `<p>Click "Regenerate PIN code" on the Onboarding tab to generate a fresh PIN, then send the form link and PIN to the client.</p>` +
    `<br>` +
    `<p><strong>Form link:</strong> <a href="${formUrl}">${formUrl}</a></p>`;

  const url = `${BASECAMP_API_BASE}/buckets/${project.id}/message_boards/${messageBoardId}/messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject: `Client onboarding form ready: ${context.clientName}`,
      status: "active",
      content,
    }),
  });
  if (res.status !== 201) {
    throw new Error(
      `Basecamp message post ${res.status}: ${await res.text()}`,
    );
  }
  const msg = (await res.json()) as { id: number };
  return msg.id;
}

/**
 * Process a single new Basecamp project end-to-end:
 *   (a) Fetch dock once — get message_board_id + todoset_id.
 *   (b) Create onboarding session via cross-repo POST. On 409 from
 *       the workbook_id UNIQUE constraint, return "skipped_409" so
 *       the batch can keep going.
 *   (c) Read app/data/projects.json, append a new entry.
 *   (d) Commit the updated manifest to GitHub.
 *   (e) Post the kickoff message to the project's message board,
 *       unless opts.skipBasecampMessage === true. When skipped,
 *       message_id is null and the result is still "success".
 *
 * The cron-route caller (Step 4) passes an already-validated
 * accessToken so a batch of N projects doesn't pay for N token
 * probes. Step 4 also reads the opts.skipBasecampMessage flag from
 * the ?skip_basecamp_message=true query param on the request.
 */
export async function processNewProject(
  project: BasecampProject,
  accessToken: string,
  opts?: { skipBasecampMessage?: boolean },
): Promise<ProcessResult> {
  const clientName = extractClientName(project.name);

  // (a) Single GET on /projects/{id}.json — both ids out at once.
  let dockIds: { messageBoardId: number; todosetId: number };
  try {
    dockIds = await getProjectDockIds(project.id, accessToken);
  } catch (err) {
    return {
      status: "failed_dock_fetch",
      project_id: project.id,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // (b) Cross-repo onboarding create. Phase 2a's structured 409
  //     surfaces here as { kind: "conflict" } and short-circuits.
  const bearer = process.env.SHARED_INTEGRATION_BEARER_TOKEN;
  if (!bearer) {
    return {
      status: "failed_onboarding_create",
      project_id: project.id,
      error: "SHARED_INTEGRATION_BEARER_TOKEN not configured",
    };
  }
  const create = await createOnboardingSession(project, clientName, bearer);
  if (create.kind === "conflict") {
    console.warn(
      `[poller] workbook_id ${project.id} already linked in onboarding repo — skipping`,
    );
    return {
      status: "skipped_409",
      project_id: project.id,
      reason: "workbook_id_already_linked",
    };
  }
  if (create.kind === "error") {
    console.error(
      `[poller] onboarding create failed for project ${project.id}: ${create.message}`,
    );
    return {
      status: "failed_onboarding_create",
      project_id: project.id,
      error: create.message,
      upstream_status: create.status,
    };
  }
  const { sessionId, token, pin } = create;

  // (c) + (d) Append and commit projects.json. The onboarding row
  //     is already in Supabase at this point; if the commit fails
  //     we leave the row in place (Phase 2a's UNIQUE constraint
  //     means the next retry will hit "skipped_409" and the AM can
  //     resolve manually).
  try {
    await appendAndCommitManifest({
      id: project.id,
      name: project.name,
      description: "",
      todoset_id: dockIds.todosetId,
    });
  } catch (err) {
    console.error(
      `[poller] projects.json commit failed for project ${project.id}: ${err}`,
    );
    return {
      status: "failed_projects_commit",
      project_id: project.id,
      error: err instanceof Error ? err.message : String(err),
      session_id: sessionId,
      token,
    };
  }

  // (e) Conditional Basecamp message post.
  if (opts?.skipBasecampMessage === true) {
    return {
      status: "success",
      project_id: project.id,
      session_id: sessionId,
      token,
      pin,
      message_id: null,
    };
  }

  let messageId: number;
  try {
    messageId = await postKickoffMessage(
      project,
      dockIds.messageBoardId,
      accessToken,
      { clientName, workbookId: project.id, formToken: token },
    );
  } catch (err) {
    console.error(
      `[poller] message post failed for project ${project.id}: ${err}`,
    );
    return {
      status: "failed_message_post",
      project_id: project.id,
      error: err instanceof Error ? err.message : String(err),
      session_id: sessionId,
      token,
    };
  }

  return {
    status: "success",
    project_id: project.id,
    session_id: sessionId,
    token,
    pin,
    message_id: messageId,
  };
}
