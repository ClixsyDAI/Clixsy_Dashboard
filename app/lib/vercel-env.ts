/**
 * Helper to read/write Vercel environment variables via the Vercel REST API.
 *
 * Required env vars:
 *   VERCEL_API_TOKEN       - Vercel API token (personal access token)
 *   VERCEL_PROJECT_ID  - The Vercel project ID
 *   VERCEL_TEAM_ID     - The Vercel team/account ID (optional for personal accounts)
 *
 * Kept after the Basecamp cutover because the helper itself is integration-
 * agnostic; the now-removed Basecamp OAuth token rotation was the only
 * pre-pivot caller. Reuse for future env-var management as it comes up.
 */

const VERCEL_API = "https://api.vercel.com";

function getHeaders(): HeadersInit {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    throw new Error("VERCEL_API_TOKEN env var is required to manage env vars");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getProjectPath(): string {
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!projectId) {
    throw new Error("VERCEL_PROJECT_ID env var is required");
  }
  const teamId = process.env.VERCEL_TEAM_ID;
  const teamQuery = teamId ? `?teamId=${teamId}` : "";
  return `/v10/projects/${projectId}/env${teamQuery}`;
}

interface VercelEnvVar {
  id: string;
  key: string;
  value: string;
  target: string[];
  type: string;
}

/** List all environment variables for the project */
export async function listEnvVars(): Promise<VercelEnvVar[]> {
  const res = await fetch(`${VERCEL_API}${getProjectPath()}`, {
    headers: getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list env vars (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.envs || [];
}

/** Get a specific env var by key */
export async function getEnvVar(
  key: string
): Promise<VercelEnvVar | null> {
  const envVars = await listEnvVars();
  return envVars.find((v: VercelEnvVar) => v.key === key) || null;
}

/** Create or update an environment variable */
export async function upsertEnvVar(
  key: string,
  value: string,
  targets: string[] = ["production", "preview", "development"]
): Promise<void> {
  // Writing an empty/undefined value bricks the env var on the next
  // deploy. Guard against the regression where callers pass `undefined`
  // from a stale token-refresh return shape.
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `upsertEnvVar refusing to write empty/undefined value for ${key}`
    );
  }

  const existing = await getEnvVar(key);

  if (existing) {
    // Update existing
    const projectId = process.env.VERCEL_PROJECT_ID!;
    const teamId = process.env.VERCEL_TEAM_ID;
    const teamQuery = teamId ? `?teamId=${teamId}` : "";
    const url = `${VERCEL_API}/v9/projects/${projectId}/env/${existing.id}${teamQuery}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ value, target: targets, type: "encrypted" }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to update env var ${key} (${res.status}): ${text}`);
    }
  } else {
    // Create new
    const res = await fetch(`${VERCEL_API}${getProjectPath()}`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        key,
        value,
        target: targets,
        type: "encrypted",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create env var ${key} (${res.status}): ${text}`);
    }
  }
}

