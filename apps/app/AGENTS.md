# Dashboard (`apps/app`)

TanStack Start Worker (`@codice/app`, Worker `codice-app`): the Códice dashboard, where API clients
see their usage and manage their API keys. The root `AGENTS.md` applies here. It is the default
target of `apps/edge`: every path that is not the API's, the site's `/` or `/_site/*` reaches it.

- Never use `/v1`, `/mcp`, `/health`, `/ready` or `/_site/*`: the edge sends them elsewhere.
- The session cookie is `__Secure-codice-session` (`apps/edge/src/route.ts`); with it, `/` is the
  dashboard. Answer `/` without a valid session with a redirect to `/login`, and the edge serves the
  site instead.
- Sign-in, keys and usage are not built yet: the routes are a shell.
- Keep `src/routeTree.gen.ts` generated: `pnpm --filter @codice/app generate-routes`.

Commands: `pnpm --filter @codice/app dev`, `build`, `check-types`, `generate-routes`.
