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

- Dark is the default; light follows `prefers-color-scheme`.
- The `T` key toggles and remembers (`localStorage` key `codice-theme`, `data-theme` on `<html>`),
  set before first paint by `THEME_SCRIPT` in `src/theme.ts`. It is not advertised on the page.
- **Favicon:** dark keeps the original near-black tile with an off-white line; light is an
  electric-blue tile with a white line. It animates on the same clock as the page's marks and
  follows the theme (`faviconSvg` in `src/brand/shapes.ts`). The static `favicon.svg` covers
  reduced motion with a media query.

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

- `min-h-[85vh]`, content centered and nudged up (`pb-[14vh]`) so the chat sits above the middle.
- The hero title (the page's `h1`, 20px) and the chat under it (max 34rem wide) in the center,
  over the wave field. No brand mark, no nav bar, no section label, no dividers.
- A small compact pair of buttons floats top-right (Entrar outlined, Obtener clave electric).

### The "Funciona con" strip

Right under the hero, one row across the full width: "Funciona con" in `muted`, then the MCP
clients that connect to Códice (Claude, ChatGPT, Cursor, VS Code, Windsurf) as bold text names,
spread evenly. Names only, never their logos: logos need each brand's permission and would add
a second visual language.

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
  (links to handlemotion.com) and the page's links. No disclaimer, no keyboard hints.

## Components

### Buttons

| Kind      | Classes (shape)                                                        | Where                  |
| --------- | ---------------------------------------------------------------------- | ---------------------- |
| Primary   | `bg-electric text-white font-bold rounded-[2px] px-3 py-1.5`           | Qué es                 |
| Secondary | `border border-line rounded-[2px] px-3 py-1.5`                         | Qué es                 |
| Compact   | same, 28px tall (`h-7`), `px-2.5 text-[13px]`; secondary adds `bg-ink` | Floating, first screen |

Hover: primary inverts to `bg-fg text-ink`; secondary's border goes to `fg`. Sharp, small, flat.
Primary always comes first in reading order of its group, except the floating pair, which reads
Entrar → Obtener clave so the blue one sits in the corner.

### Chat (`src/ask.tsx`)

- **A chat, not a section:** only the hero title above it, no explanation around it.
- **The visitor's question** is a right-aligned bubble: `bg-electric`, white text, 4px radius.
- **Códice's turn:** three small marks (one step apart) turn while it works, beside a short
  `muted` status taken from the tool it is running ("Buscando en las reglas del SAT", "Leyendo la
  regla"…, or "Pensando"), then rest. The answer streams in as markdown in plain `fg` text; the API
  ends it with a `Fuente:` line whose links use the prose link style.
- **Composer:** one bordered box at the bottom of the chat. When empty it shows a suggested
  question as ghost text that rotates every 4s; Enter on an empty composer sends it. While typing,
  it completes from the same list, ignoring case, accents and the opening "¿"; Tab accepts and
  keeps what was typed. Key caps `Tab` and `↵` sit at the right (hidden on phones).
- **v1 is one question, one answer.** While it answers the composer shows `Esc` "Detener"; after,
  `Esc` "Otra pregunta". Esc clears the chat from anywhere; `/` focuses the composer from anywhere.
- Errors are one short Spanish sentence in `muted`; never show the API's English problem titles.
- It uses TanStack AI's `useChat` with `fetchServerSentEvents("/_site/chat")`: the site's server
  route forwards the turn to the API's `POST /v1/chat` with the site's key (`AGENTS.md`).

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

## Copy

- Spanish (es-MX), `lang="es-MX"`, `og:locale` `es_MX`.
- Written for accountants and people who invoice, not developers: plain words ("el Código
  Fiscal", not "CFF"), the client's real questions as examples, short paragraphs. Only "Para
  desarrolladores" may be technical.
- No hype, no disclaimers in the chrome. The stance: "No sustituye tu criterio. Te da la fuente
  para sostenerlo."
- The headline (from the Figma reference): "Códice es el primer índice de documentación legal
  mexicana."

## What we tried and dropped

So it isn't proposed again:

- Large display headlines, mixed type sizes, two typefaces (Geist, Neue Machina): too varied.
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
