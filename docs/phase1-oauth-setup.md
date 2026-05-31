# Phase 1 — Google OAuth provider setup

The workbook's Google sign-in flow (introduced in Phase 1 PR B) authenticates via the Supabase Auth Google provider. This doc captures the state of that provider and how to rotate it; it's intentionally short because the heavy lifting was already done by the onboarding repo's setup.

## Current state (as of Phase 1 PR A, 2026-05-31)

The Supabase Auth Google provider on project `lawwsutjxopiekjzupef` is **already configured**. The workbook and the onboarding repo share this Supabase project, and the onboarding repo set up the Google OAuth provider previously. Phase 1 PR A reuses that existing configuration — no Google Cloud Console changes were needed.

- **Supabase project**: `lawwsutjxopiekjzupef` (shared with `client-onboarding-tool`)
- **Provider status**: Google → Enabled
- **Callback URL**: `https://lawwsutjxopiekjzupef.supabase.co/auth/v1/callback`
- **Underlying Google Cloud project**: project number `170670946909` (Clixsy-owned; the project's display name was not captured during PR A — verify via the Google Cloud Console project picker if you need it)
- **Client ID**: `170670946909-bc9mg87h2q5a957qchc14vlcaekscfm4.apps.googleusercontent.com`
- **Hosted-domain restriction (`hd=clixsy.com`)**: enforced at the application layer by Phase 1 PR B's `signInWithOAuth({ provider: 'google', options: { queryParams: { hd: 'clixsy.com' } } })` call. This is the source of truth for "only `@clixsy.com` accounts may sign in." Whatever the underlying consent screen is set to (Internal vs External) does not change the workbook's behavior — the `hd` parameter rejects non-clixsy.com accounts regardless.

## Why this is documented

Three pieces of configuration live outside the codebase and outside Supabase migrations:

1. The Google Cloud Console OAuth 2.0 client (owned by Google, project `170670946909`).
2. The provider toggle + client credentials in the Supabase Dashboard.
3. The hosted-domain restriction — currently enforced in code (PR B), not in dashboards.

None of these are scriptable from the repo. Anyone with admin access to the Google Cloud project AND the Supabase Dashboard can rotate the credentials when needed; the rest of the team only needs the OAuth flow to keep working.

## Prerequisites for adding a new admin to the OAuth setup

- Access to the [`lawwsutjxopiekjzupef` Supabase Dashboard](https://supabase.com/dashboard/project/lawwsutjxopiekjzupef).
- IAM role on Google Cloud project `170670946909` that includes `clientauthconfig.clients.getWithSecret` (Owner or Editor is sufficient; the dedicated "OAuth Config Editor" role also works).
- Migration `010_app_users_and_access_requests.sql` already applied (super-admin row for `johan@clixsy.com` exists in `public.app_users`).

## Credential rotation

Rotate the Google Client Secret if:
- It's been more than 12 months since last rotation.
- A team member with access to the Supabase Dashboard or the Google Cloud project leaves Clixsy.
- The secret was accidentally exposed (logged, committed, shared via insecure channel).

Rotation steps:
1. Google Cloud Console → APIs & Services → Credentials → the OAuth 2.0 client for project `170670946909` → **Add secret** → copy the new secret.
2. Supabase Dashboard → Authentication → Sign In / Providers → Google → paste the new secret into "Client Secret (for OAuth)" → **Save**.
3. Google Cloud Console → revoke the old secret (do this AFTER Supabase is saved with the new one, otherwise the live sign-in flow breaks during the gap).

The Client ID stays the same across secret rotations. If you need to rotate the Client ID itself (e.g., migrating to a different Google Cloud project), you also need to update the "Authorized redirect URI" on the new client to `https://lawwsutjxopiekjzupef.supabase.co/auth/v1/callback`.

## Verifying the setup end-to-end

After PR B is deployed:

1. Go to `https://client-workbook-dashboard.vercel.app/admin`.
2. Click **Sign in with Google**.
3. Google prompts for an account — sign in with your `@clixsy.com` account.
4. Expected: redirected back to the workbook, signed in.

If Google rejects with an `access_denied` or "User type not allowed" error: the `hd=clixsy.com` parameter rejected the account. Try a `@clixsy.com` account instead.

If Google accepts but Supabase returns an OAuth error: the Client ID/Secret in Supabase don't match the Google Cloud project. Re-rotate per the section above.

## Removing access for someone who leaves

User-level revocation happens in the workbook itself (Users tab in `/admin` → disable the row in `app_users`). This is instant and doesn't require touching Google or Supabase.

You only need to touch Google Cloud Console / Supabase if the person had admin access to those dashboards — in which case revoke their access via the normal Google Workspace + Supabase admin flows. The Client Secret should be rotated (see above) any time someone with Supabase Dashboard access leaves.

## Reference

- Supabase Auth Google provider docs: https://supabase.com/docs/guides/auth/social-login/auth-google
- Google Cloud OAuth 2.0 setup: https://developers.google.com/identity/protocols/oauth2/web-server
- The `hd` parameter for hosted-domain restriction: https://developers.google.com/identity/openid-connect/openid-connect#hd-param
