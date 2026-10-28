# Códice dashboard design

The dashboard (`apps/app`) speaks the site's design language: read `apps/site/DESIGN.md` first.
This file records only where the dashboard adds to it or departs from it. Values live in
`src/styles.css` (tokens) and `src/components/ui.tsx` (islands, fields, buttons).

## What it shares with the site

- The tokens (`ink`, `fg`, `muted`, `line`, `electric`), one typeface (Radio Grotesk; Supply Mono
  for keys and URLs), 14px text, hierarchy by weight, 4px boxes and 2px controls.
- Dark by default; `T` toggles and remembers (`codice-theme`, shared with the site on the same host).
- The mark (`src/brand/`, copied from the site: keep them in step), the animated favicon, the
  tooltips, and the chat's pieces (`src/components/chat/`, the turning marks, the electric bubble,
  the streamed answer).
- Spanish (es-MX) copy; errors are one short sentence in `muted`, never the API's English.

## Where it departs

- **Islands.** A page's content sits on islands (`ISLAND`): white and borderless on the light
  theme's grey ground, the ground itself with a 1px `line` border on dark. The token pair is
  `island` and `edge` (`edge` is transparent by day), so "borders only at night" is one class.
  Fields and secondary buttons follow the same rule: a grey well by day, a hairline at night. Rows
  inside an island are divided by `edge`, so by day they are separated by space alone.
- **The rail.** No top bar: a 64px rail of line icons on the left (a bottom bar on phones), the
  page in a centered column (max 42rem). Top to bottom: the mark (to the site, `/?site`), then,
  centered, Chat, Claves, Clientes, Documentación and the avatar (Cuenta), then the theme toggle. The current
  page's icon takes the island's look; others are `muted` and brighten on hover. Each shows a
  tooltip to its right with its number key; `1`–`5` go there when no field has focus.
- **Pages.** A 20px bold title, then islands, each with its name in bold and an optional `muted`
  note on the right. The chat has no islands but its composer: the thread runs on the ground.

## Pages

- **Chat** (`/`): a full conversation (up to the API's 24 messages), nothing stored. Empty, it
  offers four questions as raw `muted` text above the composer. Enter sends, Shift+Enter breaks
  the line, `/` focuses it; "Nueva conversación" starts over.
- **Claves** (`/keys`): a new key (shown once, with copy), the team's keys (revoke asks in place,
  no dialog), and "Conectar": the API and MCP URLs and the header to copy.
- **Clientes** (`/clients`): the MCP clients connected to the team through OAuth, each
  disconnected in place, and the MCP URL to connect another. The data is a stub
  (`listClients`, `disconnectClient` in `src/server/functions.ts`) until MCP OAuth lands.
- **Cuenta** (`/account`): profile (name editable), the team's members, the user's other teams to
  switch to, and preferences (theme, sign out).
- **Entrar** (`/login`): the mark and one island with the email code and the social buttons.
