# Códice dashboard design

The dashboard (`apps/app`) speaks the site's design language: read `apps/site/DESIGN.md` first.
This file records only where the dashboard adds to it or departs from it. Values live in
`src/styles.css` (tokens) and `src/components/ui.tsx` (islands, fields, buttons).

## What it shares with the site

- The tokens (`ink`, `fg`, `muted`, `line`, `electric`), one typeface (Radio Grotesk; Supply Mono
  for keys and URLs), 14px text, 4px boxes and 2px controls.
- **Regular weight only.** No bold anywhere (titles, buttons, answers) unless the owner asks for
  it in a specific place. Hierarchy comes from size (20px titles), `muted` and position.
- Dark by default; `T` toggles and remembers (`codice-theme`, shared with the site on the same host).
- The mark (`src/brand/`, copied from the site: keep them in step), the animated favicon and the
  tooltips.
- Spanish (es-MX) copy; errors are one short sentence in `muted`, never the API's English.

## Where it departs

- **Islands.** A page's content sits on islands (`ISLAND`): white and borderless on the light
  theme's grey ground, the ground itself with a 1px `line` border on dark. The token pair is
  `island` and `edge` (`edge` is transparent by day), so "borders only at night" is one class.
  Fields and secondary buttons follow the same rule: a grey well by day, a hairline at night. Rows
  inside an island are divided by `edge`, so by day they are separated by space alone.
- **The rail.** No top bar: a 64px rail of 32px buttons with 18px line icons on the left (a bottom
  bar on phones), the page in a centered column (max 42rem). Top to bottom: the mark (to the site,
  `/?site`), then, centered, Uso, Claves, Clientes, Documentación and the avatar (Cuenta), then the theme toggle. The current
  page's icon takes the island's look; others are `muted` and brighten on hover. Each shows a
  tooltip to its right with its number key; `1`–`5` go there when no field has focus.
- **Pages.** A 20px title, then islands, each with its name and an optional `muted`
  note on the right.
- **Padding is measured to the letters, 20px on every side.** Radio Grotesk at 14px on a 20px
  line leaves 4.5px over the capitals and 5.5px under the baseline, so a one-line row (`ROW` in
  `ui.tsx`) pads 16px over and 14px under; the headline, the chart and the tabs are measured the
  same way (the reasoning sits in comments beside each). The chart's y axis numbers start at the
  side padding, like the text.
- **Groups (Uso)**: `Group` in `ui.tsx`, an island whose first row is its name, then its rows,
  divided edge to edge by `line`/60 in both themes. Islands are 24px apart, as on every page.
- **The usage chart** (`src/components/usage-chart.tsx`, after Transitive's
  `workspace-settings-usage.tsx`, drawn without a chart library): stacked daily columns (200px,
  dashed `line` grid, square bars). Each day is an equal cell with half the bar gap on either
  side, so the gaps between bars and at both ends match; a month labels every fifth day.
  Hovering a day dims the others to 40% and shows its counts beside it. Series colors are
  Transitive's (`--series-1`…`4` in `styles.css`), taken by rank. No meters: a bar reads as
  something being used up, and usage has no cap.
- **Tables** sit on their own island. The first row is both the title (in `fg`, over the names)
  and the column names (`muted` 13px, over the figures); then rows of a name and right-aligned
  figures in fixed columns (calls in `fg`, the rest `muted`). On a phone the middle column goes.
- **A headline number** (28px) takes more room than a row: 24px from the edge to its capitals,
  32px from its baseline to what follows.

## Pages

- **Uso** (`/`): 7 or 30 Mexico City days (`?dias=30`), stepped with the bordered date control
  (`?hasta=YYYY-MM-DD`). One card with tabs along its top, Claves (the team's keys) and Miembros
  (each member through their MCP clients, `?vista=miembros`): the period's total, large, with its
  change against the period before, the error rate and mean time beside it, and the chart. Under
  it, the series' table (calls, share, change) and "Operaciones" for the same scope (calls,
  errors, change), each its own island.
- **Claves** (`/keys`): a new key (shown once, with copy), the team's keys (revoke asks in place,
  no dialog), and "Conectar": the API and MCP URLs and the header to copy.
- **Clientes** (`/clients`): the MCP clients the user connected through OAuth, each disconnected
  in place, and the MCP URL to connect another.
- **Cuenta** (`/account`): profile (name editable), the team's members, the user's other teams to
  switch to, and preferences (theme, sign out).
- **Entrar** (`/login`) and **Conectar** (`/consent`): no card and no rail. One narrow column
  (24rem, sitting a little above center) on the ground: the mark (24px, no tile) 12px above the title alone, then full-width 32px
  fields and buttons. Fields and secondary buttons take the island's look (white by day, a
  hairline at night); the primary is electric. Sign-in is the email code, an "o" between two `line` rules, then the
  Google and GitHub buttons with their logos in `fg`. No subtitle or footer line.
