# Doppler secrets

Códice has its own Doppler project, `codice`, with the root configs `dev`, `stg` and `prd`. Its
Cloudflare tokens are per project: account-owned tokens on the Handle account
(`473fbe436e39d8f3d33b6bb09afd3dd7`) named `codice-*`, held only here and rotated without touching
another project. Cloudflare cannot narrow Workers Scripts or D1 permissions to one script or
database, so a per-project token still reaches the whole account; keeping one token per project
and purpose is what limits a leak to Códice and lets it be revoked on its own.

| Config | Secret                            | Cloudflare token (Handle) | Permissions                 | Used by                                 |
| ------ | --------------------------------- | ------------------------- | --------------------------- | --------------------------------------- |
| `dev`  | `CODICE_AI_SEARCH_TOKEN`          | `codice-ai-search-dev`    | AI Search Run, Read         | `dev`, `eval` (cannot change the index) |
| `prd`  | `CODICE_AI_SEARCH_TOKEN`          | `codice-ai-search`        | AI Search Write (Edit), Run | `ingest`                                |
| `prd`  | `CODICE_D1_TOKEN`                 | `codice-d1`               | D1 Edit                     | `ingest` (`wrangler d1 execute`)        |
| `prd`  | `SENTRY_DSN`                      | –                         | –                           | Worker `codice-api`                     |
| `prd`  | `ANTHROPIC_API_KEY`               | –                         | –                           | Worker `codice-api` (`POST /v1/chat`)   |
| `prd`  | `CLOUDFLARE_WORKER_SECRETS_TOKEN` | `codice-worker-secrets`   | Workers Scripts Edit        | `sync-worker-secrets.yml`               |
| `prd`  | `BETTER_AUTH_SECRET`              | –                         | –                           | Worker `codice-app` (signs sessions)    |
| `prd`  | `GOOGLE_CLIENT_ID`                | –                         | –                           | Worker `codice-app` (Google sign-in)    |
| `prd`  | `GOOGLE_CLIENT_SECRET`            | –                         | –                           | Worker `codice-app` (Google sign-in)    |
| `prd`  | `GITHUB_CLIENT_ID`                | –                         | –                           | Worker `codice-app` (GitHub sign-in)    |
| `prd`  | `GITHUB_CLIENT_SECRET`            | –                         | –                           | Worker `codice-app` (GitHub sign-in)    |
| `prd`  | `CODICE_SITE_API_KEY`             | –                         | –                           | Worker `codice-site` (demo chat's key)  |

`BETTER_AUTH_SECRET` is a random value of at least 32 characters (`openssl rand -base64 32`);
rotating it signs every user out. The Google OAuth client and the GitHub OAuth app each take the
callback `https://codice.io/api/auth/callback/google` and `.../callback/github`.
`CODICE_SITE_API_KEY` is a `cdc_` key created in the dashboard (`/keys`) by the owner of a Códice
team kept for the site; revoking it stops the demo chat until a new one is synced.

## Worker secret sync

Each Worker declares its secrets in its `wrangler.jsonc` (`secrets.required`): `codice-api`
(`ANTHROPIC_API_KEY`, `SENTRY_DSN`), `codice-app` (`BETTER_AUTH_SECRET` and the Google and GitHub
client ids and secrets) and `codice-site` (`CODICE_SITE_API_KEY`). `.github/workflows/sync-worker-secrets.yml` runs
`scripts/secrets/sync-worker-secrets.mjs`, which reads every `apps/*/wrangler.jsonc` and pushes to
each Worker only the names it declares, so the ingestion tokens and the sync's own token never reach
a Worker. A new Worker secret is a `secrets.required` entry plus the Doppler `prd` value; the
script needs no change.

Cloudflare refuses a plain secret edit (`10215`) while the Worker's latest version is not the
deployed one, which a preview build (`wrangler versions upload` on a branch) leaves behind. The
sync then stages the secrets on a new version from the latest one, as `wrangler versions secret
bulk` does, without deploying it. Uploads inherit from the most recently uploaded version, so the
next production deploy of `main` carries them to traffic.

The sync signs in with its own Doppler service account, `codice-worker-secrets` (Viewer on `codice`
`prd` only), separate from the corpus one, so each workflow can be revoked alone. Its GitHub
identity `handlemotion-codice-main-secrets` (ID pinned in the workflow's `DOPPLER_IDENTITY_ID`) has
issuer `https://token.actions.githubusercontent.com`, audience `https://github.com/handlemotion` and
subject `repo:handlemotion@203549640/codice@1432699064:ref:refs/heads/main`.

The repository moved from `trstv/codice` to `handlemotion/codice` (same repository ID
`1432699064`), which changed the OIDC subject; both identities were re-created for it on
2026-10-27.

Cloudflare refuses a secret edit (`10215`) while the Worker's newest version is not the deployed
one, so a Worker with secrets must not get preview builds: `codice-api`, `codice-app` and
`codice-site` must have them off. If the sync
fails with `10215` anyway, retry the latest `main` build, then run the sync again.

It runs daily, on demand (plan by default), on a push to `main` that changes an
`apps/*/wrangler.jsonc` (so a merge that declares a new secret syncs it), and on
`repository_dispatch` `doppler-config-changed`.
For the dispatch, the Doppler webhook on `codice` `prd` must target this repository
(`POST https://api.github.com/repos/handlemotion/codice/dispatches`, body
`{"event_type":"doppler-config-changed"}`, a GitHub token with Contents write); until it does, the
daily run picks a change up within a day.

## Corpus workflow identity

`.github/workflows/codice-corpus.yml` exchanges its GitHub OIDC token for a short-lived Doppler
token, so GitHub holds no long-lived Doppler secret. One-time setup
(Doppler dashboard, workplace owner):

1. On the service account `codice-corpus` (read access to `codice` `dev` and `prd`), add a GitHub
   identity for this repository: issuer `https://token.actions.githubusercontent.com`, audience
   `https://github.com/handlemotion`, subject
   `repo:handlemotion@203549640/codice@1432699064:ref:refs/heads/main` (done: identity
   `handlemotion-codice-main`; the old `gh oidc` identity with the `trstv` subject is unused and
   can be deleted).
2. Pin its ID in the workflow's `DOPPLER_IDENTITY_ID` (an ID, not a secret).

GitHub writes the subject with the organization's and repository's numeric IDs, and Doppler
compares it exactly: an identity set to the plain `repo:handlemotion/codice:…` form fails with
`claim "sub" does not match identity auth config`. The login step prints the subject it sent
(`oidc sub=…`). The subject admits only runs on `main`, so a run from any other branch cannot read
the production tokens.
