import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import { Ask } from "../ask";
import { SiteBar } from "../components/site-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { Mark, MarkField } from "../brand/mark";

export const Route = createFileRoute("/")({ component: Home });

// The page is a ruled sheet: a margin column for the section's name and a text column that
// starts just right of center, like a note written in a codex's outer margin. Every cell keeps
// the same distance from its rules.
const SHEET = "grid sm:grid-cols-[48fr_52fr]";
const CELL = "p-4 sm:p-6";

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section className={`${SHEET} scroll-mt-[52px] border-t border-line first:border-t-0`} id={id}>
      <h2 className={`${CELL} border-line font-bold max-sm:pb-0 sm:border-r`}>{title}</h2>
      <div className={`${CELL} flex max-w-[34rem] flex-col gap-5`}>{children}</div>
    </section>
  );
}

// Assistants an accountant knows that can connect to https://codice.io/mcp. Their icons come from
// svgl.app, cropped to their drawn area so they render at one size, and are drawn as masks filled
// with the page's ink, so every logo is one color in either theme.
const ASSISTANTS = [
  ["ChatGPT", "openai"],
  ["Claude", "claude"],
  ["Microsoft Copilot", "copilot"],
] as const;

const FOOTER_LINKS = [
  ["Preguntar", "#preguntar"],
  ["Qué es", "#que-es"],
  ["Índice", "#indice"],
  ["Documentación", "/docs"],
  ["Obtener clave", "/keys"],
  ["Entrar", "/login"],
] as const;

// The top bar (SiteBar) is shorter than the logo strip. The strip sticks above the window's top
// edge by the difference, so its bottom border lands on the bar's bottom edge and becomes its ground.
const STRIP = "h-[60px] -top-4 sm:h-[76px] sm:-top-6";

/**
 * The assistants Códice works with: the label, then their icons pushed to the right. The strip
 * sticks under the top bar; as it slides up beneath the bar its content fades out, so what stays
 * is its fill and bottom border, the bar's ground from then on.
 */
function Strip() {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = content.current?.parentElement;
    if (!strip) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // 1 until the strip reaches the bar, 0 once it is stuck (above the window's top edge by
      // the difference in height): the fade runs over the whole travel under the bar.
      const { top, height } = strip.getBoundingClientRect();
      const stuck = parseFloat(getComputedStyle(strip).top) || 0;
      const visible = Math.min(Math.max((top - stuck) / height, 0), 1);
      if (content.current) {
        content.current.style.opacity = String(visible);
        content.current.style.visibility = visible === 0 ? "hidden" : "visible";
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section
      aria-label="Funciona con"
      className={`${STRIP} sticky z-20 border-b border-line bg-ink px-4 sm:px-6`}
    >
      <div className="flex h-full items-center justify-between gap-8" ref={content}>
        <span className="text-muted">Funciona con</span>
        <ul className="flex items-center gap-8">
          {ASSISTANTS.map(([name, file]) => (
            <li key={file}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label={name}
                    className="block size-5 bg-fg outline-offset-4"
                    role="img"
                    style={{
                      mask: `url(/_site/logos/${file}.svg) center / contain no-repeat`,
                      WebkitMask: `url(/_site/logos/${file}.svg) center / contain no-repeat`,
                    }}
                    tabIndex={0}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">{name}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const LINK = "underline decoration-line underline-offset-4 hover:decoration-fg";

// The dashboard lives on the same host; `/login` and `/keys` are its routes (apps/edge).
function Home() {
  return (
    <div className="min-h-dvh text-[14px] leading-[1.7]">
      {/* The bar stays at the top. It has no ground of its own: over the hero it floats on the
          marks, and once the logo strip below scrolls up under it, the strip's fill and bottom
          border become its ground (see `Strip`). */}
      <SiteBar />

      {/* The first screen, over a field of marks rolling corner to corner like a wave: the title
          and the chat on the sections' text column (48%), a little above the middle; on phones,
          under the bar. At least most of the screen, growing with a long answer. */}
      <header className="relative flex min-h-[85svh] flex-col overflow-hidden border-b border-line px-4 pt-[68px] pb-4 sm:px-6 sm:pt-[76px] sm:pb-6 lg:justify-center lg:pb-[12vh] lg:pl-[calc(48%+24px)]">
        <MarkField className="pointer-events-none absolute inset-0 size-full text-field" />
        <div
          className="relative flex w-full max-w-[32rem] flex-col lg:min-h-[360px]"
          id="preguntar"
        >
          <Ask />
        </div>
      </header>

      <Strip />

      <main className="relative">
        <Section id="que-es" title="Qué es">
          <p>
            Un índice de las reglas fiscales de México que tus agentes consultan por MCP y tu
            software por API.
          </p>
          <p>
            Cada regla sabe desde cuándo aplica: una consulta sobre 2025 recibe la regla de 2025.
          </p>
          <div className="flex gap-2 pt-2">
            <a
              className="rounded-[2px] bg-electric px-3 py-2.5 font-bold text-white hover:bg-fg hover:text-ink"
              href="/keys"
            >
              Obtener clave
            </a>
            <a
              className="rounded-[2px] border border-line px-3 py-2.5 hover:border-fg"
              href="/login"
            >
              Entrar
            </a>
          </div>
        </Section>

        <Section id="indice" title="Qué contiene">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>Guía de llenado del CFDI 4.0 (Anexo 20)</li>
            <li>Guía de llenado del complemento de pagos</li>
            <li>Catálogos del CFDI 4.0</li>
            <li>Matriz de errores de validación del CFDI 4.0</li>
            <li>Resolución Miscelánea Fiscal 2026</li>
          </ul>
          <p className="text-muted">
            Próximamente: Código Fiscal, leyes del ISR y del IVA, reglas de comercio exterior.
          </p>
        </Section>

        {/* Placeholder until the plans are set: no prices are invented here. */}
        <Section id="precios" title="Precios">
          <p>Los planes y precios se publicarán pronto.</p>
        </Section>

        <Section id="desarrolladores" title="Para tu software">
          <p>Las mismas consultas por MCP para tus agentes y por API HTTP para tu sistema.</p>
          <p>
            <a className={LINK} href="/docs">
              Leer la documentación
            </a>
          </p>
        </Section>
      </main>

      <footer className="relative border-t border-line bg-ink">
        {/* Three cells, three shapes, one step apart: always a circle, a square and a triangle. */}
        <div aria-hidden className="grid grid-cols-3">
          {[0, 1, 2].map((step) => (
            <div className="aspect-square border-line p-[8%] not-last:border-r" key={step}>
              <Mark className="size-full" radius={10} step={step} strokeWidth={1} />
            </div>
          ))}
        </div>
        {/* One row across the whole width: the copyright, then the links, spread evenly. */}
        <nav
          aria-label="Códice"
          className={`${CELL} flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-line text-muted`}
        >
          <a
            className="hover:text-fg"
            href="https://handlemotion.com"
            rel="noreferrer"
            target="_blank"
          >
            © 2026 Handlemotion
          </a>
          {FOOTER_LINKS.map(([label, href]) => (
            <a className="hover:text-fg" href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
