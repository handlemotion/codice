# Doppler secrets

Códice has its own Doppler project, `codice`, with the root configs `dev`, `stg` and `prd`. Each
holds Cloudflare account tokens for the AI Search instance and the D1 database `codice`:

| Config | Secret                   | Cloudflare token       | Permissions                 | Used by                                 |
| ------ | ------------------------ | ---------------------- | --------------------------- | --------------------------------------- |
| `dev`  | `CODICE_AI_SEARCH_TOKEN` | `codice-ai-search-dev` | AI Search Run, Read         | `dev`, `eval` (cannot change the index) |
| `prd`  | `CODICE_AI_SEARCH_TOKEN` | `codice-ai-search`     | AI Search Write (Edit), Run | `ingest`                                |
| `prd`  | `CODICE_D1_TOKEN`        | `codice-d1`            | D1 Edit                     | `ingest` (`wrangler d1 execute`)        |
| `prd`  | `SENTRY_DSN`             | –                      | –                           | Worker `codice`                         |

## Worker secrets

The Worker declares one secret, `SENTRY_DSN` (`apps/api/wrangler.jsonc`, `secrets.required`).
Until cutover, `trstv/transitive`'s `sync-worker-secrets.yml` pushes it from `codice` `prd` to
Worker `codice`, limited to that name, so the ingestion tokens never reach the Worker. The sync is
keyed by Worker name, not repository, so it keeps working after cutover; moving it here is a
cutover step (`docs/operations/cutover.md`).

## Corpus workflow identity

`.github/workflows/codice-corpus.yml` exchanges its GitHub OIDC token for a short-lived Doppler
token, so GitHub holds no long-lived Doppler secret. It is off until cutover. One-time setup
(Doppler dashboard, workplace owner):

1. On the service account `codice-corpus` (read access to `codice` `dev` and `prd`), add a GitHub
   identity for this repository: issuer `https://token.actions.githubusercontent.com`, audience
   `https://github.com/trstv`, subject `repo:trstv@<org id>/codice@<repo id>:ref:refs/heads/main`.
2. Put its ID in the repository variable `CODICE_CORPUS_DOPPLER_IDENTITY_ID` (an ID, not a secret).

GitHub writes the subject with the organization's and repository's numeric IDs, and Doppler
compares it exactly: an identity set to the plain `repo:trstv/codice:…` form fails with
`claim "sub" does not match identity auth config`. The login step prints the subject it sent
(`oidc sub=…`). The subject admits only runs on `main`, so a run from any other branch cannot read
the production tokens.
