# Site (`apps/site`)

TanStack Start Worker (`@codice/site`, Worker `codice-site`) for the Códice marketing site. The root
`AGENTS.md` applies here. It is reached only through the `SITE` service binding of `apps/edge` and
never owns a domain; see `apps/edge/AGENTS.md` for routing.

- Static marketing: no sessions, database, secrets or server-side API calls. Sign-in and API keys
  are plain links to the dashboard's `/login` and `/keys` on the same host.
- The demo chat (`src/components/demo-chat.tsx`) runs in the browser and posts to the API's
  `POST /v1/chat` on the same host (`apps/api/SPEC.md`, "Chat"). Its components in
  `src/components/chat/` are adapted from Transitive's `@transitive/ui` chat components. In
  `vite dev`, a proxy sends `/v1` to the local API (`CODICE_API_ORIGIN`, default the Portless URL).
- Everything that is not a page lives under `/_site/` so the edge can route by prefix: assets
  (`build.assetsDir`) and server functions (`serverFns.base`). Put static files in `public/_site/`.
- Keep `src/routeTree.gen.ts` generated: `pnpm --filter @codice/site generate-routes`.

Commands: `pnpm --filter @codice/site dev`, `build`, `check-types`, `generate-routes`.
