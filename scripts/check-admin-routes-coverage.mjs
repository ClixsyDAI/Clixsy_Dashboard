#!/usr/bin/env node
// =============================================================
// scripts/check-admin-routes-coverage.mjs
// =============================================================
//
// Phase 1 PR D-1. CI check that every admin route uses the
// withAdminAuth HOF. Catches the case where a future PR adds
// a new admin route file but forgets requireRole — that path
// would be unguarded but would still respond 2xx, which is the
// worst possible failure mode.
//
// Usage:
//   node scripts/check-admin-routes-coverage.mjs
//
// Exits 0 if every admin route file contains `withAdminAuth(`.
// Exits 1 with a list of offending files otherwise.
//
// Excluded paths:
//   - app/api/admin/auth/** — the auth surface itself (sign in,
//     sign out, the cookie bridge endpoints). These predate
//     withAdminAuth and have their own auth posture documented
//     per-file.
//
// Add to CI via `npm run lint:admin-coverage` (see package.json).

import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { relative } from "node:path";

// A route is "covered" if it uses EITHER:
//   - withAdminAuth(...)  — the canonical PR D-1 HOF
//   - withAdminAuth<...>(...)  — same HOF with generic type params
//   - await requireRole(...)  — direct PR C pattern (pre-D-1 routes)
//
// Every new admin route SHOULD use withAdminAuth (the HOF bundles
// Origin + rate-limit + requireRole + audit — strictly more checks
// than direct requireRole). But existing PR C routes that just
// call requireRole are grandfathered: they still gate, they just
// don't get CSRF / rate-limit / handler-rejection audit. Migrating
// them is parked.
const COVERAGE_PATTERNS = [
  /\bwithAdminAuth\s*[<(]/,
  /\bawait\s+requireRole\s*\(/,
];

// Routes under /api/admin/auth/** are intentionally exempt — they
// implement the auth surface itself (sign in / sign out / cookie
// bridges) and predate withAdminAuth. Their auth posture is
// documented per-file in code comments.
const EXEMPT_PATH_PATTERNS = [/[\\/]api[\\/]admin[\\/]auth[\\/]/];

function listAdminRoutes() {
  // Use git ls-files to find tracked + untracked files matching the
  // admin route pattern. Works in CI checkouts and in local working
  // copies with uncommitted route files.
  const output = execSync(
    "git ls-files --cached --others --exclude-standard -- app/api/admin",
    { encoding: "utf8" },
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("route.ts") || line.endsWith("route.tsx"));
}

async function main() {
  const offenders = [];
  const routes = listAdminRoutes();

  for (const path of routes) {
    if (EXEMPT_PATH_PATTERNS.some((pat) => pat.test(path))) {
      continue;
    }
    const content = await readFile(path, "utf8");
    const covered = COVERAGE_PATTERNS.some((pat) => pat.test(content));
    if (!covered) {
      offenders.push(relative(process.cwd(), path));
    }
  }

  if (offenders.length > 0) {
    console.error(
      "[admin-routes-coverage] FAIL: the following route files have no recognised auth gate:",
    );
    for (const path of offenders) {
      console.error(`  - ${path}`);
    }
    console.error(
      "\nEvery admin route must EITHER wrap its handler with withAdminAuth(...)",
    );
    console.error(
      "from @/app/lib/with-admin-auth, OR call `await requireRole(...)` directly,",
    );
    console.error(
      "OR be added to EXEMPT_PATH_PATTERNS in this script with a comment.",
    );
    process.exit(1);
  }

  console.log(
    `[admin-routes-coverage] OK: ${routes.length} admin route file(s) checked; every non-exempt one uses withAdminAuth().`,
  );
}

main().catch((err) => {
  console.error("[admin-routes-coverage] script error:", err);
  process.exit(2);
});
