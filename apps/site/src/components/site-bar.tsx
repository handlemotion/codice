// The site's one top bar, on the home and on every docs page (DESIGN.md, "Layout").

/** Its height; the home's logo strip and the docs' layout both measure against it. */
export const BAR = "h-[44px] sm:h-[52px]";
export const BAR_HEIGHT = { phone: 44, wide: 52 } as const;

const NAV_LINKS = [
  ["Producto", "/#que-es"],
  ["Documentación", "/docs"],
  ["API", "/docs/api"],
  ["Precios", "/#precios"],
] as const;

/**
 * Fixed to the top. On the home it has no ground of its own (the logo strip slides under it and
 * becomes its ground); elsewhere `grounded` gives it the page's ground and a bottom hairline.
 */
export function SiteBar({ grounded = false }: { grounded?: boolean }) {
  return (
    <div
      className={`${BAR} pointer-events-none fixed inset-x-0 top-0 z-40 grid items-center sm:grid-cols-[48fr_52fr] ${grounded ? "border-b border-line bg-ink" : ""}`}
    >
      {/* The links start on the text column's edge (48%), like the home's sections. */}
      <nav
        aria-label="Principal"
        className="pointer-events-auto hidden gap-12 px-6 sm:col-start-2 xl:flex"
      >
        {NAV_LINKS.map(([label, href]) => (
          <a
            className="inline-flex h-7 items-center text-white mix-blend-difference hover:underline"
            href={href}
            key={label}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="pointer-events-auto absolute right-4 flex gap-2">
        <a
          className="inline-flex h-7 items-center rounded-[2px] border border-line bg-ink px-2 text-[13px] hover:border-fg"
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
