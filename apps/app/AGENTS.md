# Dashboard (`apps/app`)

TanStack Start Worker (`@codice/app`, Worker `codice-app`): the Códice dashboard, where API clients
see their usage and manage their API keys. The root `AGENTS.md` applies here. It is the default
target of `apps/edge`: every path that is not the API's, the site's `/` or `/_site/*` reaches it.

- Read `DESIGN.md` before changing anything visible; it extends `apps/site/DESIGN.md`.
- Pages: the chat (`/`), the team's keys (`/keys`) and the account (`/account`), under a left rail
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
- Pages read and change data through server functions (`src/server/functions.ts`) that call
  Better Auth's server API with the request's cookies; the sign-in page uses the browser client.
- D1 schema: `src/db/schema.ts`, Better Auth's tables as `npx auth@<version> generate` writes them.
  Then `db:generate`; never hand-write `migrations/`. `deploy:production` applies them remotely.
- Secrets (`secrets.required`, synced from Doppler `codice` `prd`): `BETTER_AUTH_SECRET`. Google
  and GitHub sign-in are optional (`socialProviders` in `src/server/auth.ts`): each turns on, and
  its button shows on `/login`, once both its client id and secret are set. To turn them on, add
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to
  Doppler `prd` and to `secrets.required`, so the sync pushes them. Vars:
  `BETTER_AUTH_URL` (the public origin), `AUTH_EMAIL_FROM`. Locally, put them in `apps/app/.env`
  (git-ignored) with `BETTER_AUTH_URL=http://localhost:5173`; the local `EMAIL` binding prints
  each code to the dev server's output instead of sending it.
- The chat (`src/chat.tsx`) posts to `POST /api/chat` (`src/routes/api/chat.ts`), which refuses
  without a session and forwards the turn to the API's `POST /v1/chat` over the `API` service
  binding with the dashboard's own key, `CODICE_APP_API_KEY`, and the visitor's
  `cf-connecting-ip`, as the site does with its key. Optional: without it the chat answers
  `503 chat_unavailable`. To turn it on, create a key for a Códice team, add it to Doppler `prd`
  and to `secrets.required`; locally, put it in `apps/app/.env` and run the API (`pnpm dev:up`).
- Keep `src/routeTree.gen.ts` generated: `pnpm --filter @codice/app generate-routes`.

Commands: `pnpm --filter @codice/app dev`, `build`, `test`, `check-types`, `generate-routes`,
`db:generate`, `db:migrate:local`.
