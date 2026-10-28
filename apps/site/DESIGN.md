# Códice site design

The design language of the marketing site (`apps/site`), recorded from what ships so the next
change keeps it. Read it before you touch a page. The code is the source of truth for values:
tokens in `src/styles.css`, the mark in `src/brand/`, the chat in `src/ask.tsx`, the page in
`src/routes/index.tsx`. When this file and the code disagree, fix whichever is wrong in the same
change.

## The idea

A quiet, ruled sheet with one living thing on it. The brand is three basic shapes (circle, square,
triangle) drawn as a single line that morphs between them. Everything else stays out of the way:
one typeface, two inks, hairlines, very little rounding. The page talks with design, not with
explanatory text.

## Principles

1. **Minimal first.** When a change adds a surface, a color, a size or a sentence, it must remove
   something or earn its place. Most requests that "lose the minimalism" added structure.
2. **Show, don't explain.** No UI instructions in body copy ("press / to…"). Affordances live in
   the component: ghost suggestions and key caps.
3. **One of each.** One typeface, one accent color, one primary action per place, one chat
   exchange.
4. **Lines, not surfaces.** Separation comes from hairlines and space, never from a raised grey
   panel, a shadow or a dimmed block.
5. **The mark is the only ornament.** No icons in tinted squares, gradients, badges or
   illustrations. The shapes appear as the logo, the background, the footer band and the
   "thinking" indicator.

## Tokens

All in `src/styles.css`. Reference tokens in classes (`bg-ink`, `text-fg`, `border-line`,
`text-muted`, `bg-electric`); never hard-code a color in a component.

| Token      | Dark (default) | Light     | Use                                                                                    |
| ---------- | -------------- | --------- | -------------------------------------------------------------------------------------- |
| `ink`      | `#0a0a0b`      | `#e8e8e8` | The ground. Pitch black at night, paper grey by day. Also the text on a filled button. |
| `fg`       | `#ededef`      | `#0a0a0b` | All running text, headings, the mark.                                                  |
| `muted`    | `#7c7c84`      | `#5f5f66` | Secondary notes only: ghost text, citations, footer. Never body copy.                  |
| `line`     | `#2a2a2e`      | `#c9c9c9` | Hairlines, outlined buttons, the hero's background mark.                               |
| `electric` | `#2346ff`      | `#2346ff` | The one accent: primary button, the visitor's chat bubble, text selection.             |

- Muted text must hold 4.5:1 on `ink` in both themes (checked at `#5f5f66` on `#e8e8e8`).
- Selection is `electric` with white text in both themes.
- There is no "raised" surface. A box that must sit over the background mark gets `bg-ink`, the
  same as the page, so the mark's lines stop at its edge.

### Type

- **Text:** PP Radio Grotesk (Pangram Pangram), Regular 400 and Bold 700, self-hosted in
  `public/_site/fonts/` and preloaded in `__root.tsx` (being tried; it replaced PP Supply Mono).
  **Code:** PP Supply Mono, for code islands only. Both licensed by Handlemotion.
- **Sizes:** 14px body, line height 1.7. 20px for the one hero title. 12px for code islands and
  compact buttons; 11px for key caps. Hierarchy comes from weight and position, not size.
- Radio Grotesk sits high in its line box: buttons and key caps use
  `text-box: trim-both cap alphabetic` (`styles.css`) so labels center in their padding.
- No uppercase, no letter-spacing changes, no italics.

### Radius and borders

- 4px on boxes (code islands, the composer, the chat bubble, the favicon tile). 2px on buttons and
  key caps. Nothing rounder.
- Borders are always 1px `line`. The mark's strokes are 1–1.5px with `vector-effect:
non-scaling-stroke`, so a huge mark still draws a hairline.

## Themes

- Dark is the default for everyone, whatever the system prefers.
- The `T` key toggles and remembers (`localStorage` key `codice-theme`, `data-theme` on `<html>`),
  set before first paint by `THEME_SCRIPT` in `src/theme.ts`. It is not advertised on the page.
- **Favicon:** dark keeps the original near-black tile with an off-white line; light is an
  electric-blue tile with a white line. It animates on the same clock as the page's marks and
  follows the theme (`faviconSvg` in `src/brand/shapes.ts`). The static `favicon.svg` (shown
  with reduced motion) is the dark tile.

## The mark

`<Mark />` in `src/brand/mark.tsx`, geometry in `src/brand/shapes.ts`.

- One closed line of 120 points, sampled by angle, morphing circle → square → triangle → circle.
  Each step turns 90° clockwise and rests upright.
- **Timing:** hold 1100ms, morph 900ms. The outline eases on `cubic-bezier(0.76, 0, 0.24, 1)`;
  the turn on `cubic-bezier(0.6, 0, 0.2, 1.18)`, a small overshoot so it settles.
- **Posterized at 12fps** on one shared clock: every mark on the page and the favicon step
  together. Keep new motion on this beat (`1000 / 12` ms).
- **Props:** `animate` (false rests on a whole shape), `radius` (8 leaves a margin in its 24-unit
  box, 10–11 nearly fills it), `step` (shapes ahead on the clock, so marks side by side show a
  circle, a square and a triangle at once).
- Reduced motion: marks rest; nothing morphs.

`<MarkField />` fills a box with whole columns and rows of cells (about 180px), stretched a little
to fit exactly, so no mark is cropped and the edges match the gaps. Each mark's radius is 0.45 of
its cell, so neighbouring triangles keep a small gap. Every
diagonal runs 120ms behind the one above-left of it, so the morph rolls from the top-left corner
to the bottom-right like a wave. One SVG and one clock for the whole field.

Where it appears: the hero background (the field, in `text-line`), the
footer band (three cells, one step apart), the chat (a still mark beside the greeting; three small
marks turning while Códice answers), and the favicon.

## Layout

### First screen: the chat, alone

- A fixed height (`85svh`, at least 560px), so a conversation scrolls inside it.
- The hero title (the page's `h1`, 20px, two lines on desktop) and the chat under it (max 32rem, the title balanced on two lines)
  start on the sections' text column (48%, the line of the bar's links), a little above the
  middle, over the wave field; on phones they start under the bar. No section label, no dividers.
- A top bar fixed to the top of the window, 52px (44px on phones), with no ground of its own: the
  page's links (Producto, Documentación, Precios), 48px apart, with no fill and drawn with
  `mix-blend-mode: difference` so they stay readable over whatever scrolls under them, start on the text
  column's edge (48%), the same line as the section text below; the compact pair of buttons sits on the right (Entrar
  outlined, Obtener clave electric). The links show from 1280px up (narrower, they would run into the buttons). Until `/docs` exists,
  Documentación and API point at the developer section.

### The "Funciona con" strip

Right under the hero, one row across the full width, 76px (60px on phones): taller than the top
bar. It sticks 24px (16px) above the window's top edge, so once stuck its bottom border lands
exactly on the bar's bottom edge. As it slides up under the bar, its content fades over that
whole travel (fully gone once stuck), so what remains is its fill and bottom border: from then
on they are the bar's ground (`Strip` in `index.tsx`).

Content: "Funciona con" in `muted` on the left, and on the right the icons of assistants that can connect to Códice over MCP (ChatGPT, Claude, Microsoft
Copilot), 20px, 32px apart. Only list an assistant that really connects. The SVGs come from
svgl.app (`public/_site/logos/`), cropped to their drawn area so they render at one size, and are
drawn as CSS masks filled with `fg`, one color in either theme. Each shows its name in a tooltip
above it on hover or keyboard focus.

### Below: the ruled sheet

- Each section is a two-column grid at `sm` and up: `48fr` margin column for the section's name,
  `52fr` text column (max 34rem). The text starts just right of center, like a note in a codex's
  outer margin (from the Figma reference, node 2:2).
- A hairline above each section and a hairline down the margin column's edge. On phones the
  columns stack and the vertical rule goes.
- **One padding unit everywhere:** 16px on phones, 24px from each rule on wider screens (`CELL`
  in `index.tsx`). Boxes inside use 16px (`p-4`); the composer is compact (`px-3 py-2`).
- Sections are few and tall, each grouping related content: Qué es (the headline and the intro,
  with the full-size buttons), Qué contiene, Para desarrolladores.

### Footer

- A band of three square cells, divided by hairlines, each holding a mark that fills it (radius
  10, 1px stroke), one step apart.
- One row under it, spread across the full width (`justify-between`): "© 2026 Handlemotion"
  (opens handlemotion.com in a new tab) and the page's links. No disclaimer, no keyboard hints.

## Docs (`/docs`)

Fumadocs (`fumadocs-ui`, `fumadocs-mdx`, `fumadocs-openapi`) renders the guides in
`content/docs` and one page per API operation from `content/openapi.json`. It follows this file,
not Fumadocs' defaults:

- **The same top bar** as the home (`SiteBar`, grounded: `ink` with a bottom hairline). It carries
  the brand: the mark, and from 1280px the name in regular weight. Narrower, the links sit beside
  the mark on the left (they scroll sideways if they must; they never disappear). Fumadocs' own
  layout is off: `routes/docs/$.tsx` lays the page out itself.
- **Sidebar, page, contents:** the sidebar (300px) behind its hairline, then the guide at a reading
  width (800px), 56px below the bar and centered on the screen (not on the space beside the
  sidebar) once the screen is wide enough, with its contents and actions (copy as Markdown, open in
  ChatGPT or Claude) floating at the right edge from 1280px, as Fumadocs lays a page out. The bar's
  mark sits 16px in, on the line of the sidebar's icons. Docs text is 15px; headings are 16px bold,
  with no dividers between sections. Below 1280px the actions sit above the title. An API operation
  has no contents or actions: Fumadocs' operation keeps its own example column. (Tried and
  dropped: three columns on the home's 48% line, with the contents between the sidebar and the
  text; it left a wide empty column and stretched the text.)
- **The sidebar** (`docs-sidebar.tsx`, Figma node 8:4): a search row with its `⌘K` key cap, one
  52px row per group (line icon, label, chevron) between hairlines, the current group open, the
  current page bold in `fg`, and the theme toggle at the foot.
- **Hover only brightens:** `muted` goes to `fg`; text already in `fg` gets an underline (the bar's
  links) or brightens its icons (sidebar groups). Nothing dims on hover.
- **Tokens, not Fumadocs' palette:** every `--color-fd-*` maps to ours in `styles.css`. All
  surfaces are the ground (no cards, popovers or muted panels in grey); separation is the hairline.
  The accent is `electric`; Fumadocs' theme switch is off, so `T` and dark-by-default apply.
- **`.codice-docs` overrides** (`styles.css`): 4px boxes, 2px small controls, no shadows or blur;
  14px interface text (15px in a guide), the page title at 20px, section headings bold; code in Supply Mono at 12px
  with Shiki's dark theme unless the page is light; the sidebar's current page bold in `fg`, never a tinted fill.
- **Spanish interface:** `src/lib/docs-i18n.ts` translates Fumadocs' labels. Add a key there when
  an English label shows up.
- **Content:** the API reference is generated: change `apps/api/src/openapi.ts`, then run
  `pnpm --filter @codice/api openapi`.

## Components

### Buttons

| Kind      | Classes (shape)                                                           | Where                  |
| --------- | ------------------------------------------------------------------------- | ---------------------- |
| Primary   | `bg-electric text-white font-bold rounded-[2px] px-3 py-1.5`              | Qué es                 |
| Secondary | `border border-line rounded-[2px] px-3 py-1.5`                            | Qué es                 |
| Compact   | same, 28px tall (`h-7`), `px-2 text-[13px]`; secondary adds `bg-ink`      | Floating, first screen |
| Ghost     | `h-8 px-2 rounded-[2px] text-muted`, no box until hover (`bg-line`, `fg`) | Docs page actions      |

Hover: primary inverts to `bg-fg text-ink`; secondary's border goes to `fg`. Sharp, small, flat.
Primary always comes first in reading order of its group, except the floating pair, which reads
Entrar → Obtener clave so the blue one sits in the corner.

### Chat (`src/ask.tsx`)

- **A chat, not a section:** only the hero title above it, no explanation around it.
- **The thread** sits in the page's own flow, with no scroll or fade of its own: the first screen
  is at least 85% of the window and grows with a long answer. On wide screens the chat keeps at
  least 360px, so the title sits a little above the middle whatever the thread holds. Each
  message rises in (`.message-in`). The grey bubble eases its width between the offered
  questions and holds still while focused.
- **Ported from Transitive, not hand-rolled:** the bubble is its `Bubble`, and answers reveal at a
  steady pace with its `useStreamedReveal` (`src/components/chat/`).
- **The visitor's question** is a right-aligned bubble: `bg-line` while typed, `bg-electric` with
  white text once sent, 4px radius, at most 85% of the thread.
- **Códice's turn:** three small marks (one step apart) turn while it works, beside a short
  `muted` status taken from the tool it is running ("Buscando en las reglas del SAT", "Leyendo la
  regla"…), then rest. While it only thinks, the marks turn alone, at twice the pace. The answer streams in as markdown in plain `fg` text. The API
  ends it with a `Fuente:` block; the chat takes it out of the text and shows each linked
  document as a pill (see below).
- **Composer:** one box at the bottom of the chat, inverted: `bg-fg` with `ink` text (black on
  the light theme, white on the dark), its ghost text and key caps in `ink` at reduced opacity. When empty it shows a suggested
  question as ghost text that rotates every 4s; Enter on an empty composer sends it. While typing,
  it completes from the same list, ignoring case, accents and the opening "¿"; Tab accepts and
  keeps what was typed. Key caps `Tab` and `↵` sit at the right (hidden on phones).
- **One question, one answer.** The composer is a grey bubble on the right under the title, as
  wide as its text; Enter sends it in place as the blue bubble and the answer streams under it.
  Under the answer, one row: three `muted` icon actions with their names in tooltips (copy the
  answer, a branch for "Continuar la conversación con una cuenta" to `/login`, a counter-clockwise
  arrow for "Empezar de nuevo", also Esc), then each source as a pill: `line` border, full
  radius, 12px `muted` text, a file icon and the section it cites ("CFDI40149"), the document
  and its date in the tooltip, opening the document. `/` focuses the composer from anywhere.
- Errors are one short Spanish sentence in `muted`; never show the API's English problem titles.
- It uses TanStack AI's `useChat` with `fetchServerSentEvents("/_site/chat")`: the site's server
  route forwards the turn to the API's `POST /v1/chat` with the site's key (`AGENTS.md`).

### Tooltips

shadcn/ui's Tooltip (`src/components/ui/tooltip.tsx`) on `@radix-ui/react-tooltip`, the provider
in `__root.tsx`. `fg` ground, `ink` text, 11px, 2px corners, a small arrow, a 120ms fade. It opens
on its requested side and Radix keeps it 16px inside the window (`collisionPadding`), sliding it
along that side when there is no room, the arrow still on its trigger. Use it for any tooltip;
never hand-position one.

### Code islands

The only boxes in running text: a `pre` with a 1px `line` border, 4px radius, 16px padding, 12px
text, wrapping. Use them for things the reader would copy (a command, a URL, a response).

### Key caps

`kbd` with a 1px `line` border, 2px radius, 11px `muted` text. Only inside components (the
composer), never in prose.

### Links

In prose: underlined with a `line` underline that turns `fg` on hover. In the footer: `muted`,
turning `fg` on hover.

## Motion

- Everything that moves steps at 12fps: the marks. The answer streams at the model's pace.
- No entrance fades, no dimmed sections, no scroll-triggered reveals. They were tried and removed.
- In-page links scroll smoothly; reduced motion turns that off and rests every mark.
- No overscroll bounce past the top or bottom of the page (`overscroll-behavior: none`).

## Copy

- Spanish (es-MX), `lang="es-MX"`, `og:locale` `es_MX`.
- No hype, no disclaimers in the chrome.

## What we tried and dropped

So it isn't proposed again:

- Large display headlines, mixed type sizes, two typefaces (Geist, Neue Machina): too varied.
- A thread scrolling inside the first screen, faded at its edges: it caught the page's scroll and
  its scroll-driven fade stuck on the composer after starting over.
- Elevated grey panels, `rounded-xl`, a black strip behind a fixed bar: not black enough, too
  soft.
- A fixed bottom ask bar, a full-screen "void" prompt with typed-out verbatim rules, and the first
  stone-palette demo chat (`demo-chat.tsx`): replaced by the chat.
- Designed sections (cards, label/value grids for principles), a top nav bar, keyboard hints in
  prose, a disclaimer in the footer.
- Section fade-ins (they read as dimmed text).

## Known deviations from generic checks

The `design-taste-frontend` inspector flags monospace body text, hairlines, 13px body, no
photographs and the empty first screen. Each is this design's deliberate choice; do not "fix"
them. Its real findings (contrast, centering) still apply.

## Dependencies

- Fonts: `public/_site/fonts/PPSupplyMono-{Regular,Bold}.woff2`.
- Icons: none. The marks are the only graphics.
