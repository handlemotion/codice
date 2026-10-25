/**
 * Splits a SAT filling guide, as MarkItDown converts its PDF, into Códice's search passages. Pure:
 * `corpus.ts` calls it for each guide.
 *
 * The guide's own table of contents (`Contenido`) names its top-level sections: the parts
 * (`I. Guía de llenado…`), the appendices (`Apéndice 7 Preguntas y respuestas…`), the glossary and
 * the change log. Each is found at a line start in that order, so a later line that only quotes a
 * title (`Apéndice 6 …` inside Apéndice 7) starts nothing.
 *
 * - A part is a two-column table, name and description. A passage starts at each node
 *   (`Nodo: Receptor`) and attribute (`UsoCFDI Se debe registrar…`) and runs to the next one, so an
 *   attribute keeps its examples and catalog table. A name too wide for its column wraps onto the
 *   next lines (`InformacionGlo` / `bal`, `DomicilioFiscalR` / `eceptor`); it is rejoined when the
 *   whole name appears elsewhere in the SAT's text.
 * - A questions-and-answers appendix is one passage a question.
 * - Any other section, and the cover before the first one, is cut at blank lines into parts of at
 *   most `SECTION_MAX_CHARS`.
 *
 * Every passage is a verbatim slice of the guide, and the slices cover it in order.
 */

export type GuideSection = {
  /** The heading path, such as `I. Guía de llenado… › Nodo: Receptor › UsoCFDI`. */
  readonly label: string;
  /** The short path the item key is built from, such as `Nodo: Receptor › UsoCFDI`. */
  readonly anchor: string;
  /** The guide's text, verbatim. */
  readonly text: string;
};

/** About 1,000 tokens of Spanish: one AI Search chunk. */
export const SECTION_MAX_CHARS = 3000;

/** `Nodo: Receptor …`; Part II of Anexo 20 has its root node in a table row (`| Nodo: …`). */
const NODE = /^(?:\|\s*)?Nodo:\s*(.*)$/u;
const ATTRIBUTE =
  /^([A-Z][A-Za-z0-9]{2,})\s+(?:Se |Es |En |Atributo|Cuando|Para |Si |El |La |Este |Nodo|Expresa|Campo|Clave|Valor|Indica|Requerido|Opcional|Condicional)/u;
/** Words a node's description starts with when the PDF put its name on the next line. */
const DESCRIPTION_START = new Set(["En", "Este", "Formato"]);
const NAME_FRAGMENT = /^[A-Za-z]+/u;
const PAGE_FOOTER = /^\d+ \/ \d+$/u;
const TOC_DOTS = /\s*\.{4,}.*$/u;
const PART = /^([IVX]+)\. /u;
const PART_HEADING = /^([IVX]+)\. Guía de llenado/u;
const APPENDIX = /^Apéndice (\d+)\b/u;
const QUESTIONS = /Preguntas y respuestas/u;
/** `4. ¿En qué caso…`: a question's number, at a line start or after the previous answer. */
const QUESTION = /(^|\s)(\d{1,2})\.\s+(?=[¿A-ZÁÉÍÓÚÑ])/gu;

/** Every identifier in the SAT's text (`DomicilioFiscalReceptor`), to rejoin a wrapped name. */
export function nameVocabulary(texts: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*/gu)) names.add(match[0]);
  }
  return names;
}

function fold(text: string) {
  return text.replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

type Entry = { readonly title: string; readonly first: string };

/** The table of contents: each entry's whole title and its first line, as the body starts it. */
function tableOfContents(lines: readonly string[]) {
  const start = lines.findIndex((line) => line.trim() === "Contenido");
  if (start === -1) return { entries: [] as Entry[], end: 0 };
  const entries: Entry[] = [];
  let pending: string[] = [];
  let index = start + 1;
  for (; index < lines.length && !PAGE_FOOTER.test(lines[index]!.trim()); index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    pending.push(line.replace(TOC_DOTS, ""));
    if (TOC_DOTS.test(line)) {
      entries.push({ title: pending.join(" "), first: pending[0]! });
      pending = [];
    }
  }
  return { entries, end: index };
}

type Boundary = {
  readonly offset: number;
  readonly label: string;
  readonly anchor: string;
  /** A rule (an attribute and its examples) is never cut, whatever its length. */
  readonly whole: boolean;
};

export function guideSections(
  markdown: string,
  options: { readonly title: string; readonly vocabulary: ReadonlySet<string> },
): GuideSection[] {
  const lines = markdown.split("\n");
  const offsets: number[] = [];
  lines.reduce((offset, line) => {
    offsets.push(offset);
    return offset + line.length + 1;
  }, 0);
  const at = (line: number) => offsets[line] ?? markdown.length;

  /** A name the PDF wrapped: `CfdiRelacionad` on one line, `os` at the start of the next. */
  const wrappedName = (name: string, line: number) => {
    let whole = name;
    for (let next = line + 1; next < lines.length; next += 1) {
      const text = lines[next]!;
      const fragment = NAME_FRAGMENT.exec(text)?.[0];
      if (!fragment) break;
      const alone = text.trim() === fragment && /^[a-z]/u.test(fragment);
      if (!options.vocabulary.has(whole + fragment) && !alone) break;
      whole += fragment;
    }
    return whole;
  };

  const nodeName = (rest: string, line: number) => {
    const first = rest.split(/\s+/u)[0]!.replace(/:$/u, "");
    if (first && !DESCRIPTION_START.has(first)) return wrappedName(first, line);
    const next = NAME_FRAGMENT.exec(lines[line + 1] ?? "")?.[0];
    return next && /^[A-Z]/u.test(next) ? wrappedName(next, line + 1) : "";
  };

  const boundaries: Boundary[] = [
    { offset: 0, label: options.title, anchor: "portada", whole: false },
  ];

  /** A part: one boundary at its heading, then one a node and one an attribute. */
  const part = (title: string, numeral: string, from: number, to: number) => {
    boundaries.push({ offset: at(from), label: title, anchor: `parte ${numeral}`, whole: false });
    let node = "";
    // A node defines each attribute once; a repeat (`Cantidad Valor unitario Importe`) is an
    // example table's header, and stays with the rule it illustrates.
    const attributes = new Set<string>();
    for (let line = from + 1; line < to; line += 1) {
      const text = lines[line]!;
      const nodeMatch = NODE.exec(text);
      if (nodeMatch) {
        node = `Nodo: ${nodeName(nodeMatch[1]!, line) || "(sin nombre)"}`;
        attributes.clear();
        boundaries.push({
          offset: at(line),
          label: `${title} › ${node}`,
          anchor: node,
          whole: false,
        });
        continue;
      }
      const attribute = ATTRIBUTE.exec(text);
      if (!attribute) continue;
      const name = wrappedName(attribute[1]!, line);
      if (attributes.has(name)) continue;
      attributes.add(name);
      const path = [node, name].filter(Boolean).join(" › ");
      boundaries.push({ offset: at(line), label: `${title} › ${path}`, anchor: path, whole: true });
    }
  };

  /** A questions-and-answers appendix: one boundary a question, numbered 1, 2, 3, …. */
  const questions = (title: string, anchor: string, from: number, to: number) => {
    boundaries.push({ offset: at(from), label: title, anchor, whole: false });
    let expected = 1;
    for (let line = from + 1; line < to; line += 1) {
      for (const match of lines[line]!.matchAll(QUESTION)) {
        if (Number(match[2]) !== expected) continue;
        const column = match.index + match[1]!.length;
        const offset = lines[line]!.slice(0, column).trim() ? at(line) + column : at(line);
        boundaries.push({
          offset,
          label: `${title} › Pregunta ${expected}`,
          anchor: `${anchor} › Pregunta ${expected}`,
          whole: false,
        });
        expected += 1;
      }
    }
  };

  const toc = tableOfContents(lines);
  const headings: Array<{ readonly line: number; readonly title: string }> = [];
  let searchFrom = toc.end;
  for (const entry of toc.entries) {
    const first = fold(entry.first);
    for (let line = searchFrom; line < lines.length; line += 1) {
      if (fold(lines[line]!).startsWith(first)) {
        headings.push({ line, title: entry.title });
        searchFrom = line + 1;
        break;
      }
    }
  }
  // A part the contents leave out (the Pagos guide lists only its Part I) starts at its own
  // `II. Guía de llenado…` line.
  for (const heading of headings.slice()) {
    const own = PART.exec(heading.title)?.[1];
    if (!own) continue;
    const end = headings.find((other) => other.line > heading.line)?.line ?? lines.length;
    for (let line = heading.line + 1; line < end; line += 1) {
      const numeral = PART_HEADING.exec(lines[line]!)?.[1];
      if (numeral && numeral !== own) headings.push({ line, title: lines[line]!.trim() });
    }
  }
  headings.sort((left, right) => left.line - right.line);
  if (headings.length === 0) {
    // No table of contents: the whole guide is one part.
    part(options.title, "I", 0, lines.length);
  }
  headings.forEach((heading, index) => {
    const to = headings[index + 1]?.line ?? lines.length;
    const numeral = PART.exec(heading.title)?.[1];
    const appendix = APPENDIX.exec(heading.title)?.[1];
    if (numeral) {
      part(heading.title, numeral, heading.line, to);
    } else if (appendix && QUESTIONS.test(heading.title)) {
      questions(heading.title, `Apéndice ${appendix}`, heading.line, to);
    } else {
      // `Control de cambios de la Guía de llenado…` keys as `control-de-cambios`.
      const anchor = appendix
        ? `Apéndice ${appendix}`
        : heading.title.split(" ").slice(0, 3).join(" ");
      boundaries.push({ offset: at(heading.line), label: heading.title, anchor, whole: false });
    }
  });

  return boundaries.flatMap((boundary, index) => {
    const end = boundaries[index + 1]?.offset ?? markdown.length;
    const parts = boundary.whole ? [[boundary.offset, end]] : cut(markdown, boundary.offset, end);
    return parts.flatMap(([from, to], part) => {
      const text = markdown.slice(from, to);
      if (!text.trim()) return [];
      const label =
        parts.length > 1
          ? `${boundary.label} (parte ${part + 1} de ${parts.length})`
          : boundary.label;
      return [{ label, anchor: boundary.anchor, text }];
    });
  });
}

/** `[from, to)` in parts of at most `SECTION_MAX_CHARS`, cut at a blank line, else a line end. */
function cut(markdown: string, from: number, to: number) {
  const parts: Array<[number, number]> = [];
  let start = from;
  while (to - start > SECTION_MAX_CHARS) {
    const limit = start + SECTION_MAX_CHARS;
    const floor = start + SECTION_MAX_CHARS / 2;
    const blank = markdown.lastIndexOf("\n\n", limit);
    const line = markdown.lastIndexOf("\n", limit);
    const end = blank > floor ? blank + 1 : line > start ? line + 1 : limit;
    parts.push([start, end]);
    start = end;
  }
  parts.push([start, to]);
  return parts;
}
