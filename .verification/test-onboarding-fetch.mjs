// =============================================================
// Verification: onboarding fetch path for the chat route's
// new tools (feat/chat-onboarding-tools-2026-05)
// =============================================================
//
// Confirms that the underlying data path for the four new chat
// tools (get_onboarding_status / list_onboarding_steps /
// get_onboarding_step / get_site_intelligence) resolves cleanly
// for projectId 40435636 (Andrew Pickett) — the same call
// `loadProjectContext` makes via `getOnboardingByWorkbookId`.
//
// What this proves
//   - workbook_id → clients lookup succeeds
//   - clients.id → onboarding_sessions lookup succeeds
//   - session.id → onboarding_answers returns ≥ 1 step row
//   - the four si_*_snapshot columns are queryable
//
// Why this script does the Supabase REST call directly rather
// than importing getOnboardingByWorkbookId: the helper sits
// under Next.js's bundler (path aliases, ts compile, etc.) and
// importing it from a bare Node script requires the full Next
// build pipeline. The data-path guarantee is what matters; the
// TypeScript helper just wraps the same query.
//
// Run:   node .verification/test-onboarding-fetch.mjs
// Exits: 0 on pass, 1 on fail. Console output lists each assertion.

import fs from "node:fs";

const ANDREW_WORKBOOK_ID = 40435636;
const ANDREW_SESSION_ID = "72c49e74-77c9-4c2b-95cb-864d668ea20f";

// ── Parse .env.local for Supabase creds ───────────────────────
// Mirrors ops-notes.md §9: strip trailing \n literal escape
// chars that `vercel env pull` bakes into multi-line values.
function readEnvVar(name) {
  const env = fs.readFileSync(".env.local", "utf8");
  const m = env.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!m) throw new Error(`Missing ${name} in .env.local`);
  let v = m[1].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  while (v.endsWith(String.fromCharCode(92, 110))) v = v.slice(0, -2);
  return v;
}

const SUPABASE_URL = readEnvVar("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = readEnvVar("SUPABASE_SERVICE_ROLE_KEY");

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

let passed = 0;
let failed = 0;

function assert(cond, label, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Run ───────────────────────────────────────────────────────
async function main() {
  console.log(`Verifying onboarding data path for workbook_id=${ANDREW_WORKBOOK_ID}`);

  // 1. clients lookup by workbook_id
  const clientsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?workbook_id=eq.${ANDREW_WORKBOOK_ID}&select=id,client_name,primary_contact_name,primary_contact_email`,
    { headers },
  );
  const clients = await clientsRes.json();
  assert(Array.isArray(clients) && clients.length === 1, "clients lookup returns exactly one row");
  const client = clients[0];
  assert(client?.client_name === "Andrew Pickett", `client_name === "Andrew Pickett"`, `got ${client?.client_name}`);

  // 2. onboarding_sessions by client.id (latest)
  const sessionsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/onboarding_sessions?client_id=eq.${client.id}&order=created_at.desc&limit=1&select=id,status,vertical,account_manager,si_branding_snapshot,si_insights_snapshot,si_overrides_snapshot,si_prefill_snapshot`,
    { headers },
  );
  const sessions = await sessionsRes.json();
  assert(Array.isArray(sessions) && sessions.length === 1, "onboarding_sessions returns exactly one row");
  const session = sessions[0];
  assert(session?.id === ANDREW_SESSION_ID, `session.id matches expected uuid`, `got ${session?.id}`);
  assert(
    ["draft", "in_progress", "submitted"].includes(session?.status),
    `session.status is in valid enum`,
    `got ${session?.status}`,
  );

  // 3. onboarding_answers by session.id
  const answersRes = await fetch(
    `${SUPABASE_URL}/rest/v1/onboarding_answers?session_id=eq.${session.id}&select=step_key,answers,completed`,
    { headers },
  );
  const answers = await answersRes.json();
  assert(Array.isArray(answers), "answers query returned array");
  assert(answers.length >= 1, `answers has ≥ 1 step row (got ${answers.length})`);
  const primaryContact = answers.find((a) => a.step_key === "primary_contact");
  assert(!!primaryContact, "primary_contact step row exists for Andrew");
  if (primaryContact) {
    const fields = Object.keys(primaryContact.answers || {});
    assert(
      fields.includes("main_contact_name"),
      "primary_contact.answers contains main_contact_name field",
      `fields: ${fields.join(",")}`,
    );
  }

  // 4. si_*_snapshot columns are present (may or may not be populated)
  const siCols = [
    "si_branding_snapshot",
    "si_insights_snapshot",
    "si_overrides_snapshot",
    "si_prefill_snapshot",
  ];
  for (const c of siCols) {
    // Either populated (object) or null — both are valid; this just
    // confirms the column exists and the select succeeded.
    const present = Object.prototype.hasOwnProperty.call(session, c);
    assert(present, `session has column ${c}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test script threw:", err);
  process.exit(1);
});
