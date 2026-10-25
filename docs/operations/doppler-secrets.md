# Doppler secrets

Códice has its own Doppler project, `codice`, with the root configs `dev`, `stg` and `prd`. Each
holds Cloudflare account tokens for the AI Search instance and the D1 database `codice`:

| Config | Secret                            | Cloudflare token                                                             | Permissions                 | Used by                                 |
| ------ | --------------------------------- | ---------------------------------------------------------------------------- | --------------------------- | --------------------------------------- |
| `dev`  | `CODICE_AI_SEARCH_TOKEN`          | `codice-ai-search-dev`                                                       | AI Search Run, Read         | `dev`, `eval` (cannot change the index) |
| `prd`  | `CODICE_AI_SEARCH_TOKEN`          | `codice-ai-search`                                                           | AI Search Write (Edit), Run | `ingest`                                |
| `prd`  | `CODICE_D1_TOKEN`                 | `codice-d1`                                                                  | D1 Edit                     | `ingest` (`wrangler d1 execute`)        |
| `prd`  | `SENTRY_DSN`                      | –                                                                            | –                           | Worker `codice`                         |
| `prd`  | `CLOUDFLARE_WORKER_SECRETS_TOKEN` | Transitive's scoped Worker secrets token (a copy of `transitive` `prd_sync`) | Workers Scripts Edit        | `sync-worker-secrets.yml`               |

## Worker secret sync

The Worker declares one secret, `SENTRY_DSN` (`apps/api/wrangler.jsonc`, `secrets.required`).
`.github/workflows/sync-worker-secrets.yml` pushes it from `codice` `prd` to Worker `codice` with
`scripts/secrets/sync-worker-secrets.mjs`, limited to the declared names, so the ingestion tokens
and the sync's own token never reach the Worker. It logs in with the corpus workflow's identity
(below) and reads `CLOUDFLARE_WORKER_SECRETS_TOKEN` from `prd`. That token is a copy of
`trstv/transitive`'s (`transitive` `prd_sync`): rotating it means updating both projects.

It runs daily, on demand (plan by default), and on `repository_dispatch` `doppler-config-changed`.
For the dispatch, the Doppler webhook on `codice` `prd` must target this repository
(`POST https://api.github.com/repos/trstv/codice/dispatches`, body
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
