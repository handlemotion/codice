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
pnpm dev:up          # Códice on https://codice.localhost
pnpm check && pnpm check-types && pnpm test
```

Contributors without access to Doppler or the Cloudflare account can still run `pnpm install`,
`pnpm check`, `pnpm check-types` and `pnpm test`: the tests use a local D1 and a local AI Search
binding. Only `pnpm dev:up` and the eval need the secrets.

## Contributing and security

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities
privately as described in [`SECURITY.md`](SECURITY.md), not in a public issue.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network
service, you must offer its source to the users of that service.
