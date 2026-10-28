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
  `/?site`), then, centered, Uso, Claves, Clientes, Documentación, Equipo and the avatar (Cuenta),
  then the theme toggle. An electric dot on the avatar means invitations wait on Cuenta. The current
  page's icon takes the island's look; others are `muted` and brighten on hover. Each shows a
  tooltip to its right with its number key; `1`–`6` go there when no field has focus.
- **Pages.** A 20px title, then islands, each with its name and an optional `muted`
  note on the right.
- **People, after Transitive's members settings** (`trstv/transitive`,
  `components/settings/organization-members-settings-section.tsx`): a row per person with their
  photo or initial in a hairline circle (dashed while only invited), the name with a `muted`
  "(tú)", the email under it, and the role as a small squared label in a `fg`/8 well. Without a
  name, the email's local part in words ("maria.lopez@" reads "Maria Lopez"). Adding is a row of
  its own, a plus and the action ("Invitar a alguien"), first in the list. Transitive's dialogs
  and "⋯" menus become in-place rows here: the add row turns into the form, "Editar" turns the
  role label into a select with "Quitar", and every removal asks in place.
- **Usage, after Transitive's settings usage** (`trstv/transitive`,
  `components/settings/workspace-settings-usage.tsx`), drawn without a chart library
  (`src/components/usage-chart.tsx`): a week of stacked daily columns (220px, a 32px y axis,
  dashed `line` grid, square bars, a hovered day lit in `fg`/5 with its tooltip beside it), then
  in the same island one row per series (a 2px-rounded color square, its name, a `muted` hint,
  its calls on the right). Series colors are Transitive's (`--series-1`…`4` in `styles.css`): the
  saturated pair by day, the softer one at night, taken by rank. Meters are a 6px round bar on
  `fg`/10 in `--series-1`.

## Pages

- **Uso** (`/`): a week (Mexico City days) ending today, stepped with the chevrons by the title
  (`?hasta=YYYY-MM-DD`): the totals (calls, error rate, mean time), the "Solicitudes" chart of the
  team's keys and the user's MCP clients with their rows (each key's hint names its creator), or,
  with "Por persona" in the island's note (`?por=personas`), the same calls by the person behind
  them, and "Operaciones", a meter per
  operation against the busiest.
- **Claves** (`/keys`): a new key (shown once, with copy), the team's keys with who created each
  ("Tuya", or "De Ana"; revoke asks in place, no dialog, and shows only where the user may), and "Conectar": the API and MCP URLs and the header to copy.
- **Clientes** (`/clients`): the MCP clients the user connected through OAuth, each disconnected
  in place, and the MCP URL to connect another.
- **Equipo** (`/team`): the active team's settings. "General" (its name, editable by owners and
  admins; the user's role as the note), "Miembros" (invite, then each person with their role),
  "Invitaciones" (open ones, revoked in place) and, for a team that is not personal, leaving it.
- **Cuenta** (`/account`): the user's own: profile (name editable), invitations waiting for them
  (join or decline), their teams with their role in each (switch, or create one), and
  preferences (theme, sign out).
- **Invitación** (`/invitacion/$id`): like Conectar, one narrow column: "Únete a {team}", who
  invited and as what, then Rechazar and Unirme. One no longer open says so and offers another
  email.
- **Entrar** (`/login`) and **Conectar** (`/consent`): no card and no rail. One narrow column
  (24rem, sitting a little above center) on the ground: the mark (24px, no tile) 12px above the title alone, then full-width 32px
  fields and buttons. Fields and secondary buttons take the island's look (white by day, a
  hairline at night); the primary is electric. Sign-in is the email code, an "o" between two `line` rules, then the
  Google and GitHub buttons with their logos in `fg`. No subtitle or footer line.
