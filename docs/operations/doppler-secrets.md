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
| `prd`  | `CLOUDFLARE_WORKER_SECRETS_TOKEN` | `codice-worker-secrets`   | Workers Scripts Edit        | `sync-worker-secrets.yml`               |

Until the Handle tokens are created, the values in Doppler are still the Jaantonio-scoped ones from
before the 2026-10-27 move, and the ingestion and the sync fail with `403` against Handle.

## Worker secret sync

Each Worker declares its secrets in its `wrangler.jsonc` (`secrets.required`); today only
`codice-api` does (`SENTRY_DSN`). `.github/workflows/sync-worker-secrets.yml` runs
`scripts/secrets/sync-worker-secrets.mjs`, which reads every `apps/*/wrangler.jsonc` and pushes to
each Worker only the names it declares, so the ingestion tokens and the sync's own token never reach
a Worker. A new Worker secret is a `secrets.required` entry plus the Doppler `prd` value; the
script needs no change.

The sync should sign in with its own Doppler service account, `codice-worker-secrets` (read on
`codice` `prd` only), separate from the corpus one, so each workflow can be revoked alone. Until
its GitHub identity exists, the workflow uses the corpus identity below; once it does, pin its ID
in the workflow's `DOPPLER_IDENTITY_ID`.

The repository moved from `trstv/codice` to `handlemotion/codice` (same repository ID
`1432699064`, owner ID `203549640`). Since then the OIDC subject is
`repo:handlemotion@203549640/codice@1432699064:ref:refs/heads/main`, so every identity pinned to
the `trstv` subject must be re-created with it; the scheduled sync of 2026-10-27 already failed at
the OIDC step.

It runs daily, on demand (plan by default), and on `repository_dispatch` `doppler-config-changed`.
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
   `https://github.com/trstv`, subject `repo:trstv@329148314/codice@1432699064:ref:refs/heads/main`
   (done: identity `trstv-codice-main`).
2. Pin its ID in the workflow's `DOPPLER_IDENTITY_ID` (an ID, not a secret).

GitHub writes the subject with the organization's and repository's numeric IDs, and Doppler
compares it exactly: an identity set to the plain `repo:trstv/codice:…` form fails with
`claim "sub" does not match identity auth config`. The login step prints the subject it sent
(`oidc sub=…`). The subject admits only runs on `main`, so a run from any other branch cannot read
the production tokens.
