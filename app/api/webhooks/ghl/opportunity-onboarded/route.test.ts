// =============================================================
// Unit tests for the GHL opportunity-onboarded webhook receiver
// =============================================================
//
// Exercises the POST handler in TEST_MODE so the manifest commit
// and onboarding session POST are skipped (the route short-circuits
// after payload validation + assigned_to normalization).
//
// Run via: npm run test:receiver
//
// Test layout:
//   1. assigned_to as a valid 20-char id  → echoes the id
//   2. assigned_to as empty string         → null
//   3. assigned_to as JSON null            → null
//   4. assigned_to as literal "null"       → null (back-compat)
//   5. payload missing opportunity_id      → ok=false, invalid_payload
//   6. assigned_to as contact name         → null (defensive widening)

// Env MUST be set before importing the route module — the route reads
// process.env.GHL_WEBHOOK_BEARER and process.env.GHL_RECEIVER_TEST_MODE
// at request time, but the import side has zero side effects, so order
// is mostly defensive.
process.env.GHL_RECEIVER_TEST_MODE = "1";
process.env.GHL_WEBHOOK_BEARER = "test-bearer-token-do-not-use-in-prod";

import { test } from "node:test";
import assert from "node:assert/strict";

// Lazy import after env setup. tsx resolves the .ts file and the
// "@/app/lib/projects" path alias via the project tsconfig. Cached
// after first call so all 6 tests share one module instance.
let cachedPOST: ((req: Request) => Promise<Response>) | null = null;
async function getPOST(): Promise<(req: Request) => Promise<Response>> {
  if (!cachedPOST) {
    const mod = await import("./route.ts");
    cachedPOST = mod.POST as (req: Request) => Promise<Response>;
  }
  return cachedPOST;
}

// ── Helpers ─────────────────────────────────────────────────────

type Payload = Record<string, unknown>;

const BASE_PAYLOAD: Payload = {
  // 20-char alphanumeric synthetic id ("TST" + 17 chars)
  opportunity_id: "TST" + "a".repeat(17),
  opportunity_name: "Test Opp Synthetic",
  pipeline_name: "PI - SEO",
  stage_name: "Onboarding",
  status: "open",
  // 20-char alphanumeric contact id ("TSTcontact" + 10 chars)
  contact_id: "TSTcontact" + "x".repeat(10),
  contact_first_name: "Test",
  contact_last_name: "Synthetic",
  contact_email: "test-synthetic@clixsy.com",
  contact_phone: "+10000000000",
  website_url: "https://example.com",
  assigned_to: "VALID20CHAR12345ABCD",
};

interface BuildOpts {
  bearer?: string;
}

function buildRequest(payload: unknown, opts: BuildOpts = {}): Request {
  const headers = new Headers();
  headers.set(
    "Authorization",
    `Bearer ${opts.bearer ?? process.env.GHL_WEBHOOK_BEARER}`,
  );
  headers.set("Content-Type", "application/json");
  return new Request(
    "http://localhost/api/webhooks/ghl/opportunity-onboarded",
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );
}

async function postAndParse(payload: unknown): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const req = buildRequest(payload);
  // The route is typed for NextRequest but at runtime only reads
  // standard Fetch APIs (req.headers.get, req.json), so a plain
  // Request works. Cast through unknown to satisfy TS.
  const POST = await getPOST();
  const res = await POST(req as unknown as Request);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── Tests ───────────────────────────────────────────────────────

test("valid payload with assigned_to as 20-char ID → ok=true, normalized echoes ID", async () => {
  const { status, body } = await postAndParse({
    ...BASE_PAYLOAD,
    assigned_to: "VALID20CHAR12345ABCD",
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.assigned_to_normalized, "VALID20CHAR12345ABCD");
  assert.equal(body.test_mode, true);
});

test("valid payload with assigned_to as empty string → ok=true, normalized=null", async () => {
  const { status, body } = await postAndParse({
    ...BASE_PAYLOAD,
    assigned_to: "",
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.assigned_to_normalized, null);
});

test("valid payload with assigned_to as JSON null → ok=true, normalized=null", async () => {
  const { status, body } = await postAndParse({
    ...BASE_PAYLOAD,
    assigned_to: null,
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.assigned_to_normalized, null);
});

test("valid payload with assigned_to as literal string 'null' (back-compat) → ok=true, normalized=null", async () => {
  const { status, body } = await postAndParse({
    ...BASE_PAYLOAD,
    assigned_to: "null",
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.assigned_to_normalized, null);
});

test("invalid payload (opportunity_id missing) → always-200, ok=false, reason=invalid_payload", async () => {
  // Omit opportunity_id by spreading then deleting.
  const payload: Payload = { ...BASE_PAYLOAD };
  delete payload.opportunity_id;
  const { status, body } = await postAndParse(payload);
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invalid_payload");
});

test("valid payload with assigned_to as contact name (scenario e) → ok=true, normalized=null", async () => {
  const { status, body } = await postAndParse({
    ...BASE_PAYLOAD,
    assigned_to: "Johan Cilliers",
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.assigned_to_normalized, null);
});
