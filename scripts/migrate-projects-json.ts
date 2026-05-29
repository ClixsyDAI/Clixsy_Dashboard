/**
 * One-off migration: rewrite app/data/projects.json into the post-GHL-pivot
 * shape (see app/lib/projects.ts for the canonical Project interface).
 *
 * Transform (per entry):
 *   id          : Number → String(old.id)
 *   name        : drops the leading "J\d+ " prefix; matches:
 *                   "J412 Gaithersburg Garage Door, Inc"
 *                       → name "Gaithersburg Garage Door, Inc"
 *                       → j_number "412"
 *                 entries that don't match the prefix keep `name` as-is and
 *                 set `j_number = null`.
 *   description : empty string ("") → null; non-empty preserved as-is.
 *   vertical    : hardcoded "law_firm" for all 63 historical entries
 *                 (per Johan, the pre-GHL client list is all law firms).
 *   ghl_contact_id / am_ghl_user_id / website_url : null
 *   todoset_id  : dropped (Basecamp-era field, will be removed alongside
 *                 the poller).
 *
 * Output formatting matches the existing file byte-style: one compact
 * JSON object per line, 2-space leading indent, trailing newline. This
 * keeps `commitProjectsManifest()` (app/lib/github.ts) happy — it writes
 * the same format on every cron-driven update.
 *
 * Run once locally:
 *   npx tsx scripts/migrate-projects-json.ts
 *
 * Do NOT run on Vercel. The script writes to the local filesystem.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface OldProject {
  id: number;
  name: string;
  description: string;
  todoset_id: number;
}

interface NewProject {
  id: string;
  name: string;
  j_number: string | null;
  description: string | null;
  vertical: "law_firm" | "home_services" | "other";
  ghl_contact_id: string | null;
  am_ghl_user_id: string | null;
  website_url: string | null;
}

const J_PREFIX = /^J(\d+)\s+(.+)$/;

const repoRoot = join(__dirname, "..");
const filePath = join(repoRoot, "app", "data", "projects.json");

const raw = readFileSync(filePath, "utf8");
const beforeCount = (raw.match(/^\s*\{/gm) || []).length;
const old: OldProject[] = JSON.parse(raw);

let prefixedCount = 0;
let unprefixedCount = 0;
let descNullCount = 0;
let descKeptCount = 0;

const migrated: NewProject[] = old.map((o) => {
  const match = o.name.match(J_PREFIX);
  let j_number: string | null;
  let name: string;
  if (match) {
    j_number = match[1];
    name = match[2];
    prefixedCount++;
  } else {
    j_number = null;
    name = o.name;
    unprefixedCount++;
  }

  let description: string | null;
  if (typeof o.description === "string" && o.description.length > 0) {
    description = o.description;
    descKeptCount++;
  } else {
    description = null;
    descNullCount++;
  }

  return {
    id: String(o.id),
    name,
    j_number,
    description,
    vertical: "law_firm",
    ghl_contact_id: null,
    am_ghl_user_id: null,
    website_url: null,
  };
});

const lines = migrated.map((p) => "  " + JSON.stringify(p));
const out = "[\n" + lines.join(",\n") + "\n]\n";
writeFileSync(filePath, out, "utf8");

const afterCount = migrated.length;

console.log("=".repeat(60));
console.log("projects.json migration summary");
console.log("=".repeat(60));
console.log(`Entries before: ${beforeCount}`);
console.log(`Entries after:  ${afterCount}`);
console.log("");
console.log(`J-prefix extracted:  ${prefixedCount}`);
console.log(`No J-prefix (kept as-is): ${unprefixedCount}`);
console.log("");
console.log(`Description preserved: ${descKeptCount}`);
console.log(`Description → null:    ${descNullCount}`);
console.log("");
console.log(`Wrote ${out.length} bytes to ${filePath}`);
