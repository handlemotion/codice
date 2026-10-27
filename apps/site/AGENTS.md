# Site (`apps/site`)

TanStack Start Worker (`@codice/site`, Worker `codice-site`) for the Códice marketing site. The root
`AGENTS.md` applies here. It is reached only through the `SITE` service binding of `apps/edge` and
never owns a domain; see `apps/edge/AGENTS.md` for routing.

- Read `DESIGN.md` before changing anything visible: it records the design language (tokens,
  type, layout, the mark, the chat, copy) and what was tried and dropped. Update it in the same
  change when the design moves.
- Marketing with one live part: no sessions, database or secrets. The only API call is the chat
  (`src/ask.tsx`), which posts to `/v1/answer` on the same host; Vite proxies `/v1` to the local
  API Worker (`pnpm dev:up`) in development. Sign-in and API keys are plain links to the
  dashboard's `/login` and `/keys` on the same host.
- Everything that is not a page lives under `/_site/` so the edge can route by prefix: assets
  (`build.assetsDir`) and server functions (`serverFns.base`). Put static files in `public/_site/`.
- Keep `src/routeTree.gen.ts` generated: `pnpm --filter @codice/site generate-routes`.

Commands: `pnpm --filter @codice/site dev`, `build`, `check-types`, `generate-routes`.
