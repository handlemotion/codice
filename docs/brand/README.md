# Brand assets

The Códice mark at rest: the favicon's ring (radius 9, stroke 2.4 on a 32-unit tile), for profile
pictures, OAuth app logos and anywhere else the favicon is too small. Each SVG is the master; the
PNGs are rendered from it at 1024, 512, 256 and 120 px.

| Folder     | Tile                                   | Use it where                                                                      |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `square/`  | Full-bleed square, no corner rounding  | The platform crops or rounds it: Google OAuth consent screen (120 px), GitHub, X. |
| `rounded/` | The favicon's tile, corners at 4/32    | A square slot shown as-is: app icons, docs, decks.                                |
| `circle/`  | Pre-cut circle, transparent outside it | A slot shown without cropping that should read as round.                          |

Two colorways, the favicon's two themes: `dark` (`#0a0a0b` tile, `#f4f4f5` ring) and `electric`
(`#2346ff` tile, `#ffffff` ring). The ring sits well inside a circular crop, so the `square` files
are safe to upload where the platform shows a circle.
