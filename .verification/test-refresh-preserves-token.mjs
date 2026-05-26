// =============================================================
// test-refresh-preserves-token.mjs
// =============================================================
//
// Confirms that refreshAccessToken() preserves the caller-supplied
// refresh_token in its return value, even when launchpad's refresh
// response omits a refresh_token field (which it always does per
// empirical inspection on 2026-05-26).
//
// Background: app/api/sync/route.ts calls storeBasecampTokens(
// newTokens.access_token, newTokens.refresh_token) after a refresh.
// If newTokens.refresh_token were undefined (the pre-fix shape),
// upsertEnvVar() would silently wipe BASECAMP_REFRESH_TOKEN on
// Vercel, stranding the production deploy after the next refresh.
//
// Run from the repo root:
//   node --experimental-strip-types .verification/test-refresh-preserves-token.mjs

const ORIGINAL_REFRESH_TOKEN = "ORIGINAL_REFRESH_TOKEN_SENTINEL_XYZ_123";
const STUB_ACCESS_TOKEN = "new-access-token-from-stub";
const STUB_EXPIRES_IN = 1209600;

// Stub launchpad's refresh response BEFORE importing the module so
// the function captures our stub, not real fetch. The shape pinned
// here is what launchpad actually returns: no refresh_token field.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    access_token: STUB_ACCESS_TOKEN,
    expires_in: STUB_EXPIRES_IN,
    token_type: "Bearer",
  }),
});

// Dynamic import so the stub is in place at module-eval time.
const { refreshAccessToken } = await import("../app/lib/basecamp.ts");

const result = await refreshAccessToken(ORIGINAL_REFRESH_TOKEN);

let pass = true;
const check = (label, expr) => {
  console.log(`  ${expr ? "✓" : "✗"} ${label}`);
  if (!expr) pass = false;
};

console.log("test-refresh-preserves-token");
check(
  "result.refresh_token equals caller-supplied token",
  result.refresh_token === ORIGINAL_REFRESH_TOKEN,
);
check(
  "result.access_token comes from API response",
  result.access_token === STUB_ACCESS_TOKEN,
);
check(
  "result.expires_in passed through from API",
  result.expires_in === STUB_EXPIRES_IN,
);

console.log("");
if (pass) {
  console.log("PASS");
  process.exit(0);
} else {
  console.log("FAIL");
  process.exit(1);
}
