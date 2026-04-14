/**
 * Share-link tokens for the client-safe dashboard.
 *
 * A token is the first 16 hex chars of HMAC-SHA256(SHARE_SECRET, projectId).
 * - Deterministic per project, so the same share URL stays stable over time.
 * - One-way: the URL alone reveals no project ID; verification iterates
 *   projects.json and re-computes each project's token to find the match.
 * - Rotating SHARE_SECRET invalidates every share URL at once.
 *
 * Required env var: SHARE_SECRET (any long, random string).
 */
import { createHmac, timingSafeEqual } from "crypto";
import projects from "../data/projects.json";

const TOKEN_LENGTH = 16;

function getSecret(): string {
  const secret = process.env.SHARE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SHARE_SECRET env var is required (min 16 chars) to generate/verify share tokens"
    );
  }
  return secret;
}

/** Generate a share token for a given project id. Same id → same token. */
export function generateShareToken(projectId: string | number): string {
  const secret = getSecret();
  const hmac = createHmac("sha256", secret);
  hmac.update(String(projectId));
  return hmac.digest("hex").slice(0, TOKEN_LENGTH);
}

/**
 * Verify a token and return its project id, or null if the token matches no
 * project. Uses constant-time comparison against every project.
 */
export function verifyShareToken(token: string): string | null {
  if (!token || !/^[a-f0-9]+$/i.test(token) || token.length !== TOKEN_LENGTH) {
    return null;
  }
  const target = Buffer.from(token.toLowerCase(), "utf8");
  for (const p of projects) {
    const candidate = Buffer.from(generateShareToken(p.id), "utf8");
    if (candidate.length === target.length && timingSafeEqual(candidate, target)) {
      return String(p.id);
    }
  }
  return null;
}
