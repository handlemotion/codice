# Local development

## Setup

1. Node 24 (`.nvmrc`) and pnpm at the version in `package.json` (`packageManager`).
2. `pnpm install`. It also installs the `lefthook` pre-commit hook.
3. Doppler CLI with access to project `codice` config `dev` (`doppler login`, or `DOPPLER_TOKEN`
   in cloud sessions and CI).
4. Wrangler's Cloudflare auth for the remote AI Search binding (see "Cloudflare auth" below).

## Host names

Códice is served on `https://codice.localhost` (linked worktrees prepend their branch slug), on
Portless's default `.localhost` TLD: browsers and `curl` resolve it to `127.0.0.1` with no DNS or
purchase. The proxy is shared with Transitive's dev stack, so `dev:proxy:start` serves both
`localhost` (first, Códice's URLs) and `transitive.app` (Transitive's). A proxy already running
with only `transitive.app` keeps giving Códice `codice.transitive.app` names: restart it once with
`pnpm dev:proxy:stop` and `pnpm dev:proxy:start`.

## Start, reuse, restart

- `pnpm dev:up` reuses this checkout's running dev run or starts `pnpm dev` detached (log:
  `.local/dev-stack.log`), waits until `/ready` answers 200, then applies pending local D1
  migrations. It prints the dev run's pid; stop it with `kill -TERM -<pid>`.
- `pnpm dev` runs in the foreground: it starts the portless HTTPS proxy
  (`pnpm dev:proxy:start`), then
  `@codice/api` `dev`: `openlogs` → `portless` → `doppler run -p codice -c dev` →
  `scripts/worker-dev.mjs` → `wrangler dev`. It holds a per-checkout lock, so a second run never
  starts beside it.
- `pnpm dev:restart` restarts the runtime and waits until it answers again. It signals the
  supervisor recorded in `.local/dev-runtime/api.json` (SIGUSR2): the supervisor stops the
  runtime's process tree (SIGTERM, SIGKILL after five seconds), applies pending D1 migrations,
  seeds the records if the local D1 is empty, and starts it again on the same Portless route.

`scripts/worker-dev.mjs` supervises `wrangler dev` in its own process group:

- A runtime that had been up for at least 30 seconds and then exits is started again. One that
  exits within 30 seconds of starting failed to start; that ends the dev run.
- A runtime whose process tree stays above 2048 MiB RSS for three samples is recycled.
  `CODICE_DEV_MAX_RSS_MB` changes the limit; `0` turns the guard off.
- When `pnpm install` changes `node_modules`, the runtime restarts once the install has settled.

Restart the runtime instead of killing its wrapper processes (`doppler`, `portless`, `openlogs`):
those exit with their child, and turbo then stops the whole run.

In a Conductor workspace (`CONDUCTOR_PORT`), Códice gets port `CONDUCTOR_PORT + 1`.

## Códice

`pnpm dev` starts Códice (`apps/api`) on `https://codice.localhost` under Doppler
`codice` `dev`. Its D1 is local; its AI Search binding `CODICE_SEARCH` is `"remote": true`, so
every local search is a real, billed query to the instance `codice`.

- **Records**: each runtime start applies the local migrations, then runs
  `pnpm --filter @codice/api ingest --local` when the local D1 has no error codes. The line
  `codice D1 CODICE_DATABASE: seeded local records (...)` or `... local records present` is in
  `.openlogs/codice/latest.txt`. After a corpus change, run `ingest --local` again; it replaces
  every local record. The seed leaves out the large catalogs (`c_CodigoPostal`, `c_Colonia`, …);
  load them with `ingest --local --catalogs` (about 3 minutes, needs LibreOffice `soffice`).
- **Cloudflare auth**: Wrangler opens a remote preview session for the binding
  (`/accounts/<id>/workers/subdomain/edge-preview`), so it needs `wrangler login` or a
  `CLOUDFLARE_API_TOKEN` with at least Account › Workers Scripts: Edit on the Handle account.
  The Doppler `dev` token `CODICE_AI_SEARCH_TOKEN` (AI Search Run and Read) cannot open that
  session; it is for `eval` only.
- **`SENTRY_DSN`**: `secrets.required` does not block `wrangler dev`, and Sentry stays off without
  `SENTRY_RELEASE`, so no placeholder is needed.

- **API keys**: `/v1` and `/mcp` need a key, verified by the dashboard's `CodiceAccounts` over
  the `ACCOUNTS` service binding, which Wrangler connects to a local dashboard through its dev
  registry. The API's runtime keeps that registry in this checkout's `.wrangler/registry`
  (`scripts/worker-dev.mjs`, `WRANGLER_REGISTRY_PATH`); the dashboard and the site run Vite, which
  reads `MINIFLARE_REGISTRY_PATH` instead, so their `dev` scripts set it to the same directory. Run the dashboard beside it (`pnpm --filter @codice/app dev`, with `apps/app/.env` as
  in `apps/app/AGENTS.md`), apply its migrations once
  (`pnpm --filter @codice/app db:migrate:local`), sign in at `http://localhost:5173/login` with
  any email (the code is printed in the dashboard's output) and create a key at `/keys`. Without
  the dashboard, every keyed call fails with a `500`.

Check it with real calls (`KEY` is that key):

```sh
curl https://codice.localhost/ready
curl -H "authorization: Bearer $KEY" 'https://codice.localhost/v1/search?q=CFDI40149'
curl -H "authorization: Bearer $KEY" https://codice.localhost/v1/errors/CFDI40149
curl -H "x-api-key: $KEY" https://codice.localhost/v1/catalogs/c_UsoCFDI/S01
curl https://codice.localhost/mcp -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"q":"CFDI40149"}}}'
```

## Troubleshooting

- **`Exec format error (os error 8)` from turbo**: pnpm self-installed its `packageManager`
  version without its native binary. `bash scripts/ensure-pnpm-native.sh` puts it in place (the
  cloud SessionStart hook runs it).
- **A proxy answers `502` for `*.localhost`**: exempt the host from the egress proxy
  (`NO_PROXY=.localhost`, or `curl --noproxy '*'`).
