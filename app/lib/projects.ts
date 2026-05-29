/**
 * Canonical Project type for the workbook's master client list
 * (app/data/projects.json).
 *
 * Shape post-GHL-pivot migration (chore/projects-json-shape-migration):
 *
 *   - `id` is the **GHL opportunity id** (20-char alphanumeric string)
 *     for entries created via the new webhook receiver. Existing
 *     migrated entries hold the prior Basecamp numeric id, stringified.
 *   - `name` is the **display name with the J-prefix stripped**.
 *     For migrated entries the prefix was parsed out into `j_number`.
 *   - `j_number` is the numeric portion of the historical J-tag
 *     (e.g. "412"), without the "J". New entries via GHL arrive
 *     `null` and get filled in by an AM later in the admin UI.
 *   - `vertical` distinguishes routing for downstream automations
 *     (e.g. law-firm onboarding form vs. home-services flow).
 *     All historical entries are hardcoded `"law_firm"` (per Johan).
 *   - `ghl_contact_id` / `am_ghl_user_id` come from the GHL webhook
 *     payload for new entries. `null` for historical entries with
 *     no GHL counterpart.
 *   - `website_url` mirrors the GHL Website URL custom field.
 *   - `todoset_id` is the **deprecated** Basecamp todoset id. Kept
 *     optional on the type so the legacy Basecamp routes
 *     (/api/sync, /api/sync/[projectId], /api/cron/basecamp-poller)
 *     keep compiling until their removal PR. The field is removed
 *     from the JSON data file in this migration; consumers see
 *     `undefined` at runtime.
 */
export interface Project {
  id: string;
  name: string;
  j_number: string | null;
  description: string | null;
  vertical: "law_firm" | "home_services" | "other";
  ghl_contact_id: string | null;
  am_ghl_user_id: string | null;
  website_url: string | null;
  /** @deprecated Basecamp-era field, scheduled for removal alongside the Basecamp poller. */
  todoset_id?: number;
}
