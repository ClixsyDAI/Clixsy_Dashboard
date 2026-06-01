// =============================================================
// oauth-email-guards tests — colocated with the helpers
// =============================================================
//
// Run from the workbook repo root:
//   node --experimental-strip-types --test app/lib/oauth-email-guards.test.ts
//
// Same testing pattern as return-url.test.ts — Node 22+'s built-in
// test runner via --experimental-strip-types so we can run
// TypeScript directly without transpiling. No new dependency.
//
// Covers Phase 1 PR B's layer-2 (email_verified) and layer-3
// (email domain ends with @clixsy.com) guards in the OAuth
// callback. The rest of the callback (Supabase code exchange,
// app_users lookup, cookie minting) is integration-tested via
// the preview-deploy verification recipe — see
// docs/phase1-oauth-setup.md and operations-notes.md §6.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isClixsyEmail, isEmailVerified } from "./oauth-email-guards.ts";

describe("isClixsyEmail", () => {
  describe("accepts canonical clixsy.com addresses", () => {
    it("johan@clixsy.com", () => {
      assert.equal(isClixsyEmail("johan@clixsy.com"), true);
    });
    it("uppercase letters still match (case-insensitive)", () => {
      assert.equal(isClixsyEmail("Johan@Clixsy.com"), true);
      assert.equal(isClixsyEmail("JOHAN@CLIXSY.COM"), true);
    });
    it("mixed-case local part", () => {
      assert.equal(isClixsyEmail("Andrew.Pickett@clixsy.com"), true);
    });
  });

  describe("rejects non-clixsy domains", () => {
    it("gmail.com", () => {
      assert.equal(isClixsyEmail("attacker@gmail.com"), false);
    });
    it("hotmail.com", () => {
      assert.equal(isClixsyEmail("victim@hotmail.com"), false);
    });
    it("clixsy.co (typo-domain)", () => {
      assert.equal(isClixsyEmail("johan@clixsy.co"), false);
    });
    it("clixsy.com.evil.com (subdomain attack)", () => {
      assert.equal(isClixsyEmail("johan@clixsy.com.evil.com"), false);
    });
    it("sub.clixsy.com (subdomain — strict equality required)", () => {
      assert.equal(isClixsyEmail("johan@sub.clixsy.com"), false);
    });
    it("clixsycom (no dot — close but no match)", () => {
      assert.equal(isClixsyEmail("johan@clixsycom"), false);
    });
  });

  describe("rejects empty / null / undefined", () => {
    it("null", () => {
      assert.equal(isClixsyEmail(null), false);
    });
    it("undefined", () => {
      assert.equal(isClixsyEmail(undefined), false);
    });
    it("empty string", () => {
      assert.equal(isClixsyEmail(""), false);
    });
  });

  describe("rejects malformed inputs that LOOK like clixsy.com", () => {
    it("no @ sign before clixsy.com", () => {
      // Defence: a raw "clixsy.com" string should not pass — only
      // strings with @clixsy.com as the domain segment do.
      assert.equal(isClixsyEmail("clixsy.com"), false);
    });
    it("trailing whitespace not trimmed (intentional — caller responsible)", () => {
      // Document the contract: the guard does NOT trim. Callers
      // should normalise before calling. A trailing space breaks
      // the endsWith match.
      assert.equal(isClixsyEmail("johan@clixsy.com "), false);
    });
    it("string containing @clixsy.com but ending after — still ok", () => {
      // Ends with @clixsy.com: accepted. (The Supabase user
      // object's email field is already validated by Google's
      // OAuth flow before reaching us, so we trust the basic
      // shape.)
      assert.equal(isClixsyEmail("anything@clixsy.com"), true);
    });
  });
});

describe("isEmailVerified", () => {
  describe("accepts when user_metadata.email_verified is true", () => {
    it("plain shape", () => {
      assert.equal(
        isEmailVerified({ user_metadata: { email_verified: true } }),
        true,
      );
    });
    it("with other metadata present", () => {
      assert.equal(
        isEmailVerified({
          email: "johan@clixsy.com",
          user_metadata: { email_verified: true },
        }),
        true,
      );
    });
  });

  describe("accepts when one of identities[].identity_data.email_verified is true", () => {
    it("single identity, verified", () => {
      assert.equal(
        isEmailVerified({
          identities: [{ identity_data: { email_verified: true } }],
        }),
        true,
      );
    });
    it("multiple identities, only one verified", () => {
      assert.equal(
        isEmailVerified({
          identities: [
            { identity_data: { email_verified: false } },
            { identity_data: { email_verified: true } },
          ],
        }),
        true,
      );
    });
    it("user_metadata unverified but identity verified — accept", () => {
      assert.equal(
        isEmailVerified({
          user_metadata: { email_verified: false },
          identities: [{ identity_data: { email_verified: true } }],
        }),
        true,
      );
    });
  });

  describe("rejects when neither location asserts true", () => {
    it("user_metadata.email_verified === false", () => {
      assert.equal(
        isEmailVerified({ user_metadata: { email_verified: false } }),
        false,
      );
    });
    it("user_metadata.email_verified missing, no identities", () => {
      assert.equal(
        isEmailVerified({ user_metadata: {} }),
        false,
      );
    });
    it("user_metadata missing, identities empty", () => {
      assert.equal(isEmailVerified({ identities: [] }), false);
    });
    it("user_metadata.email_verified is the STRING 'true' (not boolean)", () => {
      // Strict equality matters — a hostile id_token might return
      // the string "true" instead of boolean true. Reject.
      assert.equal(
        // @ts-expect-error intentionally passing wrong type
        isEmailVerified({ user_metadata: { email_verified: "true" } }),
        false,
      );
    });
    it("user_metadata.email_verified is 1 (truthy but not true)", () => {
      assert.equal(
        // @ts-expect-error intentionally passing wrong type
        isEmailVerified({ user_metadata: { email_verified: 1 } }),
        false,
      );
    });
    it("identities entry is null", () => {
      assert.equal(isEmailVerified({ identities: [null] }), false);
    });
    it("identities entry has no identity_data", () => {
      assert.equal(isEmailVerified({ identities: [{}] }), false);
    });
  });

  describe("rejects empty / null / undefined", () => {
    it("null user", () => {
      assert.equal(isEmailVerified(null), false);
    });
    it("undefined user", () => {
      assert.equal(isEmailVerified(undefined), false);
    });
    it("empty user object", () => {
      assert.equal(isEmailVerified({}), false);
    });
  });
});
