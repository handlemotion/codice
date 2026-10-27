import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Ask } from "../ask";
import { Mark, MarkField } from "../brand/mark";

export const Route = createFileRoute("/")({ component: Home });

// A real row of the SAT's CFDI 4.0 error matrix (docs/sat-md), trimmed to its quoted fields.
const RESPONSE = `{
  "data": {
    "code": "CFDI40149",
    "attribute": "DomicilioFiscalReceptor",
    "validation": "Si el valor del atributo Rfc del receptor es \\"XAXX010101000\\" o \\"XEXX010101000\\", este atributo debe ser igual al valor del atributo LugarExpedicion.",
    "source": {
      "authority": "SAT",
      "url": "http://omawww.sat.gob.mx/…/MatrizDeErrores_CFDI_v40_20260325.xls",
      "publishedAt": "2026-03-25"
    }
  }
}`;

const TOOLS = [
  ["search", "Busca reglas por pregunta o por clave."],
  ["read_passage", "Lee una regla completa."],
  ["lookup_error", "Explica un código de error CFDI40xxx."],
  ["lookup_catalog", "Busca una clave en un catálogo del SAT."],
  ["list_sources", "Lista los documentos indexados."],
] as const;

// The page is a ruled sheet: a margin column for the section's name and a text column that
// starts just right of center, like a note written in a codex's outer margin. Every cell keeps
// the same distance from its rules.
const SHEET = "grid sm:grid-cols-[48fr_52fr]";
const CELL = "p-4 sm:p-6";

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section className={`${SHEET} scroll-mt-0 border-t border-line`} id={id}>
      <h2 className={`${CELL} border-line font-bold max-sm:pb-0 sm:border-r`}>{title}</h2>
      <div className={`${CELL} flex max-w-[34rem] flex-col gap-5`}>{children}</div>
    </section>
  );
}

// The only islands on the page: code the reader would copy.
function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="rounded-[4px] border border-line p-4 font-mono text-[12px] break-words whitespace-pre-wrap">
      <code>{children}</code>
    </pre>
  );
}

const FOOTER_LINKS = [
  ["Preguntar", "#preguntar"],
  ["Qué es", "#que-es"],
  ["Índice", "#indice"],
  ["Desarrolladores", "#desarrolladores"],
  ["Obtener clave", "/keys"],
  ["Entrar", "/login"],
] as const;

const LINK = "underline decoration-line underline-offset-4 hover:decoration-fg";

// The dashboard lives on the same host; `/login` and `/keys` are its routes (apps/edge).
function Home() {
  return (
    <div className="min-h-dvh text-[14px] leading-[1.7]">
      {/* The first and tallest part, unruled: what Códice is on the left, with its two actions;
          the whole right side is for asking it, the box sitting at the foot of the column. */}
      {/* The first screen is only the chat, centered and nudged above the middle, over the three
          field of marks rolling corner to corner like a wave. */}
      <header className="relative flex min-h-[95vh] flex-col items-center justify-center overflow-hidden px-4 pt-16 pb-[18vh]">
        <MarkField className="pointer-events-none absolute inset-0 size-full text-line" />
        {/* The two actions float in the corner, over the mark. */}
        <div className={`${CELL} absolute top-0 right-0 flex gap-2`}>
          <a
            className="rounded-[2px] border border-line bg-ink px-2 py-1.5 text-[12px] hover:border-fg"
            href="/login"
          >
            Entrar
          </a>
          <a
            className="rounded-[2px] bg-electric px-2 py-1.5 text-[12px] font-bold text-white hover:bg-fg hover:text-ink"
            href="/keys"
          >
            Obtener clave
          </a>
        </div>
        <div className="relative w-full max-w-[34rem] scroll-mt-24" id="preguntar">
          <Ask />
        </div>
      </header>

      <main className="relative">
        <Section id="que-es" title="Qué es">
          <p>
            Cuando un cliente te pregunta si todavía puede cancelar una factura, qué uso de CFDI le
            corresponde o por qué el SAT rechazó un comprobante, la respuesta casi siempre está
            escrita en algún lado: en el Anexo 20, en la Resolución Miscelánea, en una guía de
            llenado. Lo que toma tiempo es encontrarla.
          </p>
          <p>
            Códice reúne esos documentos y los vuelve fáciles de consultar. Le preguntas como le
            preguntarías a un colega, y te responde en pocas palabras con la regla exacta, el
            documento donde está y desde cuándo aplica.
          </p>
          <p>
            Las reglas cambian cada año, así que cada respuesta corresponde a la fecha que te
            interesa: si revisas un ejercicio anterior, te dice lo que aplicaba entonces.
          </p>
          <p>No sustituye tu criterio. Te da la fuente para sostenerlo.</p>
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
          <p>
            Lo que consultas para facturar: la guía de llenado del CFDI 4.0 y la del complemento de
            pagos, los catálogos del SAT (usos de CFDI, claves de producto, códigos postales), los
            motivos por los que el SAT rechaza un comprobante y la Resolución Miscelánea Fiscal
            2026.
          </p>
          <p>
            Después vendrán el Código Fiscal, las leyes del ISR y del IVA, y las reglas de comercio
            exterior.
          </p>
        </Section>

        <Section id="desarrolladores" title="Para desarrolladores">
          <p>Por HTTP, pide un código de error:</p>
          <Code>curl https://codice.io/v1/errors/CFDI40149</Code>
          <p>Y recibes el renglón de la matriz, palabra por palabra, con su fuente:</p>
          <Code>{RESPONSE}</Code>
          <p>Para Claude, ChatGPT o Cursor, agrega este servidor MCP:</p>
          <Code>https://codice.io/mcp</Code>
          <p>Tu asistente tendrá cinco herramientas, y consultará la regla en vez de recordarla:</p>
          <dl className="flex flex-col">
            {TOOLS.map(([tool, detail]) => (
              <div
                className="grid grid-cols-[9rem_1fr] gap-4 border-t border-line py-2 last:border-b"
                key={tool}
              >
                <dt>{tool}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
          <p>
            La API necesita una clave.{" "}
            <a className={LINK} href="/keys">
              Obtén una aquí
            </a>
            . Si ya tienes cuenta,{" "}
            <a className={LINK} href="/login">
              entra
            </a>
            .
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
          <a className="hover:text-fg" href="https://handlemotion.com">
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
