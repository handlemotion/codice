# Site (`apps/site`)

TanStack Start Worker (`@codice/site`, Worker `codice-site`) for the Códice marketing site. The root
`AGENTS.md` applies here. It is reached only through the `SITE` service binding of `apps/edge` and
never owns a domain; see `apps/edge/AGENTS.md` for routing.

- Marketing: no sessions or database. Sign-in and API keys are plain links to the dashboard's
  `/login` and `/keys` on the same host.
- The demo chat (`src/components/demo-chat.tsx`) runs in the browser and posts to the site's own
  `POST /_site/chat` (`src/routes/[_site]/chat.ts`), which forwards the turn to the API's
  `POST /v1/chat` over the `API` service binding with the site's key, `CODICE_SITE_API_KEY` (its one
  secret), and the visitor's `cf-connecting-ip` (`apps/api/SPEC.md`, "Chat"). Never send the key to
  the browser. Its components in `src/components/chat/` are adapted from Transitive's
  `@transitive/ui` chat components. Locally, put the key in `apps/site/.env` (git-ignored) and run
  the API (`pnpm dev:up`) and the dashboard, which verifies the key.
- Everything that is not a page lives under `/_site/` so the edge can route by prefix: assets
  (`build.assetsDir`) and server functions (`serverFns.base`). Put static files in `public/_site/`.
- Keep `src/routeTree.gen.ts` generated: `pnpm --filter @codice/site generate-routes`.

Commands: `pnpm --filter @codice/site dev`, `build`, `check-types`, `generate-routes`.
