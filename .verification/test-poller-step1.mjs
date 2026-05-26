// =============================================================
// test-poller-step1.mjs
// =============================================================
//
// Phase 3 Step 1 verification. Read-only against the production
// Basecamp account. Confirms:
//   1. listJProjects() returns the J-numbered projects only.
//   2. The J999 INTEGRATION TEST project (created in Phase 2b) is
//      present.
//   3. At least one known existing client (J353 Andrew Pickett Law)
//      is present — sanity-checks the filter against real data.
//   4. getProjectMessageBoardId / getProjectTodosetId return the
//      same ids we recorded for J999 during Phase 2b.
//
// Reads the fresh access token from ~/bc-token.json (saved during
// Phase 2b's token refresh — valid through ~2026-06-09). Loads it
// into process.env.BASECAMP_ACCESS_TOKEN/REFRESH_TOKEN so the
// poller's underlying getValidAccessToken() path can be exercised
// authentically if needed. (Step 1's primitives take the token
// as an argument, so the env mapping is only needed if future
// steps add wrappers that read process.env directly.)
//
// Run from the repo root:
//   node --experimental-strip-types .verification/test-poller-step1.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

// Stub env vars before importing the poller so that any module-load
// time process.env reads (BASECAMP_ACCOUNT_ID has a hardcoded
// fallback to 4226914 in basecamp.ts) get sensible values.
const tokenFile = path.join(homedir(), "bc-token.json");
const { access_token } = JSON.parse(readFileSync(tokenFile, "utf8"));
if (!access_token) {
  console.error("FAIL: ~/bc-token.json missing access_token");
  process.exit(1);
}
process.env.BASECAMP_ACCESS_TOKEN = access_token;
process.env.BASECAMP_REFRESH_TOKEN = "not-used-by-step-1";
process.env.BASECAMP_ACCOUNT_ID = "4226914";

const {
  listJProjects,
  getProjectMessageBoardId,
  getProjectTodosetId,
} = await import("../app/lib/basecamp-poller.ts");

const { getExistingProjectIds, filterNewProjects } = await import(
  "../app/lib/poller-dedupe.ts"
);

// =============================================================
// (1) listJProjects
// =============================================================

console.log("[1] listJProjects against production Basecamp…");
const projects = await listJProjects(access_token);
console.log(`    returned ${projects.length} J-numbered projects`);

// Print the names, sorted by J-number for readable output.
const sorted = [...projects].sort((a, b) => {
  const ai = parseInt(a.name.match(/^J(\d+)/)?.[1] ?? "0", 10);
  const bi = parseInt(b.name.match(/^J(\d+)/)?.[1] ?? "0", 10);
  return ai - bi;
});
for (const p of sorted) {
  console.log(`      ${p.id.toString().padStart(8)} ${p.name}`);
}

// =============================================================
// (2) Assertions
// =============================================================

let pass = true;
const check = (label, expr) => {
  console.log(`    ${expr ? "✓" : "✗"} ${label}`);
  if (!expr) pass = false;
};

const j999 = projects.find((p) =>
  p.name.startsWith("J999 INTEGRATION TEST"),
);
const j353 = projects.find((p) => p.name.startsWith("J353 Andrew Pickett"));

console.log("");
console.log("[2] Sanity checks");
check("J999 INTEGRATION TEST project present", !!j999);
check("J353 Andrew Pickett Law present (known existing client)", !!j353);
check("every returned name starts with /^J\\d+\\s+/", projects.every((p) => /^J\d+\s+/.test(p.name)));

if (!j999) {
  console.error("\nFAIL: J999 not found — Phase 2b may have been cleaned up already or the project was renamed.");
  process.exit(1);
}

// =============================================================
// (3) getProjectMessageBoardId + getProjectTodosetId
// =============================================================

console.log("");
console.log("[3] Dock parsing against J999 (project_id=" + j999.id + ")");
const boardId = await getProjectMessageBoardId(j999.id, access_token);
const todosetId = await getProjectTodosetId(j999.id, access_token);
console.log(`    message_board id = ${boardId}`);
console.log(`    todoset id       = ${todosetId}`);

// Phase 2b recorded these ids in C:\Users\johan\AppData\Local\Temp\j999-test-ids.json.
// Re-read and compare so we don't have to hardcode them here.
const scratchPath = path.join(
  process.env.TEMP || homedir(),
  "j999-test-ids.json",
);
let phase2bIds = null;
try {
  phase2bIds = JSON.parse(readFileSync(scratchPath, "utf8"));
} catch {
  console.log(`    (skip cross-check — scratch file ${scratchPath} not found)`);
}
if (phase2bIds) {
  check(
    "message_board id matches Phase 2b scratch",
    boardId === phase2bIds.message_board_id,
  );
  check(
    "todoset id matches Phase 2b scratch",
    todosetId === phase2bIds.todoset_id,
  );
}

// =============================================================
// (4) Step 2: dedupe — getExistingProjectIds + filterNewProjects
// =============================================================

console.log("");
console.log("[4] Step 2 dedupe");
const existingIds = getExistingProjectIds();
const existingSet = new Set(existingIds);
const newProjects = filterNewProjects(projects, existingSet);

const inManifestAndBasecamp = projects.filter((p) => existingSet.has(p.id));

console.log(`    Basecamp J-projects (total):       ${projects.length}`);
console.log(`    projects.json entries (total):     ${existingIds.length}`);
console.log(`    in both Basecamp AND manifest:     ${inManifestAndBasecamp.length}`);
console.log(`    new (in Basecamp, not in manifest): ${newProjects.length}`);
console.log("");
console.log("    New projects that the cron would process:");
for (const p of newProjects) {
  console.log(`      ${p.id.toString().padStart(8)} ${p.name}`);
}

check(
  "total Basecamp == (in both) + (new)",
  projects.length === inManifestAndBasecamp.length + newProjects.length,
);
check(
  "no duplicate ids in newProjects",
  new Set(newProjects.map((p) => p.id)).size === newProjects.length,
);
check(
  "every newProjects entry's id is NOT in the manifest",
  newProjects.every((p) => !existingSet.has(p.id)),
);
check(
  "J999 INTEGRATION TEST appears in newProjects",
  newProjects.some((p) => p.id === j999.id),
);
check(
  "J353 Andrew Pickett (known existing client) does NOT appear in newProjects",
  !newProjects.some((p) => p.id === j353?.id),
);

// =============================================================
// Result
// =============================================================

console.log("");
if (pass) {
  console.log("PASS");
  process.exit(0);
} else {
  console.log("FAIL");
  process.exit(1);
}
