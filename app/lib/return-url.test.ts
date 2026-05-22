// =============================================================
// return-url tests — colocated with the helper
// =============================================================
//
// Run from the workbook repo root:
//   node --experimental-strip-types --test app/lib/return-url.test.ts
//
// Uses Node's built-in `node:test` runner — no new dependency. Node
// 22+ ships --experimental-strip-types so we can run TypeScript
// directly without transpiling.
//
// Test cases per phase-8-proper-plan.md §4.2 (including the two
// query-string cases added by the operator's tweak before PR A).
// The validator must NEVER throw — that property is implicitly
// covered by the `ok === false` branches passing without assertion.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateReturnPath } from "./return-url.ts";

describe("validateReturnPath", () => {
  describe("rejects empty / null / undefined", () => {
    it("null", () => {
      const r = validateReturnPath(null);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "empty");
    });
    it("undefined", () => {
      const r = validateReturnPath(undefined);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "empty");
    });
    it("empty string", () => {
      const r = validateReturnPath("");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "empty");
    });
  });

  describe("accepts known-good prefixes", () => {
    it("/client/<id>", () => {
      const r = validateReturnPath("/client/40435636");
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.path, "/client/40435636");
    });
    it("/api/onboarding/<rest>", () => {
      const r = validateReturnPath("/api/onboarding/by-workbook-id/40435636");
      assert.equal(r.ok, true);
    });
    it("nested /client/<id>/something (forward-compatible)", () => {
      const r = validateReturnPath("/client/40435636/overview");
      assert.equal(r.ok, true);
    });
  });

  describe("rejects non-gated paths", () => {
    it("/admin itself is not a useful return target", () => {
      const r = validateReturnPath("/admin");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "not in allowed prefix list");
    });
    it("landing page /", () => {
      const r = validateReturnPath("/");
      assert.equal(r.ok, false);
    });
    it("public share path", () => {
      const r = validateReturnPath("/share/abc");
      assert.equal(r.ok, false);
    });
  });

  describe("rejects open-redirect attempts", () => {
    it("protocol-relative //evil.com", () => {
      const r = validateReturnPath("//evil.com");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "non-relative");
    });
    it("Windows-style \\\\evil.com", () => {
      const r = validateReturnPath("\\\\evil.com");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "non-relative");
    });
    it("http://evil.com/client/x", () => {
      const r = validateReturnPath("http://evil.com/client/x");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "non-relative");
    });
    it("https://evil.com/client/x", () => {
      const r = validateReturnPath("https://evil.com/client/x");
      assert.equal(r.ok, false);
    });
    it("javascript:alert(1)", () => {
      const r = validateReturnPath("javascript:alert(1)");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "non-relative");
    });
    it("data:text/html,<script>", () => {
      const r = validateReturnPath("data:text/html,<script>");
      assert.equal(r.ok, false);
    });
    it("encoded protocol-relative %2F%2Fevil.com", () => {
      const r = validateReturnPath("%2F%2Fevil.com");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "non-relative after decode");
    });
  });

  describe("rejects encoding tricks", () => {
    it("accepts cleanly-encoded /client/<id>", () => {
      const r = validateReturnPath("%2Fclient%2F40435636");
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.path, "/client/40435636");
    });
    it("rejects double-encoded /client/<id>", () => {
      const r = validateReturnPath("%252Fclient%252F40435636");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "double-encoded");
    });
    it("rejects malformed percent-encoding", () => {
      const r = validateReturnPath("/client/%ZZ");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "malformed encoding");
    });
  });

  describe("rejects traversal + relative paths", () => {
    it("/client/../admin", () => {
      const r = validateReturnPath("/client/../admin");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "traversal");
    });
    it("not-absolute path", () => {
      const r = validateReturnPath("client/40435636");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "not absolute");
    });
  });

  describe("rejects query string + fragment (operator tweak)", () => {
    it("/client/<id>?foo=bar", () => {
      const r = validateReturnPath("/client/40435636?foo=bar");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "contains query");
    });
    it("/client/<id>#fragment", () => {
      const r = validateReturnPath("/client/40435636#fragment");
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "contains query");
    });
  });

  describe("bounds the input", () => {
    it("rejects > 256 chars", () => {
      const r = validateReturnPath("/client/" + "a".repeat(300));
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "too long");
    });
    it("accepts exactly 256 chars (boundary)", () => {
      const padding = "a".repeat(256 - "/client/".length);
      const r = validateReturnPath("/client/" + padding);
      assert.equal(r.ok, true);
    });
  });
});
