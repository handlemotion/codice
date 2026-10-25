# Códice

A searchable index of Mexican tax (SAT) and customs rules, served over HTTP and MCP from a
Cloudflare Worker. Every answer quotes the regulator's text verbatim with its source and validity
dates.

- Behavior and API: [`apps/api/SPEC.md`](apps/api/SPEC.md)
- Agent and contributor rules: [`AGENTS.md`](AGENTS.md)
- Local development: [`docs/development/local-development.md`](docs/development/local-development.md)
- Moving production here from `trstv/transitive`: [`docs/operations/cutover.md`](docs/operations/cutover.md)

## Quick start

Requires Node 24 (`.nvmrc`), pnpm (the version in `package.json`), the Doppler CLI with access to
project `codice`, and Wrangler's Cloudflare auth for the remote AI Search binding.

```sh
pnpm install
pnpm dev:up          # Códice on https://codice.local.transitive.app
pnpm check && pnpm check-types && pnpm test
```
