const BASECAMP_CLIENT_ID = process.env.BASECAMP_CLIENT_ID!;
const BASECAMP_CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET!;
const BASECAMP_REDIRECT_URI = process.env.BASECAMP_REDIRECT_URI!;
const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID || "4226914";

const USER_AGENT = "Client Workbook Dashboard (johan@clixsy.com)";
const TOKEN_URL = "https://launchpad.37signals.com/authorization/token";
export const BASECAMP_API_BASE = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}`;
// Internal alias kept for the existing callers in this file.
const API_BASE = BASECAMP_API_BASE;

export interface BasecampTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface BasecampTodoList {
  id: number;
  title: string;
  todos_url: string;
  groups_url: string;   // NEW — Basecamp always emits this; we now follow it for nested groups
  app_url: string;
}

export interface BasecampTodo {
  id: number;
  title: string;
  due_on: string | null;
  created_at: string;
  updated_at: string;
  completed: boolean;
  completion: { created_at: string } | null;
  comments_count: number;
  assignees: Array<{ name: string }>;
  app_url: string;
  description: string;
  visible_to_clients: boolean;
}

export interface FormattedTodo {
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

/** A Basecamp project as returned by /projects/{id}.json. The `dock`
 * array contains the tools attached to the project (message_board,
 * todoset, schedule, etc.); the todoset entry is the canonical place
 * to discover the project's todoset id post-pivot. */
export interface BasecampProjectDockEntry {
  id: number;
  title: string;
  name: string;
  enabled: boolean;
  position: number | null;
  url: string;
  app_url: string;
}

export interface BasecampProject {
  id: number;
  status: string;
  created_at: string;
  updated_at: string;
  name: string;
  description: string | null;
  purpose: string;
  clients_enabled: boolean;
  bookmark_url: string;
  url: string;
  app_url: string;
  dock: BasecampProjectDockEntry[];
}

/** Build the Basecamp OAuth authorization URL */
export function getAuthorizationUrl(): string {
  const params = new URLSearchParams({
    type: "web_server",
    client_id: BASECAMP_CLIENT_ID,
    redirect_uri: BASECAMP_REDIRECT_URI,
  });
  return `https://launchpad.37signals.com/authorization/new?${params.toString()}`;
}

/** Exchange an authorization code for tokens */
export async function exchangeCodeForTokens(
  code: string
): Promise<BasecampTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "web_server",
      client_id: BASECAMP_CLIENT_ID,
      redirect_uri: BASECAMP_REDIRECT_URI,
      client_secret: BASECAMP_CLIENT_SECRET,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

/** Refresh an expired access token.
 *
 * Launchpad's refresh endpoint returns only `{ access_token, token_type,
 * expires_in }` — no `refresh_token` field. Refresh tokens live until
 * natural expiry and are not rotated on use. Earlier versions of this
 * function returned `res.json()` verbatim and so produced an object
 * with `refresh_token: undefined`, which `storeBasecampTokens()` then
 * forwarded to the Vercel REST API and would silently wipe the
 * `BASECAMP_REFRESH_TOKEN` env var on the next refresh.
 *
 * Preserve the caller-supplied refresh_token in the return value so
 * downstream callers (sync routes → storeBasecampTokens →
 * upsertEnvVar) always see a real string.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<BasecampTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "refresh",
      refresh_token: refreshToken,
      client_id: BASECAMP_CLIENT_ID,
      redirect_uri: BASECAMP_REDIRECT_URI,
      client_secret: BASECAMP_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    token_type?: string;
    refresh_token?: string;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_in: data.expires_in,
  };
}

/** Make an authenticated Basecamp API request with pagination support */
export async function basecampFetch<T>(
  url: string,
  accessToken: string
): Promise<T[]> {
  const allItems: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Basecamp API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    if (Array.isArray(data)) {
      allItems.push(...data);
    } else {
      allItems.push(data);
    }

    // Parse Link header for pagination
    const linkHeader = res.headers.get("Link");
    nextUrl = null;
    if (linkHeader) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        nextUrl = match[1];
      }
    }
  }

  return allItems;
}

/** Fetch a single resource (non-array) */
export async function basecampFetchOne<T>(
  url: string,
  accessToken: string
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return basecampFetchOne(url, accessToken);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Basecamp API error (${res.status}): ${text}`);
  }

  return res.json();
}

/** Fetch a single Basecamp project by id. Returns null on 404 (project
 * does not exist or is not visible to this token); throws on every
 * other non-OK status. Needed by the link-verification phase of the
 * Basecamp ingest rebuild so the sync path can confirm a project URL
 * the operator pasted actually resolves to an accessible project. */
export async function getProjectById(
  projectId: string | number,
  accessToken: string
): Promise<BasecampProject | null> {
  const url = `${API_BASE}/projects/${projectId}.json`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return getProjectById(projectId, accessToken);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Basecamp API error (${res.status}): ${text}`);
  }

  return (await res.json()) as BasecampProject;
}

/** Find the todoset id attached to a Basecamp project by walking its
 * `dock` array. Basecamp returns the todoset as a dock entry with
 * `name === "todoset"`; that entry's `id` is the todoset id the
 * `/buckets/{project_id}/todosets/{id}.json` endpoint expects.
 *
 * Returns null if the project has no todoset dock entry (e.g. the
 * tool was removed by the project owner). Used by the live-discovery
 * sync path so we no longer depend on `Project.todoset_id` being
 * present in the local projects manifest. */
export function findTodosetIdInDock(project: BasecampProject): number | null {
  if (!project || !Array.isArray(project.dock)) return null;
  const entry = project.dock.find((d) => d.name === "todoset");
  return entry ? entry.id : null;
}

/** Fetch the todoset for a project to get the todolists URL */
export async function fetchTodoSet(
  projectId: number | string,
  todosetId: number | undefined,
  accessToken: string
): Promise<{ todolists_url: string }> {
  const url = `${API_BASE}/buckets/${projectId}/todosets/${todosetId}.json`;
  return basecampFetchOne(url, accessToken);
}

/** Fetch all todo lists for a project */
export async function fetchTodoLists(
  todolistsUrl: string,
  accessToken: string
): Promise<BasecampTodoList[]> {
  return basecampFetch<BasecampTodoList>(todolistsUrl, accessToken);
}

/** Fetch all todos from a todo list (both active and completed) */
export async function fetchTodos(
  projectId: number | string,
  todoListId: number,
  accessToken: string
): Promise<BasecampTodo[]> {
  const baseUrl = `${API_BASE}/buckets/${projectId}/todolists/${todoListId}/todos.json`;

  const [activeTodos, completedTodos] = await Promise.all([
    basecampFetch<BasecampTodo>(baseUrl, accessToken),
    basecampFetch<BasecampTodo>(`${baseUrl}?completed=true`, accessToken),
  ]);

  return [...activeTodos, ...completedTodos];
}

/**
 * Fetch todos for a todolist, INCLUDING any todos nested in groups beneath it.
 *
 * Basecamp 3 todolists can host:
 *   1. Flat todos directly (reachable via /todolists/{id}/todos.json)
 *   2. Groups (sub-lists) — each group is itself a todolist-shaped resource
 *      with its own todos_url. Reachable via /todolists/{id}/groups.json.
 *
 * The legacy syncProject path walked only (1). Clients using Basecamp's
 * "group" feature to organize a master list by phase (e.g. ONBOARDING /
 * TECH SETUP / SEO SETUP) had ALL their todos behind (2), invisible.
 *
 * This helper handles both. list_title for grouped todos is concatenated
 * as "ParentListTitle › GroupTitle" (separator: " › " with surrounding
 * spaces); flat todos retain the bare parent title for byte-for-byte
 * backwards compatibility.
 *
 * One extra GET per list (groups_url) is incurred even when no groups
 * exist. Basecamp returns [] for ungrouped lists — flat-organized
 * clients (e.g. Fielding, Mike Morse) see no per-todo behavior change,
 * only the extra empty-groups GETs.
 *
 * No recursion into nested groups (groups within groups). Basecamp
 * supports it; no evidence of usage in this account.
 */
export async function fetchTodosWithGroups(
  projectId: number | string,
  list: BasecampTodoList,
  accessToken: string,
): Promise<FormattedTodo[]> {
  // 1. Flat todos on the parent list (existing behavior).
  const flatTodos = await fetchTodos(projectId, list.id, accessToken);
  const out: FormattedTodo[] = flatTodos.map((t) => formatTodo(t, list.title));

  // 2. Walk groups_url. Basecamp returns [] for ungrouped lists.
  let groups: BasecampTodoList[];
  try {
    groups = await basecampFetch<BasecampTodoList>(list.groups_url, accessToken);
  } catch (err) {
    // If the groups fetch fails for a single list, log + continue with
    // flat-only results so one bad list doesn't kill the whole sync.
    console.warn(
      `[basecamp] groups_url fetch failed for list ${list.id} (${list.title}):`,
      err instanceof Error ? err.message : err,
    );
    return out;
  }

  for (const group of groups) {
    const groupTodos = await fetchTodos(projectId, group.id, accessToken);
    const concatTitle = `${list.title} › ${group.title}`;
    for (const t of groupTodos) {
      out.push(formatTodo(t, concatTitle));
    }
  }
  return out;
}

/** Format a raw Basecamp todo into our app's format */
function formatTodo(todo: BasecampTodo, listTitle: string): FormattedTodo {
  return {
    id: todo.id,
    title: todo.title,
    list_title: listTitle,
    completed: todo.completed,
    due_on: todo.due_on || null,
    created_at: todo.created_at,
    updated_at: todo.updated_at,
    completed_on: todo.completion?.created_at || null,
    comments_count: todo.comments_count || 0,
    assignees: (todo.assignees || []).map((a) => a.name).join(", "),
    app_url: todo.app_url,
    description: todo.description || "",
    visible_to_clients: todo.visible_to_clients ?? false,
  };
}

/** Sync all todos for a single project. Returns formatted todo array.
 *
 * Post-GHL-pivot: projectId is widened to `number | string` since the
 * Project.id type changed (string for new GHL-created entries; stringified
 * Basecamp id for migrated historicals). todosetId is `number | undefined`
 * since the field is no longer in the migrated data. This function and its
 * callers are scheduled for removal alongside the Basecamp poller.
 */
export async function syncProject(
  projectId: number | string,
  todosetId: number | undefined,
  accessToken: string
): Promise<FormattedTodo[]> {
  // 1. Get the todoset to find todolists URL
  const todoset = await fetchTodoSet(projectId, todosetId, accessToken);

  // 2. Get all todo lists
  const todoLists = await fetchTodoLists(todoset.todolists_url, accessToken);

  // 3. Fetch todos from each list
  const allTodos: FormattedTodo[] = [];

  // Process lists in batches of 3 to respect rate limits
  const batchSize = 3;
  for (let i = 0; i < todoLists.length; i += batchSize) {
    const batch = todoLists.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (list) => {
        return fetchTodosWithGroups(projectId, list, accessToken);
      })
    );
    for (const results of batchResults) {
      allTodos.push(...results);
    }
  }

  return allTodos;
}

/** Sync a single client's todos end-to-end.
 *
 * Glue helper for the admin refresh route: resolves a fresh access
 * token, fetches the project to read its dock, locates the todoset
 * id, then defers to `syncProject` to walk the todolists.
 *
 * Throws on every failure mode so the caller can map errors to a
 * 502 response:
 *   - "not found"           — getProjectById returned null
 *   - "no todoset in dock"  — findTodosetIdInDock returned null
 *
 * Returns the freshly-fetched FormattedTodo array; the caller is
 * responsible for persisting it via commitClientData (or not).
 */
export async function syncOneClient(
  projectId: string | number
): Promise<FormattedTodo[]> {
  const { accessToken } = await getValidAccessToken();
  const project = await getProjectById(projectId, accessToken);
  if (!project) {
    throw new Error("not found");
  }
  const todosetId = findTodosetIdInDock(project);
  if (todosetId === null) {
    throw new Error("no todoset in dock");
  }
  return syncProject(projectId, todosetId, accessToken);
}

/** Get a valid access token, refreshing if needed */
export async function getValidAccessToken(): Promise<{
  accessToken: string;
  refreshed: boolean;
  newTokens?: BasecampTokens;
}> {
  const accessToken = process.env.BASECAMP_ACCESS_TOKEN;
  const refreshToken = process.env.BASECAMP_REFRESH_TOKEN;

  if (!accessToken || !refreshToken) {
    throw new Error(
      "Basecamp tokens not configured. Please connect Basecamp via /api/auth/login"
    );
  }

  // Try the current token with a simple API call
  const testRes = await fetch(
    `${API_BASE}/projects.json`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": USER_AGENT,
      },
    }
  );

  if (testRes.ok) {
    return { accessToken, refreshed: false };
  }

  // Token expired, try to refresh
  if (testRes.status === 401) {
    const newTokens = await refreshAccessToken(refreshToken);
    return {
      accessToken: newTokens.access_token,
      refreshed: true,
      newTokens,
    };
  }

  throw new Error(`Basecamp API returned unexpected status: ${testRes.status}`);
}
