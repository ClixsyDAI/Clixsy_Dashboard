/**
 * Helper to commit files to the GitHub repo via the GitHub REST API.
 * Used to persist synced Basecamp data as JSON files in the repo,
 * which triggers an automatic Vercel redeploy.
 *
 * Required env vars:
 *   GITHUB_TOKEN  - GitHub personal access token with repo scope
 *   GITHUB_REPO   - Full repo path, e.g. "JLcilliers/client-workbook-dashboard"
 */

const GITHUB_API = "https://api.github.com";

function getHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN env var is required to commit data files");
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function getRepo(): string {
  return process.env.GITHUB_REPO || "JLcilliers/client-workbook-dashboard";
}

interface GitHubFileResponse {
  sha: string;
  content: string;
}

/** Get the current SHA of a file (needed for updates) */
async function getFileSha(path: string): Promise<string | null> {
  const repo = getRepo();
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: getHeaders(),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${text}`);
  }

  const data: GitHubFileResponse = await res.json();
  return data.sha;
}

/** Get the live contents of a file on the default branch.
 *
 * Returns null if the file doesn't exist. The content is decoded
 * from GitHub's base64 wrapper into UTF-8.
 *
 * Used by the poller's appendAndCommitManifest to read the
 * up-to-date projects.json from GitHub between batched commits,
 * rather than the deployed bundle (which is fixed for the
 * lifetime of the Vercel function instance and would cause
 * sequential commits within one cron run to clobber each other).
 */
export async function getFileContents(
  path: string
): Promise<{ sha: string; content: string } | null> {
  const repo = getRepo();
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: getHeaders(),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${text}`);
  }

  const data: GitHubFileResponse = await res.json();
  return {
    sha: data.sha,
    content: Buffer.from(data.content, "base64").toString("utf8"),
  };
}

/** Create or update a file in the GitHub repo */
export async function commitFile(
  path: string,
  content: string,
  message: string
): Promise<{ sha: string; url: string }> {
  const repo = getRepo();
  const existingSha = await getFileSha(path);

  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString("base64"),
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to commit ${path} (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    sha: data.content?.sha || "",
    url: data.content?.html_url || "",
  };
}

/** Commit a client's todo data as a JSON file */
export async function commitClientData(
  projectId: number,
  todos: unknown[]
): Promise<{ sha: string; url: string }> {
  const path = `app/data/clients/${projectId}.json`;
  const content = JSON.stringify(todos, null, 2);
  const message = `sync: update client data for project ${projectId}`;
  return commitFile(path, content, message);
}

/** Commit the projects.json manifest.
 *
 * Formats as one compact object per line (`  {…},\n`) to match the
 * file's existing style. Using `JSON.stringify(projects, null, 2)`
 * would expand every entry onto five lines and produce a ~250-line
 * diff for a single-row addition, which is noisy in the commit log.
 */
export async function commitProjectsManifest(
  projects: unknown[]
): Promise<{ sha: string; url: string }> {
  const path = "app/data/projects.json";
  const lines = projects.map((p) => "  " + JSON.stringify(p));
  const content = "[\n" + lines.join(",\n") + "\n]\n";
  const message = "sync: update projects manifest";
  return commitFile(path, content, message);
}
