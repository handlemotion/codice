// The site's one top bar, on the home and on every docs page (DESIGN.md, "Layout").
import { Mark } from "../brand/mark";

/** Its height; the home's logo strip and the docs' layout both measure against it. */
export const BAR = "h-[44px] sm:h-[52px]";

const NAV_LINKS = [
  ["Producto", "/#que-es"],
  ["Documentación", "/docs"],
  ["Precios", "/#precios"],
] as const;

/**
 * Fixed to the top. On the home it has no ground of its own (the logo strip slides under it and
 * becomes its ground); elsewhere `grounded` gives it the page's ground and a bottom hairline, and
 * keeps the mark at 20px, in line with the docs sidebar's icons.
 * Narrow, it is the mark and the links side by side on the left; from 1280px the mark carries the
 * name and the links move to the text column's edge (48%), in line with the home's sections.
 */
export function SiteBar({ grounded = false }: { grounded?: boolean }) {
  return (
    <div
      className={`${BAR} pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center gap-6 ${grounded ? "border-b border-line bg-ink px-5" : "px-4 sm:px-6"}`}
    >
      <a
        aria-label="Códice, inicio"
        className="pointer-events-auto flex h-7 shrink-0 items-center gap-2.5"
        href="/"
      >
        <Mark className="size-4" strokeWidth={1.5} />
        <span className="hidden [text-box:trim-both_cap_alphabetic] xl:inline">Códice</span>
      </a>
      <nav
        aria-label="Principal"
        className="pointer-events-auto flex min-w-0 gap-6 overflow-x-auto [scrollbar-width:none] xl:absolute xl:left-[calc(48%+24px)] xl:gap-12"
      >
        {NAV_LINKS.map(([label, href]) => (
          <a
            className="inline-flex h-7 shrink-0 items-center text-white mix-blend-difference hover:underline"
            href={href}
            key={label}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="pointer-events-auto ml-auto flex shrink-0 gap-2">
        <a
          className="inline-flex h-7 items-center rounded-[2px] border border-line bg-ink px-2 text-[13px] hover:border-fg max-sm:hidden"
          href="/login"
        >
          Entrar
        </a>
        <a
          className="inline-flex h-7 items-center rounded-[2px] bg-electric px-2 text-[13px] font-bold text-white hover:bg-fg hover:text-ink"
          href="/keys"
        >
          Obtener clave
        </a>
      </div>
    </div>
  );
}
