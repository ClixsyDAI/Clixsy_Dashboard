# Phase 1 — Google OAuth provider setup

One-time manual setup for the Google OAuth provider used by the workbook's sign-in flow. PR A of Phase 1 introduces this; PR B wires up the sign-in flow that depends on it. Document kept in-repo so credentials can be rotated in the future without re-discovering the steps.

## Why this is manual

Three pieces of configuration live outside the codebase and outside Supabase migrations:

1. The Google Cloud Console OAuth 2.0 client (owned by Google).
2. The provider toggle + client credentials in Supabase Dashboard (owned by Supabase).
3. The hosted-domain (`hd`) restriction in Supabase Dashboard.

None of these are scriptable from the repo. Anyone with super-admin access to both Google Cloud Console and Supabase Dashboard can complete the setup; the rest of the team only needs the credentials to be working.

## Prerequisites

- Google Workspace admin (or owner) access to the `clixsy.com` workspace.
- Access to the [`lawwsutjxopiekjzupef` Supabase Dashboard](https://supabase.com/dashboard/project/lawwsutjxopiekjzupef).
- Migration `010_app_users_and_access_requests.sql` already applied (super-admin row for `johan@clixsy.com` exists in `app_users`).

## Step 1 — Find the Supabase callback URL

The Supabase Auth callback URL is what Google needs as an "Authorized redirect URI." Get the exact value from the Supabase Dashboard, not from documentation (the host shape can vary by project region).

1. Open https://supabase.com/dashboard/project/lawwsutjxopiekjzupef/auth/providers
2. Click **Google** (provider list, currently disabled).
3. The expanded panel shows a field labeled **"Callback URL (for OAuth)"** or similar. The value will be something like:

   ```
   https://lawwsutjxopiekjzupef.supabase.co/auth/v1/callback
   ```

   Copy that exact string — you'll paste it into Google Cloud Console in Step 2.

## Step 2 — Create the OAuth 2.0 client in Google Cloud Console

1. Open https://console.cloud.google.com/.
2. Top-left project picker → make sure a Clixsy-owned project is selected. If one doesn't exist, create a new project named `clixsy-workbook-auth` (or similar). The project just hosts the OAuth client; it doesn't need any APIs enabled beyond the default identity ones.
3. Left nav → **APIs & Services** → **OAuth consent screen**.
   - Choose **Internal** (this restricts the consent screen to the `clixsy.com` workspace — non-clixsy.com accounts can't reach it). If "Internal" is greyed out, the project isn't attached to the workspace; check the project owner.
   - App name: `Clixsy Workbook`
   - User support email: `johan@clixsy.com`
   - App logo: optional
   - Authorised domains: `clixsy.com` and `supabase.co`
   - Developer contact: `johan@clixsy.com`
   - Save and continue through the scopes screen (no extra scopes needed beyond defaults — `openid email profile`).
4. Left nav → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: `Clixsy Workbook — Supabase Auth`
   - Authorized JavaScript origins: `https://client-workbook-dashboard.vercel.app` (production hostname; you can add preview hostnames later if needed, but Supabase handles the OAuth dance so the workbook hostname itself isn't strictly required here)
   - **Authorized redirect URIs**: paste the Supabase callback URL from Step 1.
   - Click **Create**.
5. A modal shows the **Client ID** and **Client secret**. Copy both. Treat the client secret like a production password — paste it directly into Supabase in Step 3 and don't echo it anywhere else.

## Step 3 — Configure the Google provider in Supabase Dashboard

1. Back at https://supabase.com/dashboard/project/lawwsutjxopiekjzupef/auth/providers, **Google** panel.
2. Toggle **Enable Google provider** to ON.
3. Paste the **Client ID** from Step 2 into the Client ID field.
4. Paste the **Client Secret** from Step 2 into the Client Secret field.
5. **Authorized Client IDs** (the field below the secret): paste the same Client ID. This is what restricts which OAuth clients can authenticate against this provider; a Clixsy-owned client is the only one we want to accept.
6. **Skip nonce check**: leave OFF.
7. Click **Save**.

## Step 4 — Restrict to `clixsy.com` only (hosted-domain enforcement)

This is the belt-and-braces layer. Step 2's "Internal" consent screen already restricts the OAuth dance to `clixsy.com`, but if that project setting ever gets flipped to "External" the hosted-domain restriction here keeps non-clixsy.com accounts out.

Supabase exposes this via the URL-builder parameters passed on the OAuth sign-in call from the client. Per Supabase docs, pass `queryParams: { hd: 'clixsy.com' }` to `signInWithOAuth`. PR B wires this in code. There's no dashboard toggle.

(If Supabase later adds a dashboard-level "Restrict to hosted domain" toggle for Google, switch to that and remove the code-side parameter — defence in depth without complexity.)

## Step 5 — Verify

After Steps 1–4:

1. Go to `https://client-workbook-dashboard.vercel.app/admin` (or any preview deploy that has PR B's code).
2. Click "Sign in with Google."
3. Google prompts for your `@clixsy.com` account.
4. Sign in. You should be redirected back to the workbook, signed in.

If Google rejects with "User type not allowed" or similar: the consent screen is set to "External" — fix in Step 2.

If Google accepts but Supabase returns an error: the client ID/secret in Step 3 don't match — re-paste from Step 2.

## Credential rotation

Rotate the Google Client Secret if:
- It's been more than 12 months since last rotation.
- A team member with access to Supabase Dashboard or Google Cloud Console leaves Clixsy.
- The secret was accidentally exposed (logged, committed, shared via insecure channel).

Rotation steps:
1. Google Cloud Console → APIs & Services → Credentials → the workbook OAuth client → **Add secret** → copy the new secret.
2. Supabase Dashboard → Auth → Providers → Google → paste new secret → Save.
3. Google Cloud Console → revoke the old secret (do this AFTER Supabase is using the new one to avoid downtime).

The Client ID stays the same across rotations.

## Removing access for someone who leaves

User-level revocation happens in the workbook itself (Users tab in /admin → disable the row in `app_users`). This is instant and doesn't require touching Google or Supabase.

You only need to touch Google Cloud Console / Supabase if the person had super-admin access to those dashboards — in which case revoke their access there via the normal Google Workspace + Supabase admin flows.

## Reference

- Supabase Auth Google provider docs: https://supabase.com/docs/guides/auth/social-login/auth-google
- Google Cloud OAuth 2.0 setup: https://developers.google.com/identity/protocols/oauth2/web-server
- The `hd` parameter for hosted-domain restriction: https://developers.google.com/identity/openid-connect/openid-connect#hd-param
