/**
 * The related passages an agent can follow from a passage, read from the SAT's own text at
 * ingestion (SPEC.md, "Related passages"). Pure: `corpus.ts` calls it once the passages exist, and
 * every link it returns names two of them.
 *
 * - An RMF regla's references line (`CFF 29, 29 Bis, RMF 2.7.1.32., 2.7.2.1.`) names the reglas it
 *   rests on: each `RMF` list links to those reglas.
 * - A `CFDI40xxx` row names the node and attribute it validates (`cfdi:Receptor`,
 *   `DomicilioFiscalReceptor`): it links to the Anexo 20 passage that defines that attribute, and
 *   that passage links back to every code that validates it.
 */
import type { Passage } from "./corpus";

export type PassageLink = {
  /** The passage the link is read from. */
  readonly from: string;
  /** The passage it points to. */
  readonly to: string;
};

/**
 * `RMF 2.7.1.32., 2.7.2.1.,` and the numbers that go on after a line break (`…, RCFF 7, RMF` /
 * `2.1.6., 2.2.6.`). A number a capital follows starts a regla (`Anexos de la RMF` / `1.4. Para…`),
 * so it is no reference.
 */
const RMF_LIST = /\bRMF\s+((?:\d{1,2}(?:\.\d{1,2}){1,4}\.(?:,\s*|\s+(?![A-ZÁÉÍÓÚÑ¿“"])|$))+)/gu;
const RMF_NUMBER = /(\d{1,2}(?:\.\d{1,2}){1,4})\./gu;

/** The RMF numbers a text cites, in order and once each: `2.7.1.32`, `2.7.2.1`. */
export function rmfReferences(text: string): string[] {
  const numbers = new Set<string>();
  for (const list of text.matchAll(RMF_LIST)) {
    for (const number of list[1]!.matchAll(RMF_NUMBER)) numbers.add(number[1]!);
  }
  return [...numbers];
}

/** A node of the CFDI guide (Part I of Anexo 20): its passage and its attributes' passages. */
type GuideNode = {
  readonly name: string;
  readonly key: string;
  readonly text: string;
  readonly attributes: ReadonlyMap<string, string>;
};

const PART_CUT = / \(parte \d+ de \d+\)$/u;
/** Part I of Anexo 20 is the CFDI's, which the matrix validates; Part II is the Retenciones CFDI. */
const CFDI_PART = /^I\. /u;

/**
 * The CFDI guide's nodes in the guide's order, from its passages' headings
 * (`Anexo 20… › I. Guía de llenado… › Nodo: Receptor › UsoCFDI`). A node the guide defines twice
 * (`Traslado` in a concept and in the comprobante's summary) is two nodes.
 */
export function guideNodes(passages: readonly Passage[]): GuideNode[] {
  const nodes: Array<GuideNode & { attributes: Map<string, string> }> = [];
  for (const passage of passages) {
    const [, part = "", node = "", attribute] = passage.heading
      .split(" › ")
      .map((segment) => segment.replace(PART_CUT, ""));
    if (!CFDI_PART.test(part) || !node.startsWith("Nodo: ")) continue;
    const name = node.slice("Nodo: ".length);
    const last = nodes.at(-1);
    if (attribute === undefined) {
      // A node cut in parts keeps its first.
      if (last?.name !== name || last.attributes.size > 0) {
        nodes.push({ name, key: passage.key, text: passage.body, attributes: new Map() });
      }
    } else if (last?.name === name && !last.attributes.has(attribute)) {
      last.attributes.set(attribute, passage.key);
    }
  }
  return nodes;
}

/**
 * The guide passage for a matrix row's node and attribute, or null.
 *
 * The row's node is a path (`cfdi:Conceptos/Concepto:Impuestos:Traslados/Traslado`). Its first
 * name is a child of the comprobante, at the last place the guide defines it: the comprobante's
 * `Impuestos` follows `Conceptos`, whose concept defines an `Impuestos` of its own. Each name after
 * it is the first the guide defines after the one before. The passage is the attribute's; else the
 * node's, when the row validates the node itself (no attribute, or the node's name) or the node's
 * passage names the attribute (`InformacionGlobal`: `Periodicidad, Meses y Año`).
 */
export function guidePassageFor(
  nodes: readonly GuideNode[],
  row: { readonly node: string; readonly attribute: string },
): string | null {
  const path = row.node.split(/[:/]/u).filter((name) => name && name !== "cfdi");
  let at = -1;
  for (const [index, name] of path.entries()) {
    at =
      index === 0
        ? nodes.findLastIndex((node) => node.name === name)
        : nodes.findIndex((node, position) => position > at && node.name === name);
    if (at === -1) return null;
  }
  const node = nodes[at];
  if (!node) return null;
  const attribute = row.attribute.trim();
  const own = node.attributes.get(attribute);
  if (own) return own;
  const named = new RegExp(`\\b${attribute.replaceAll(/[^\p{L}\p{N}]/gu, "")}\\b`, "u");
  return !attribute || attribute === node.name || named.test(node.text) ? node.key : null;
}

/**
 * Every link the corpus's text gives, each passage's in order: an RMF regla's references as it
 * lists them, a matrix row's guide passage, a guide passage's codes in the matrix's order. A link
 * to a passage the corpus does not hold (a repealed regla, a `Sección` number) or to itself is left
 * out.
 */
export function passageLinks(input: {
  readonly passages: readonly Passage[];
  readonly rmfSourceId: string;
  readonly guideSourceId: string;
  /** Each matrix row with its passage's key. */
  readonly errorCodes: readonly {
    readonly key: string;
    readonly node: string;
    readonly attribute: string;
  }[];
}): PassageLink[] {
  const keys = new Set(input.passages.map((passage) => passage.key));
  const links: PassageLink[] = [];
  const seen = new Set<string>();
  const link = (from: string, to: string) => {
    const id = `${from}\n${to}`;
    if (from === to || !keys.has(from) || !keys.has(to) || seen.has(id)) return;
    seen.add(id);
    links.push({ from, to });
  };

  for (const passage of input.passages) {
    if (passage.sourceId !== input.rmfSourceId) continue;
    for (const number of rmfReferences(passage.body)) {
      link(passage.key, `${input.rmfSourceId}/regla-${number}.md`);
    }
  }

  const nodes = guideNodes(
    input.passages.filter((passage) => passage.sourceId === input.guideSourceId),
  );
  const codes = new Map<string, string[]>();
  for (const row of input.errorCodes) {
    const guide = guidePassageFor(nodes, row);
    if (!guide) continue;
    link(row.key, guide);
    codes.set(guide, [...(codes.get(guide) ?? []), row.key]);
  }
  for (const [guide, rows] of codes) for (const row of rows) link(guide, row);
  return links;
}
