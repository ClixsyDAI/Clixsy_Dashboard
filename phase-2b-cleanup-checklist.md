# Phase 2b cleanup checklist

After the automation is fully verified end-to-end with a real new client, clean up the J999 test artifacts:

## Workbook
- [ ] Remove `app/data/projects.json` entry for the J999 test client
- [ ] Delete `app/data/clients/47431551.json` file if created (only exists if a sync ran)
- [ ] Commit the removal: "chore: remove J999 test client after Phase 7 verification"

## Supabase
- [ ] Delete the J999 `clients` row via Supabase MCP or dashboard (the row keyed on `workbook_id = 47431551`)
- [ ] Verify cascade: confirm `onboarding_sessions`, `onboarding_answers`, `onboarding_audit_events`, `onboarding_field_edits`, `onboarding_reminders`, `onboarding_open_events` rows for this client are all gone

## Basecamp
- [ ] Open the J999 project in Basecamp web UI: https://3.basecamp.com/4226914/buckets/47431551
- [ ] Project menu → Trash this project
- [ ] Confirm it's removed from the active projects list
- [ ] Revoke Barnes (`barnes@clixsy.com`, person id `52450526`) from the project (or rely on trash cascade). Barnes was created at the account level during Phase 3 verification — if Barnes isn't a real Clixsy member, also delete the account-level user via Basecamp admin

## Workbook team_assignments (added during Phase 3 verification)
- [ ] Revert `app/data/team-assignments.json` on master to remove `"Barnes"` from the `employees` array AND from `assignments["47431551"]`. The commit to revert is the most recent `"test: assign Barnes to J999 (47431551) — verification, will be reverted"`. After revert, Vercel will redeploy without Barnes on the J999 team badges.

## Scratch files
- [ ] Delete `C:\Users\johan\AppData\Local\Temp\j999-test-ids.json`
- [ ] Delete `C:\Users\johan\AppData\Local\Temp\phase-2b-runner.mjs` (one-off node script used to bootstrap the test project)
- [ ] Delete `C:\Users\johan\bc-token.json` (refreshed Basecamp access token saved during Phase 2b; the workbook's production env vars hold the canonical pair)

## This checklist
- [ ] Delete `phase-2b-cleanup-checklist.md` from the workbook repo

---

## IDs captured during Phase 2b (2026-05-26)

| Artifact | ID |
|---|---|
| Basecamp project (bucket) | `47431551` |
| Message board | `9929824264` |
| Todoset | `9929824270` |
| Verification test message | `9929824413` |
