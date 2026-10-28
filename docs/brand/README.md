# Brand assets

The Códice mark at rest on each of its three shapes (circle, square, triangle), drawn with the
favicon's geometry from `apps/site/src/brand/shapes.ts` (radius 9, stroke 2.4 on a 32-unit tile). For
OAuth app logos, profile pictures and anywhere the favicon is too small. Each SVG is the master; the
PNGs are rendered from it at 1024, 512, 256 and 120 px.

| Variant         | Looks like                                      | Use it where                                                                |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `tile-dark`     | `#f4f4f5` line on a full-bleed `#0a0a0b` square | Profile pictures and OAuth logos: Google (120 px, square), GitHub (circle). |
| `tile-electric` | `#ffffff` line on a full-bleed `#2346ff` square | The same, in the light theme's accent.                                      |
| `mark-ink`      | `#0a0a0b` line on a transparent background      | On light backgrounds: docs, decks, partner pages.                           |
| `mark-white`    | `#ffffff` line on a transparent background      | On dark or colored backgrounds.                                             |

The tiles are full-bleed squares so each platform can apply its own rounding or circle crop; every
shape sits inside a circular crop with room to spare.
