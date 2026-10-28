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
/** Nodes a guide repeats under several others, named under the one before them. */
const SUBNODES = new Set(["Domicilio"]);
/** Words a node's description starts with when the PDF put its name on the next line. */
const DESCRIPTION_START = new Set(["En", "Este", "Formato"]);
const NAME_FRAGMENT = /^[A-Za-z]+/u;
const PAGE_FOOTER = /^\d+ \/ \d+$/u;
const TOC_DOTS = /\s*\.{4,}.*$/u;
const PART = /^([IVX]+)\. /u;
const PART_HEADING = /^([IVX]+)\. Guía de llenado/u;
const APPENDIX = /^Apéndice (\d+)\b/u;
const QUESTIONS = /Preguntas (?:y respuestas|frecuentes)/u;
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
    /** The last node that is not a `Domicilio`: the party a `Domicilio` belongs to. */
    let owner = "";
    // A node defines each attribute once; a repeat (`Cantidad Valor unitario Importe`) is an
    // example table's header, and stays with the rule it illustrates.
    const attributes = new Set<string>();
    for (let line = from + 1; line < to; line += 1) {
      const text = lines[line]!;
      const nodeMatch = NODE.exec(text);
      if (nodeMatch) {
        const name = nodeName(nodeMatch[1]!, line) || "(sin nombre)";
        // The Comercio Exterior guide has a `Domicilio` under its Emisor, Receptor and
        // Destinatario: each is named under its own.
        node = SUBNODES.has(name) && owner ? `${owner} › Nodo: ${name}` : `Nodo: ${name}`;
        if (!SUBNODES.has(name)) owner = node;
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
      // The body may wrap a heading sooner than the contents do (`I. Guía de llenado… el
      // complemento` / `para comercio exterior`).
      const text = fold(lines[line]!);
      const wrapped = text && first.startsWith(text) && fold(lines.slice(line, line + 3).join(" "));
      if (text.startsWith(first) || (wrapped && wrapped.startsWith(first))) {
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

  return passagesOf(markdown, boundaries);
}

/**
 * `• Código postal (CodigoPostal): En este campo…`: a field of a Carta Porte instructivo. A few
 * name only the attribute (`• Eslora: En este campo…`).
 */
const FIELD = /^•\s+(.*?\(([A-Za-z][A-Za-z0-9]*)\))\s*:/u;
/** `Traslado`, `Retención`: the taxes a section of an instructivo lists the same fields for. */
const FIELD_GROUP = /^(Traslados?|Retenci(?:ón|ones))$/u;
const BARE_FIELD = /^•\s+(([A-Z][A-Za-z0-9]*)):\s+En este campo/u;
/** `2.2.1.1 Domicilio`, `1.2 Conceptos`, `1. Información del comprobante`. */
const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/u;
/** `CFDI de tipo ingreso con complemento Carta Porte`: a part of an instructivo. */
const INSTRUCTIVO_PART = /^CFDI de tipo (\S+)/u;
/** `Nota 8: Contenedores vacíos.`: a note of an appendix. */
const NOTE = /^Nota (\d+):/u;
/** The most lines a heading of an instructivo's contents wraps onto. */
const TOC_ENTRY_MAX_LINES = 2;

/**
 * A heading as its number and letters, so `1.2 Conceptos` and `1.2. Conceptos` agree, and so do
 * `1.2.1. Concepto` and the body's `1.2.1. C oncepto`.
 */
function headingKey(text: string) {
  const folded = fold(text);
  const numbered = NUMBERED.exec(folded);
  return (numbered ? `${numbered[1]} ${numbered[2]}` : folded).replaceAll(" ", "");
}

/**
 * Splits a Carta Porte instructivo (`Instructivo_ComplementoCartaPorte_*.pdf`), as `sat:knowledge`
 * converts it without its page furniture (`instructivoMarkdown`), into Códice's search passages.
 *
 * - The contents (`Índice`) name every heading: the introduction and background, the mode
 *   (`Transporte Marítimo`), the two parts (`CFDI de tipo ingreso con complemento Carta Porte`,
 *   `CFDI de tipo traslado…`), their numbered sections (`2.2.1.1 Domicilio`) and the appendices.
 *   Each is found in the body in that order, as a line (or up to three wrapped lines) that spells
 *   it.
 * - In a part, a passage starts at each numbered section and at each field
 *   (`• Código postal (CodigoPostal): …`) and runs to the next one, so a field keeps its examples
 *   and catalog table. A field's key is the part (`ingreso`, `traslado`), the sections under the
 *   first level (`Ubicaciones › Ubicación › Domicilio`) and the field's name.
 * - An appendix is one passage a note (`Nota 8: Contenedores vacíos.`) when it numbers them.
 * - Any other section, and the cover before the first, is cut at blank lines into parts of at most
 *   `SECTION_MAX_CHARS`.
 *
 * Every passage is a verbatim slice of the instructivo, and the slices cover it in order.
 */
export function instructivoSections(
  markdown: string,
  options: { readonly title: string },
): GuideSection[] {
  const lines = markdown.split("\n");
  const offsets: number[] = [];
  lines.reduce((offset, line) => {
    offsets.push(offset);
    return offset + line.length + 1;
  }, 0);
  const at = (line: number) => offsets[line] ?? markdown.length;

  // The contents: every line with a dot leader (`1.1. Receptor ..... 11`), and the line before it
  // when the title wrapped. They end at the first run of lines that is not an entry.
  const entries: string[] = [];
  let pending: string[] = [];
  let contentsEnd = 0;
  const first = lines.findIndex((line) => TOC_DOTS.test(line));
  for (let index = Math.max(first, 0); first !== -1 && index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    if (TOC_DOTS.test(line)) {
      entries.push([...pending, line.replace(TOC_DOTS, "")].join(" "));
      pending = [];
      contentsEnd = index + 1;
    } else if (pending.length < TOC_ENTRY_MAX_LINES - 1) {
      pending.push(line);
    } else {
      break;
    }
  }

  const headings: Array<{ readonly line: number; readonly title: string }> = [];
  let searchFrom = contentsEnd;
  for (const entry of entries) {
    const key = headingKey(entry);
    if (key === "índice") continue;
    for (let line = searchFrom; line < lines.length; line += 1) {
      if (!lines[line]!.trim()) continue;
      const spelled = [1, 2, 3].find(
        (count) => headingKey(lines.slice(line, line + count).join(" ")) === key,
      );
      if (spelled === undefined) continue;
      headings.push({ line, title: entry.replaceAll(/\s+/gu, " ").trim() });
      searchFrom = line + spelled;
      break;
    }
  }

  const boundaries: Boundary[] = [
    { offset: 0, label: options.title, anchor: "portada", whole: false },
  ];
  let part: { readonly title: string; readonly anchor: string } | null = null;
  /** The numbered headings above the current one, by level: `2.2`, `2.2.1`, …. */
  const numbered: string[] = [];
  headings.forEach((heading, index) => {
    const to = headings[index + 1]?.line ?? lines.length;
    const number = NUMBERED.exec(heading.title);
    const partName = INSTRUCTIVO_PART.exec(heading.title)?.[1];
    if (partName) part = { title: heading.title, anchor: partName };
    if (!number || !part) {
      if (!partName) part = null;
      numbered.length = 0;
      const appendix = APPENDIX.exec(heading.title)?.[1];
      const anchor = appendix
        ? `Apéndice ${appendix}`
        : (partName ?? heading.title.split(" ").slice(0, 3).join(" "));
      boundaries.push({ offset: at(heading.line), label: heading.title, anchor, whole: false });
      if (!appendix) return;
      let expected = 1;
      for (let line = heading.line + 1; line < to; line += 1) {
        if (Number(NOTE.exec(lines[line]!)?.[1]) !== expected) continue;
        boundaries.push({
          offset: at(line),
          label: `${heading.title} › Nota ${expected}`,
          anchor: `${anchor} › Nota ${expected}`,
          whole: false,
        });
        expected += 1;
      }
      return;
    }
    const level = number[1]!.split(".").length;
    numbered.length = level - 1;
    numbered[level - 1] = heading.title;
    const label = [part.title, ...numbered.filter(Boolean)].join(" › ");
    // The first level (`1. Información del comprobante`) names a section only when it is alone.
    const titles = numbered.filter(Boolean).map((title) => NUMBERED.exec(title)![2]!);
    const path = [part.anchor, ...(titles.length > 1 ? titles.slice(1) : titles)].join(" › ");
    boundaries.push({ offset: at(heading.line), label, anchor: path, whole: false });
    let group = "";
    for (let line = heading.line + 1; line < to; line += 1) {
      group = FIELD_GROUP.exec(lines[line]!.trim())?.[1] ?? group;
      // A label too long for its line puts the attribute on the next one.
      const text = `${lines[line]!} ${lines[line + 1] ?? ""}`;
      const field = FIELD.exec(text) ?? BARE_FIELD.exec(text);
      if (!field) continue;
      boundaries.push({
        offset: at(line),
        label: [label, group, field[1]!.replaceAll(/\s+/gu, " ")].filter(Boolean).join(" › "),
        anchor: [path, group, field[2]].filter(Boolean).join(" › "),
        whole: true,
      });
    }
  });

  return passagesOf(markdown, boundaries);
}

export type RmfRegla = {
  /** `2.7.1.21`. */
  readonly number: string;
  /** The heading path, such as `Título 2. … › Sección 2.7.1. … › Regla 2.7.1.21. Expedición…`. */
  readonly label: string;
  /** The compilation's text, verbatim: the SAT's amendment note, the title, the rule, its references. */
  readonly text: string;
  /** The DOF date of the version the text is, ISO: the last amendment's, else the RMF's own. */
  readonly publishedAt: string;
};

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
/** `28 de diciembre de 2025`, wherever the PDF broke its lines. */
const SPANISH_DATE = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/u;
const RMF_PUBLISHED = new RegExp(
  `Publicada\\s+en\\s+el\\s+Diario\\s+Oficial\\s+de\\s+la\\s+Federación\\s+el\\s+${SPANISH_DATE.source}`,
  "u",
);
const AMENDED = new RegExp(`DOF\\s+el\\s+${SPANISH_DATE.source}`, "gu");
/** `Capítulo 2.7. De los…`; a `Título` in the body reads `Título 2. Código…`. */
const RMF_HEADING = /^(Título|Capítulo|Sección|Subsección) (\d+(?:\.\d+)*)\.\s/u;
/** In the contents, the `Título` entries are `2. Código…` under one `Título` line. */
const RMF_TOC_TITLE = /^(\d+)\.\s/u;
/** `2.7.1.21. Para los efectos…`: a regla starts with its number and a capital. */
const REGLA = /^(\d{1,2}(?:\.\d{1,2}){1,4})\.\s+(?=[A-ZÁÉÍÓÚÑ¿“"])/u;
const REPEALED = /^\S+\s+Se deroga\./u;
const ACRONYM = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9-]+$/u;
const LOWERCASE = /^[a-záéíóúñ]/u;
/**
 * A line that ends the text above a regla's title: a sentence or list item (`…del CFF.`), the
 * references line (`CFF 27`, `LIF Vigésimo Quinto Transitorio, LISR 4, 170`, `CFF 29 Bis, RMF…`),
 * or a wrapped line of it (`4-A, 4-B, 28, 205`, `L, 84-N, 86, 86-B`, `…Valores, 12/01/2007`,
 * `Decretos 31/10/94 Cuarto`, `Comercio Marítimos 46`). A title line above the last never ends in
 * a period, colon, semicolon or number, never starts with a digit, and holds no date or list of
 * articles; one that starts with an acronym goes on in words (`CFDI que…`,
 * `CUFIN 2013 Integración por dividendos…`).
 */
function endsAboveTitle(line: string) {
  const text = line.trim();
  if (/[.;:\d]$/u.test(text) || /^\d/u.test(text)) return true;
  if (
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/u.test(text) ||
    /\d[\dA-Za-z-]*, \d[\dA-Za-z-]*, \d/u.test(text)
  ) {
    return true;
  }
  const [first = "", second = "", third = "", fourth = ""] = text.split(/\s+/u);
  if (!ACRONYM.test(first) || LOWERCASE.test(second)) return false;
  const words = /^\d[^,]*$/u.test(second) && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/u.test(third);
  return !(words && LOWERCASE.test(fourth));
}

/** The longest title a regla has is five lines; a longer run is the text above it. */
const TITLE_MAX_LINES = 6;
/** How far above a regla's number its note can start: the note's lines and the title's. */
const NOTE_MAX_LINES = 12;

/**
 * Whether heading `number` comes next after heading `current`: later in the numbering, under the
 * same Título or Capítulo (`11.18` after `11.17.2`, `2.7.2` after `2.7.1`).
 */
function follows(number: string, current: string) {
  const parts = number.split(".").map(Number);
  const now = current.split(".").map(Number);
  if (parts.length > 1 && parts.slice(0, -1).some((part, index) => part !== now[index])) {
    return false;
  }
  const index = parts.findIndex((part, at) => part !== now[at]);
  return index !== -1 && parts[index]! > (now[index] ?? 0);
}

/** `28 de diciembre de 2025` → `2025-12-28`. */
export function spanishDate(day: string, month: string, year: string) {
  const index = MONTHS.indexOf(month.toLowerCase());
  if (index === -1) throw new Error(`Not a month: ${month}`);
  return `${year}-${String(index + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Splits the SAT's compiled RMF, as `sat:knowledge` converts it, into one passage a regla.
 *
 * - The contents (`Contenido`) name each Título, Capítulo, Sección and Subsección in full; a body
 *   heading is the lines that spell its contents entry, so a heading the PDF wrapped
 *   (`Capítulo 11.17. Del Decreto…` / `de 2025`) is not read as a regla's title.
 * - A regla starts at its number (`2.7.1.21.`) under the heading it belongs to, numbered after the
 *   regla before it, so a reference that wrapped to a line start (`2.7.6.3. y, en su caso…`)
 *   starts nothing. Its passage starts at its title, the lines above the number back to the text
 *   above (`endsAboveTitle`), or at the SAT's note above the title (`Regla 2.1.6.` /
 *   `- Reformada en la Primera RMRMF para 2026, publicada en el DOF el 09 de julio de 2026.`). It
 *   runs to the next regla's passage, the next heading, or the transitorios.
 * - A regla's date is the last DOF date in its note, else the RMF's own publication date on the
 *   cover. A repealed regla (`2.12.4. Se deroga.`) has no passage.
 *
 * The glossary and the transitorios are not reglas and have no passage.
 */
export function rmfReglas(markdown: string): RmfRegla[] {
  const lines = markdown.split("\n");
  const offsets: number[] = [];
  lines.reduce((offset, line) => {
    offsets.push(offset);
    return offset + line.length + 1;
  }, 0);
  const at = (line: number) => offsets[line] ?? markdown.length;

  const cover = RMF_PUBLISHED.exec(markdown);
  if (!cover) throw new Error("The RMF's cover has no DOF publication date");
  const published = spanishDate(cover[1]!, cover[2]!, cover[3]!);

  // The contents, `Contenido` to the first `Transitorios`: each heading's whole title by kind and
  // number, such as `Capítulo 2.7` → `Capítulo 2.7. De los Comprobantes Fiscales Digitales…`.
  const contents = lines.findIndex((line) => line.trim() === "Contenido");
  const contentsEnd = lines.findIndex(
    (line, index) => index > contents && line.trim() === "Transitorios",
  );
  if (contents === -1 || contentsEnd === -1) throw new Error("The RMF has no contents");
  const titles = new Map<string, string>();
  let entry: { key: string; text: string } | null = null;
  for (const line of lines.slice(contents + 1, contentsEnd)) {
    const text = line.trim();
    if (!text) continue;
    const heading = RMF_HEADING.exec(text);
    const titulo = RMF_TOC_TITLE.exec(text);
    if (heading || titulo) {
      if (entry) titles.set(entry.key, entry.text);
      entry = heading
        ? { key: `${heading[1]} ${heading[2]}`, text }
        : { key: `Título ${titulo![1]}`, text: `Título ${text}` };
    } else if (entry && text !== "Título") {
      entry.text += ` ${text}`;
    }
  }
  if (entry) titles.set(entry.key, entry.text);

  // The body: from the first Título to the transitorios.
  const first = lines.findIndex(
    (line, index) => index > contentsEnd && line.startsWith("Título 1. "),
  );
  const last = lines.findLastIndex((line) => line.trim() === "Transitorios");
  if (first === -1 || last <= first) throw new Error("The RMF has no Título 1 or no transitorios");

  type Heading = { readonly line: number; readonly end: number; readonly number: string };
  type Start = { readonly line: number; readonly number: string; readonly path: string[] };
  const headings: Heading[] = [];
  const starts: Start[] = [];
  const path: string[] = [];
  const latest = new Map<string, number>();
  let current = "";
  for (let line = first; line < last; line += 1) {
    const text = lines[line]!.trim();
    const heading = RMF_HEADING.exec(text);
    const title = heading ? titles.get(`${heading[1]} ${heading[2]}`) : undefined;
    const listed = title !== undefined && fold(title).startsWith(fold(text));
    // A heading the contents leave out or spell otherwise (`Capítulo 11.18.`, added by an
    // amendment): one that names itself in capitals and comes next in the numbering.
    if (heading && (listed || (/\.\s+[A-ZÁÉÍÓÚÑ]/u.test(text) && follows(heading[2]!, current)))) {
      // The heading's own lines: as many as spell its contents entry, else the lowercase lines
      // that go on from it (`Capítulo 11.18. Del Decreto…` / `cinematográfica y audiovisual…`).
      let end = line + 1;
      let spelled = text;
      while (end < last && !(listed && fold(spelled) === fold(title))) {
        const next = `${spelled} ${lines[end]!.trim()}`;
        const goesOn = listed
          ? fold(title).startsWith(fold(next))
          : LOWERCASE.test(lines[end]!.trim());
        if (!goesOn) break;
        spelled = next;
        end += 1;
      }
      // The SAT's note above a heading an amendment added: `Capítulo 11.18.`, `-Adicionado…`.
      let from = line;
      for (let above = line - 1; above >= Math.max(first, line - 4); above -= 1) {
        if (lines[above]!.trim() === `${heading[1]} ${heading[2]}.`) from = above;
      }
      current = heading[2]!;
      path.splice(
        current.split(".").length - 1,
        Infinity,
        (listed ? title : spelled).replaceAll(/\s+/gu, " "),
      );
      headings.push({ line: from, end, number: current });
      line = end - 1;
      continue;
    }
    const regla = REGLA.exec(text)?.[1];
    if (!regla) continue;
    const parent = regla.slice(0, regla.lastIndexOf("."));
    const index = Number(regla.slice(regla.lastIndexOf(".") + 1));
    if (parent !== current || index <= (latest.get(parent) ?? 0)) continue;
    latest.set(parent, index);
    starts.push({ line, number: regla, path: [...path] });
  }

  const headingLines = new Set(
    headings.flatMap((heading) =>
      Array.from({ length: heading.end - heading.line }, (_, offset) => heading.line + offset),
    ),
  );
  const titleOf = (from: number, to: number) =>
    lines
      .slice(from, to)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
  const passages = starts.map((start) => {
    // An amended regla has the SAT's note above its title: `Regla 2.1.6.`, then `- Reformada…`
    // lines to the first that ends a sentence. The title is what lies between it and the number.
    for (
      let line = start.line - 1;
      line >= Math.max(first, start.line - NOTE_MAX_LINES);
      line -= 1
    ) {
      if (headingLines.has(line)) break;
      if (lines[line]!.trim() !== `Regla ${start.number}.`) continue;
      let end = line + 1;
      while (end < start.line && !lines[end]!.trim().endsWith(".")) end += 1;
      return {
        ...start,
        from: line,
        title: titleOf(end + 1, start.line),
        note: lines.slice(line, end + 1).join(" "),
      };
    }
    // Else the title is the lines above the number, back to the text above it. A blank line is
    // where a page broke, and the title goes on above it. Every regla has a title, so the line
    // right above the number is one even when it is a lone acronym (`…de expedición de` / `CFDI`)
    // or ends in a regla's number (`…a que se refiere la regla 3.18.21.`).
    let top = start.line;
    let above = top - 1;
    const skipBlank = () => {
      while (above > first && !lines[above]!.trim()) above -= 1;
    };
    skipBlank();
    while (
      above > first &&
      start.line - above <= TITLE_MAX_LINES &&
      !headingLines.has(above) &&
      (top === start.line || !endsAboveTitle(lines[above]!))
    ) {
      top = above;
      above -= 1;
      skipBlank();
    }
    // A title starts with a capital: a lowercase line on top is the wrapped end of the references.
    while (top < start.line - 1 && (!lines[top]!.trim() || LOWERCASE.test(lines[top]!.trim()))) {
      top += 1;
    }
    return { ...start, from: top, title: titleOf(top, start.line), note: "" };
  });

  const boundaries = [
    ...passages.map((passage) => passage.from),
    ...headings.map((heading) => heading.line),
    last,
  ].sort((left, right) => left - right);
  return passages.flatMap((passage) => {
    const end = boundaries.find((boundary) => boundary > passage.from) ?? last;
    const text = markdown.slice(at(passage.from), at(end));
    if (REPEALED.test(lines[passage.line]!.trim())) return [];
    const amended = [...passage.note.matchAll(AMENDED)].map((match) =>
      spanishDate(match[1]!, match[2]!, match[3]!),
    );
    return [
      {
        number: passage.number,
        label: [...passage.path, `Regla ${passage.number}. ${passage.title}`.trim()].join(" › "),
        text,
        publishedAt: [published, ...amended].sort().at(-1)!,
      },
    ];
  });
}

/** The passages between boundaries: a whole rule as is, anything else cut into numbered parts. */
function passagesOf(markdown: string, boundaries: readonly Boundary[]): GuideSection[] {
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
