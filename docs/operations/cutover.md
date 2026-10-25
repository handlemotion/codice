# Cutover from `trstv/transitive`

This repository started as a copy of Transitive's `apps/codice`, `docs/sat-md`, the two shared
packages it used and the dev tooling. Production still builds, syncs secrets and refreshes the
corpus from `trstv/transitive`. This checklist moves each of those here, then removes Códice from
Transitive. Each step that touches production needs explicit approval.

What does not change: the Worker name (`codice`), its D1 database, AI Search instance, rate-limit
namespace, Sentry project (`codice-api`) and Doppler project (`codice`). Transitive's Agent binds
the Worker by name (service binding `CODICE`), so it keeps working through every step.

## Map

| Transitive                                           | Here                                         |
| ---------------------------------------------------- | -------------------------------------------- |
| `apps/codice` (`@transitive/codice-api`)             | `apps/api` (`@codice/api`)                   |
| `packages/api-contracts/src/codice`                  | `packages/contracts` (`@codice/contracts`)   |
| `successEnvelope`, `problemResponse` (api-contracts) | `packages/contracts/src/problem.ts`          |
| `packages/monitoring` (Sentry sampling, span URLs)   | `packages/monitoring` (`@codice/monitoring`) |
| `docs/sat-md`                                        | `docs/sat-md`                                |
| `.github/workflows/codice-corpus.yml`                | same path, off until step 5                  |
| `scripts/worker-dev.mjs` and the dev stack scripts   | Códice-only copies in `scripts/`             |

## Steps

1. **Repository settings** (apps done: the Cloudflare Workers app reads this repository and the
   Claude app pushes to it; the `main` ruleset is for a repository admin). Ruleset on `main`: pull request required, squash merge, required check
   `Checks` (`ci.yml`). Install the Cloudflare Workers and Claude GitHub apps on `trstv/codice`.
2. **Freeze and sync** (done 2026-10-25: `trstv/codice#3` ports `trstv/transitive#2764`; Transitive's
   `apps/codice/AGENTS.md` marks it frozen). Stop Códice changes in Transitive. Compare Transitive's `apps/codice` and
   `docs/sat-md` with `apps/api` and `docs/sat-md` here (only the package names and paths may
   differ) and port anything that landed since the copy.
3. **Move the Git build** (done 2026-10-25: triggers "codice production (trstv/codice main)" and
   "codice previews (trstv/codice branches)"; the Transitive trigger is deleted, and
   `trstv/transitive#2768` drops its watch paths; `SENTRY_AUTH_TOKEN` comes from Doppler `codice` `prd`). On the `codice` Worker's build settings: repository `trstv/codice`,
   production branch `main`, root directory `apps/api`, deploy command
   `pnpm run deploy:production`, non-production branches `pnpm exec wrangler versions upload`,
   build variables `SENTRY_ORG` = `jaantonio` and `SENTRY_AUTH_TOKEN`. Watch paths: include
   `apps/api/*`, `packages/*` and the root install inputs (`package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`); exclude `*.md` and test files. Remove `codice` from Transitive's
   `scripts/workers-build-watch-paths.mjs` in the same change.
4. **First deploy from here** (done 2026-10-25: a manual build of `main` `5e3a430` deployed version
   `a6945917`, migrations step ran with none pending, source maps uploaded; that release is named
   `main`, the next merge names it by commit). Merge a PR here and check `cf builds list`,
   `cf workers versions list` and `cf workers deployments list` for `codice`, that the D1
   migrations step ran, and that the Sentry release for the commit has source maps.
5. **Corpus workflow** (done 2026-10-25: identity `trstv-codice-main` pinned in
   `codice-corpus.yml`, schedule on, Transitive's copy deleted in `trstv/transitive#2769`). Create
   the Doppler identity (`docs/operations/doppler-secrets.md`), pin its ID in `codice-corpus.yml`,
   uncomment the schedule, and delete Transitive's `codice-corpus.yml` in the same window, so only
   one repository ingests and opens refresh PRs.
6. **Secret sync** (done 2026-10-25: `sync-worker-secrets.yml` here, with the corpus identity and a
   copy of Transitive's Worker secrets token in `codice` `prd`; Transitive's script drops `codice`).
   Left: point the Doppler webhook on `codice` `prd` at this repository's dispatches
   (`docs/operations/doppler-secrets.md`, "Worker secret sync").
7. **Remove Códice from Transitive.** `apps/codice`; the `codice` entries in `tsconfig.json`,
   `.github/workflows/ci.yml` (build filter), `scripts/dev.mjs`, `scripts/dev-up.mjs`,
   `scripts/dev-restart.mjs`, `scripts/worker-dev.mjs`, `scripts/portless-run.mjs`,
   `scripts/lib/dev-stack-probes.mjs`, `scripts/lib/codice-local-records.mjs`,
   `scripts/check-legacy-analytics-identifiers.mjs` and their tests; the Códice sections of
   `docs/development/local-development.md` and `docs/operations/doppler-secrets.md`; and the row in
   its `AGENTS.md`. Keep `@transitive/api-contracts/codice` while the Agent calls the binding (it
   mirrors `@codice/contracts`). Decide whether `docs/sat-md` stays in Transitive as reference for
   its agents or is read from here.
