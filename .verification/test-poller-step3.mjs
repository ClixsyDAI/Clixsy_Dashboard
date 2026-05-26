// =============================================================
// test-poller-step3.mjs
// =============================================================
//
// Phase 3 Step 3 verification — exercises processNewProject end-to-end
// against the J999 INTEGRATION TEST project ONLY. Real Supabase row
// is created. A new app/data/projects.json commit is made to GitHub
// master (triggering a Vercel auto-redeploy). When the default probe
// runs, a real message is posted to J999's Basecamp message board.
//
// CRITICAL: this script does NOT touch the 5 real client projects
// (J415, J416, J418, J420, J423). Only J999 (id 47431551).
//
// Two probes — select via PROBE env var. Defaults to 1.
//   PROBE=1 (default): skipBasecampMessage: true — no Basecamp post.
//   PROBE=2:           default opts — Basecamp post fires.
// Between probes, operator manually cleans up:
//   - delete the clients row with workbook_id=47431551 from Supabase
//   - revert the projects.json change on master
//
// Run from the repo root:
//   PROBE=1 npx tsx .verification/test-poller-step3.mjs
//   PROBE=2 npx tsx .verification/test-poller-step3.mjs

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const J999_ID = 47431551;
const J999_NAME = "J999 INTEGRATION TEST 2026-05-26 DO NOT TOUCH";
const J999_BOARD_ID = 9929824264;
const PROBE = process.env.PROBE === "2" ? 2 : 1;

console.log(`Phase 3 Step 3 — Probe ${PROBE} (${PROBE === 1 ? "skipBasecampMessage: true" : "default opts, message posts"})`);
console.log("");

// ── Credentials ──────────────────────────────────────────────────
const { access_token: BC_TOKEN } = JSON.parse(
  readFileSync(path.join(homedir(), "bc-token.json"), "utf8"),
);
process.env.BASECAMP_ACCOUNT_ID = "4226914";
process.env.BASECAMP_ACCESS_TOKEN = BC_TOKEN;
process.env.BASECAMP_REFRESH_TOKEN = "n/a";

// SHARED_INTEGRATION_BEARER_TOKEN — read from workbook .env.local.
const envLocal = readFileSync(
  path.join(process.cwd(), ".env.local"),
  "utf8",
);
const bearerLine = envLocal
  .split("\n")
  .find((l) => l.startsWith("SHARED_INTEGRATION_BEARER_TOKEN="));
if (!bearerLine) {
  console.error("FAIL: SHARED_INTEGRATION_BEARER_TOKEN not in .env.local");
  process.exit(1);
}
process.env.SHARED_INTEGRATION_BEARER_TOKEN = bearerLine
  .replace(/^SHARED_INTEGRATION_BEARER_TOKEN=/, "")
  .replace(/^['"]|['"]$/g, "")
  .trim();

// GITHUB_TOKEN — pull from the gh CLI's stored credentials.
const ghToken = execSync("gh auth token", { encoding: "utf8" }).trim();
process.env.GITHUB_TOKEN = ghToken;
process.env.GITHUB_REPO = "JLcilliers/client-workbook-dashboard";

const SUPABASE_URL = "https://lawwsutjxopiekjzupef.supabase.co";
const SRK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhd3dzdXRqeG9waWVranp1cGVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjMxMjI0OSwiZXhwIjoyMDgxODg4MjQ5fQ.MtzkFn3_3_CkQnt6JDqn4DP1IhxwXLn01bEYD9wyLtA";
const supaHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}` };

// ── Helpers ──────────────────────────────────────────────────────

async function countJ999Messages() {
  const url = `https://3.basecampapi.com/4226914/message_boards/${J999_BOARD_ID}/messages.json`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BC_TOKEN}`,
      "User-Agent": "Client Workbook Dashboard (johan@clixsy.com)",
    },
  });
  if (!res.ok) {
    throw new Error(`messages count fetch failed: ${res.status} ${await res.text()}`);
  }
  const msgs = await res.json();
  return Array.isArray(msgs) ? msgs.length : 0;
}

async function getClientByWorkbookId(workbookId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?workbook_id=eq.${workbookId}&select=id,client_name,workbook_id`,
    { headers: supaHeaders },
  );
  if (!res.ok) {
    throw new Error(`clients lookup failed: ${res.status}`);
  }
  const rows = await res.json();
  return rows[0] ?? null;
}

async function fetchProjectsJsonFromMaster() {
  // GitHub raw URL with cache-buster query string.
  const res = await fetch(
    `https://api.github.com/repos/JLcilliers/client-workbook-dashboard/contents/app/data/projects.json?ref=master`,
    {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github.v3.raw",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`projects.json fetch failed: ${res.status}`);
  }
  return res.json();
}

// ── Pre-flight ───────────────────────────────────────────────────
console.log("[pre-flight] state before the probe runs:");

const beforeMessages = await countJ999Messages();
console.log(`  J999 message-board count:   ${beforeMessages}`);

const beforeClient = await getClientByWorkbookId(J999_ID);
console.log(`  clients row for workbook_id=${J999_ID}: ${beforeClient ? `EXISTS (id=${beforeClient.id})` : "(none)"}`);

const beforeManifest = await fetchProjectsJsonFromMaster();
const beforeHasJ999 = beforeManifest.some((p) => p.id === J999_ID);
console.log(`  projects.json on master has J999:  ${beforeHasJ999}`);

if (beforeClient) {
  console.error("\nFAIL pre-flight: a clients row for J999 already exists. Operator must clean it up before running this probe.");
  process.exit(1);
}
if (beforeHasJ999) {
  console.error("\nFAIL pre-flight: J999 is already in projects.json on master. Operator must revert it before running this probe.");
  process.exit(1);
}

// ── The probe ────────────────────────────────────────────────────
console.log("");
console.log(`[probe] running processNewProject(J999, accessToken, opts)`);
console.log(`  opts: ${PROBE === 1 ? "{ skipBasecampMessage: true }" : "(default)"}`);

const { processNewProject } = await import(
  "../app/lib/basecamp-poller.ts"
);

const j999Project = {
  id: J999_ID,
  name: J999_NAME,
  description: null,
  created_at: "2026-05-26T16:52:02.848Z",
  dock: [],
};

const opts = PROBE === 1 ? { skipBasecampMessage: true } : undefined;
const result = await processNewProject(j999Project, BC_TOKEN, opts);

console.log("");
console.log("[result]");
console.log(JSON.stringify(result, null, 2));

// ── Post-flight ──────────────────────────────────────────────────
console.log("");
console.log("[post-flight] state after the probe:");

const afterMessages = await countJ999Messages();
console.log(`  J999 message-board count:   ${afterMessages}  (was ${beforeMessages})`);

const afterClient = await getClientByWorkbookId(J999_ID);
console.log(`  clients row for workbook_id=${J999_ID}: ${afterClient ? `EXISTS (id=${afterClient.id}, name="${afterClient.client_name}")` : "(none)"}`);

const afterManifest = await fetchProjectsJsonFromMaster();
const afterEntry = afterManifest.find((p) => p.id === J999_ID);
console.log(`  projects.json on master has J999:  ${!!afterEntry}`);
if (afterEntry) {
  console.log(`    entry: ${JSON.stringify(afterEntry)}`);
}

// ── Assertions ───────────────────────────────────────────────────
console.log("");
console.log("[assertions]");
let pass = true;
const check = (label, expr) => {
  console.log(`  ${expr ? "✓" : "✗"} ${label}`);
  if (!expr) pass = false;
};

check("result.status === 'success'", result.status === "success");

if (PROBE === 1) {
  check("result.message_id === null (skip path)", result.message_id === null);
  check(
    `Basecamp message count UNCHANGED (still ${beforeMessages})`,
    afterMessages === beforeMessages,
  );
} else {
  check(
    "result.message_id is a number (post path)",
    typeof result.message_id === "number" && result.message_id > 0,
  );
  check(
    `Basecamp message count incremented by 1 (was ${beforeMessages}, now ${afterMessages})`,
    afterMessages === beforeMessages + 1,
  );
}

check(
  "Supabase clients row now exists with workbook_id matching",
  !!afterClient && afterClient.workbook_id === J999_ID,
);
check(
  "projects.json on master now contains J999 entry",
  !!afterEntry,
);
if (afterEntry) {
  check(
    "manifest entry name matches Basecamp project name",
    afterEntry.name === J999_NAME,
  );
  check(
    "manifest entry description is empty string",
    afterEntry.description === "",
  );
  check(
    "manifest entry todoset_id matches Phase 2b scratch (9929824270)",
    afterEntry.todoset_id === 9929824270,
  );
}

console.log("");
if (pass) {
  console.log(`PASS — probe ${PROBE}`);
  if (PROBE === 1) {
    console.log("");
    console.log("NEXT — operator cleanup before Probe 2:");
    console.log(`  1. DELETE FROM clients WHERE workbook_id = ${J999_ID};`);
    console.log("     (or via Supabase REST: DELETE /rest/v1/clients?workbook_id=eq." + J999_ID + ")");
    console.log(`  2. Revert projects.json on master:`);
    console.log(`     git pull && git revert <commit-sha> && git push`);
    console.log(`     (the commit message will be \"sync: update projects manifest\")`);
    console.log("");
    console.log("Then run: PROBE=2 npx tsx .verification/test-poller-step3.mjs");
  } else {
    console.log("");
    console.log("NEXT — operator cleanup after BOTH probes:");
    console.log(`  1. DELETE FROM clients WHERE workbook_id = ${J999_ID};`);
    console.log(`  2. Revert projects.json on master (most recent \"sync: update projects manifest\" commit).`);
    console.log(`  3. Delete the new Basecamp message on J999's board via the Basecamp UI.`);
  }
  process.exit(0);
} else {
  console.log(`FAIL — probe ${PROBE}`);
  process.exit(1);
}
