# Contributing to Códice

Thanks for helping. Códice is a searchable index of Mexican tax (SAT) and customs rules, served over
HTTP and MCP from Cloudflare Workers.

## Before you start

- Read [`AGENTS.md`](AGENTS.md): the repository's rules for layout, commands, tests, generated
  files and the database. Each app's own `AGENTS.md` extends it.
- For a larger change, open an issue first so we can agree on the approach.
- Fiscal rules come from the SAT's own text in [`docs/sat-md/`](docs/sat-md/README.md). Cite the
  source for any rule you add or change.

## Setup

Node 24 (`.nvmrc`) and pnpm at the version in `package.json`:

```sh
pnpm install
pnpm check && pnpm check-types && pnpm test
```

These need no secrets. Running the API Worker locally (`pnpm dev:up`) needs the maintainers'
Doppler and Cloudflare access; the dashboard (`pnpm --filter @codice/app dev`) and the site
(`pnpm --filter @codice/site dev`) run without them (see
[`docs/development/local-development.md`](docs/development/local-development.md)).

## Pull requests

- Target `main`. The `Checks` job of `.github/workflows/ci.yml` must pass.
- Add or update the test that proves the change.
- Never commit secrets, `.env` files or tokens.
- By contributing you agree that your contribution is licensed under the
  [AGPL-3.0](LICENSE), the license of this repository.
