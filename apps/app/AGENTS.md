# Dashboard (`apps/app`)

TanStack Start Worker (`@codice/app`, Worker `codice-app`): the Códice dashboard, where API clients
see their usage and manage their API keys. The root `AGENTS.md` applies here. It is the default
target of `apps/edge`: every path that is not the API's, the site's `/` or `/_site/*` reaches it.

- Read `DESIGN.md` before changing anything visible; it extends `apps/site/DESIGN.md`.
- Pages: usage (`/`), the team's keys (`/keys`), the user's MCP clients (`/clients`) and the account (`/account`), under a left rail
  (`src/components/dashboard-shell.tsx`).
- Never use `/v1`, `/mcp`, `/health`, `/ready` or `/_site/*`: the edge sends them elsewhere.
- The session cookie is `__Secure-codice-session` (`apps/edge/src/route.ts`); with it, `/` is the
  dashboard. Answer `/` without a valid session with a redirect to `/login`, and the edge serves the
  site instead. Every signed-in page sits under the pathless `_dashboard` route, which redirects.
- Auth is Better Auth (`src/server/auth.ts`) at `/api/auth/*`: email code (Cloudflare Email Sending,
  binding `EMAIL`), Google and GitHub; users, sessions and teams (the `organization` plugin) in D1
  `codice-accounts` (`ACCOUNTS_DATABASE`). A new user gets a personal team; only a team's owner
  manages its keys.
- API keys (`@better-auth/api-key`): owned by the team, prefix `cdc_`, stored hashed in KV only
  (`API_KEYS`, `src/server/api-key-store.ts`), with Better Auth's own per-key rate limit off.
  `codice-api` verifies them through the `CodiceAccounts` entrypoint (`src/server.ts`), which reads
  only KV: keep D1 off that path. Its contract is `CodiceAccountsService` in `@codice/contracts`
  (`apps/api/SPEC.md`, "Auth"). The KV record layout is the plugin's; `test/auth.test.ts` proves
  a plugin-made key verifies, so run it after a Better Auth upgrade.
- MCP OAuth (`apps/api/SPEC.md`, "MCP authorization"): this Worker is the authorization server
  for `/mcp`, with `mcp()`, `cimd()` and `jwt()` in `src/server/auth.ts`. `/login` resumes an
  authorization after sign-in and `/consent` approves a client; both are entered by a full-page
  redirect from `/api/auth/oauth2/authorize`. `src/server.ts` hands
  `/.well-known/oauth-authorization-server/*` to Better Auth. `CodiceAccounts.verifyAccessToken`
  (`src/server/access-tokens.ts`) verifies an MCP access token for `codice-api`: it reads the
  signing keys from D1 once per isolate, then only KV, so keep further D1 reads off it.
  Connected clients and disconnecting them: `src/server/connected-clients.ts`, with server
  functions in `src/server/oauth-functions.ts`. `test/auth.test.ts` runs the whole flow; run it
  after a Better Auth upgrade.
- Pages read and change data through server functions (`src/server/functions.ts`) that call
  Better Auth's server API with the request's cookies; the sign-in page uses the browser client.
- D1 schema: `src/db/schema.ts`, Better Auth's tables as `npx auth@<version> generate` writes them,
  and `src/db/usage.ts`, the dashboard's own. Then `db:generate`; never hand-write `migrations/`. `deploy:production` applies them remotely.
- Secrets (`secrets.required`, synced from Doppler `codice` `prd`): `BETTER_AUTH_SECRET`,
  `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
  `socialProviders` in `src/server/auth.ts` turns Google and GitHub sign-in on, and shows each
  button on `/login`, only when both its client id and secret are set. Vars:
  `BETTER_AUTH_URL` (the public origin), `AUTH_EMAIL_FROM`. Locally, put them in `apps/app/.env`
  (git-ignored) with `BETTER_AUTH_URL=http://localhost:5173`; the local `EMAIL` binding prints
  each code to the dev server's output instead of sending it.
- Usage (`apps/api/SPEC.md`, "Usage"): `codice-api` reports each answered `/v1` call and MCP
  tool call to `CodiceAccounts.recordUsage`, which adds it to the day's counters in `api_usage`
  (`src/db/usage.ts`, Mexico City days, per credential, surface and operation). The Uso page (`/`)
  reads a week through `getUsage` (`src/server/usage.ts`): the active team's keys and the user's
  own MCP clients. Run `test/auth.test.ts` after changing either side.
- Keep `src/routeTree.gen.ts` generated: `pnpm --filter @codice/app generate-routes`.

Commands: `pnpm --filter @codice/app dev`, `build`, `test`, `check-types`, `generate-routes`,
`db:generate`, `db:migrate:local`.
