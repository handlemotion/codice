# Edge (`apps/edge`)

Router Worker (`@codice/edge`, Worker `codice-edge`) for the public `codice.io` host. The root
`AGENTS.md` applies here. It owns no business logic, data access, or auth: it picks a target and
forwards the unmodified request through a service binding.

## Routing

- `API` (`codice-api`, `apps/api`) gets `/v1`, `/mcp`, their subpaths,
  `/.well-known/oauth-protected-resource` (`/mcp`'s OAuth metadata) and its subpaths, `/health` and
  `/ready`, for any method, signed in or not, whatever `SITE_ENABLED` says.
- `SITE` (`codice-site`, `apps/site`) gets `/` for anonymous `GET`/`HEAD`, `/?site`, `/_site/*`,
  and its pages (`SITE_PAGE_PREFIXES`: `/docs` and its subpaths) for `GET`/`HEAD`, signed in or
  not.
- A stale-cookie `/` that the app answers with a redirect to `/login` is served by the site
  (`isLoginRedirect`).
- `APP` (`codice-app`, `apps/app`, the dashboard) gets everything else, including `/` when the
  `__Secure-codice-session` cookie is present, Better Auth's `/api/auth/*`, which sets it, and the
  OAuth pages and metadata MCP clients reach: `/consent` and
  `/.well-known/oauth-authorization-server/api/auth`.
- A new site page needs its own prefix in `SITE_PAGE_PREFIXES` that the dashboard never uses.
  Prefer few pages.
- `SITE_ENABLED` must be exactly `"true"` to route to the site; any other value sends every
  non-API request to the app.

## Domains

This Worker will own `codice.io` as a custom domain. The zone is not in the Handle account yet, so
`wrangler.jsonc` has no `routes`: a custom domain on a missing zone fails the deploy. Once the zone
exists, a PR adds `"routes": [{ "pattern": "codice.io", "custom_domain": true }]` here and
`dashboard.codice.io` to `apps/app`. No other Worker may list `codice.io` in its `routes`: a Worker
that declares a custom domain re-claims it on its next deploy.

## Commands

```sh
pnpm --filter @codice/edge test
pnpm --filter @codice/edge check-types
pnpm --filter @codice/edge build   # wrangler deploy --dry-run
```
