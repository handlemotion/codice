/**
 * Pure parsing and rendering for `sat-knowledge.ts`: the SAT's spreadsheets (as LibreOffice CSV)
 * become typed records and the Markdown documents Códice ingests.
 */
import {
  catalogEntryKey,
  errorCodeRow,
  markdownTableRow,
  type SatCatalog,
  type SatCatalogSet,
  type SatErrorCode,
  type SatErrorMatrix,
  type SatSource,
} from "./sat-records";

/** RFC 4180 CSV: quoted fields may hold commas, quotes (doubled), and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function clean(value: string | undefined) {
  return (value ?? "").replaceAll(/[ \t]+/gu, " ").trim();
}

/**
 * The sheets' dates to ISO; `0` is none. LibreOffice shows a date cell month first and unpadded
 * (`12/31/2025`, `1/7/2019`); a date the SAT typed as text is day first and padded (`31/07/2026`,
 * `01/07/2026` in c_NumPedimentoAduana), told apart by a leading zero or a first part over 12.
 */
export function sheetDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0") return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(trimmed);
  if (!match) return trimmed;
  if (/^0|\/0/u.test(trimmed) || Number(match[1]) > 12) {
    return `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  }
  return `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
}

/** The `Versión CFDI, Versión catálogo, …` block above a catalog's table. */
function versionBlock(rows: readonly (readonly string[])[]) {
  const header = rows.findIndex((row) => clean(row[0]).startsWith("Versión CFDI"));
  const version: Record<string, string | null> = {};
  if (header === -1) return version;
  rows[header]!.forEach((label, index) => {
    const name = clean(label);
    if (!name) return;
    const value = clean(rows[header + 1]?.[index]);
    version[name] = name.startsWith("Fecha") ? sheetDate(value) : value || null;
  });
  return version;
}

/**
 * One catalog sheet. Its header row holds the catalog's own name (`c_RegimenFiscal`); a second
 * header row under it, with an empty first cell, names grouped columns (Física, Moral; Valor
 * mínimo, Valor máximo), and wins where both name a column. A catalog with no column of its own
 * name (c_NumPedimentoAduana) passes the headers of the columns that together key a row.
 */
export function parseCatalogSheet(
  name: string,
  rows: readonly (readonly string[])[],
  keyHeaders: readonly string[] = [name],
): SatCatalog {
  const isHeader = (cell: string | undefined, label: string) =>
    clean(cell).toLowerCase() === label.toLowerCase();
  const headerIndex = rows.findIndex((row) => row.some((cell) => isHeader(cell, keyHeaders[0]!)));
  if (headerIndex === -1) throw new Error(`${name}: no header row names the catalog`);
  const header = rows[headerIndex]!;
  const keyColumns = keyHeaders.map((label) => {
    const index = header.findIndex((cell) => isHeader(cell, label));
    if (index === -1) throw new Error(`${name}: no ${label} column`);
    return index;
  });
  const keyColumn = keyColumns[0]!;
  const next = rows[headerIndex + 1];
  const subHeader = next && !clean(next[0]) && next.some((cell) => clean(cell)) ? next : null;
  const labels = header.map((cell, index) => clean(subHeader?.[index]) || clean(cell));
  const width = labels.reduce((last, label, index) => (label ? index + 1 : last), 0);
  // A header the SAT merged over two cells (c_TipoDeComprobante's Valor máximo: NS, NdS) names
  // the second one too; a label the SAT repeats (c_CodigoPostal's Día_Inicio_Horario_Verano)
  // takes its count, so each column keeps its own field.
  const seen = new Map<string, number>();
  const columns = labels
    .slice(0, width)
    .map((label, index, all) => label || (index > 0 ? `${all[index - 1]} (2)` : ""))
    .map((label) => {
      const count = (seen.get(label) ?? 0) + 1;
      seen.set(label, count);
      return label && count > 1 ? `${label} (${count})` : label;
    });
  const title =
    rows
      .slice(0, headerIndex)
      .map((row) => clean(row.find((cell) => clean(cell))))
      .find((text) => text && !text.startsWith("Versión CFDI")) ?? name;
  const catalog: SatCatalog = {
    name,
    title,
    version: versionBlock(rows.slice(0, headerIndex)),
    columns,
    keyColumn,
    ...(keyColumns.length > 1 ? { keyColumns } : {}),
    rows: [],
  };
  // Dates: `Fecha …` columns, and c_PatenteAduanal's `Inicio/Fin de vigencia de la patente`.
  const dateColumns = new Set(
    columns.flatMap((column, index) => (/^Fecha|de vigencia/iu.test(column) ? [index] : [])),
  );
  const data = rows
    .slice(headerIndex + (subHeader ? 2 : 1))
    .map((row) =>
      columns.map((_, index) => {
        const value = clean(row[index]);
        return dateColumns.has(index) ? (sheetDate(value) ?? "") : value;
      }),
    )
    .filter((row) => catalogEntryKey(catalog, row));
  return { ...catalog, rows: data };
}

/** The codes the SAT's catCFDI.xsd allows for a catalog, or null when the XSD has no such type. */
export function xsdCatalogCodes(xsd: string, name: string): string[] | null {
  const type = new RegExp(`<xs:simpleType name="${name}">([\\s\\S]*?)</xs:simpleType>`, "u").exec(
    xsd,
  );
  if (!type) return null;
  return [...type[1]!.matchAll(/<xs:enumeration value="([^"]*)"/gu)].map((match) => match[1]!);
}

/** Keys a sheet and its XSD type disagree on; both are the SAT's, so a difference is reported. */
export function catalogXsdDifferences(catalog: SatCatalog, codes: readonly string[]) {
  const keys = new Set(catalog.rows.map((row) => catalogEntryKey(catalog, row)));
  const allowed = new Set(codes);
  return {
    missingFromSheet: codes.filter((code) => !keys.has(code)),
    missingFromXsd: [...keys].filter((key) => !allowed.has(key)),
  };
}

/** The matrix sheet: `NÚM, ELEMENTO, ATRIBUTO, VALIDACIÓN, CÓDIGO ERROR, DESCRIPCIÓN…`. */
export function parseErrorMatrix(rows: readonly (readonly string[])[]): {
  title: string;
  codes: SatErrorCode[];
} {
  const headerIndex = rows.findIndex((row) => clean(row[0]).toUpperCase() === "NÚM");
  if (headerIndex === -1) throw new Error("Error matrix: no NÚM header row");
  const title =
    clean(
      rows
        .slice(0, headerIndex)
        .flat()
        .find((cell) => clean(cell)),
    ) || "";
  const codes = rows
    .slice(headerIndex + 1)
    .map((row) => row.map((cell) => clean(cell.replaceAll(/\s*\n\s*/gu, " "))))
    .filter((row) => row[4])
    .map(([number, element, attribute, validation, code, message]) => ({
      number: number ?? "",
      element: element ?? "",
      attribute: attribute ?? "",
      validation: validation ?? "",
      code: code ?? "",
      message: message ?? "",
    }));
  return { title, codes };
}

export type ProvenanceInput = {
  readonly source: SatSource;
  /** Such as `XLS, SAT file dated 2026-10-15`. */
  readonly format: string;
};

/** The first line of the note the SAT prints at the foot of every page of a compiled RMF. */
const COMPILATION_NOTE = "NOTA: Este documento constituye una compilación";
const COMPILATION_NOTE_LINES = 3;
const PAGE_NUMBER = /^Página \d+ de \d+$/u;

/**
 * A compiled RMF as MarkItDown converts it, without its page furniture: the three-line note that
 * every page repeats is kept once, where it first appears, and the `Página 22 de 857` lines go.
 * A regla that runs across a page then reads as one text.
 */
export function rmfCompilationMarkdown(converted: string) {
  const lines = converted.split("\n");
  const kept: string[] = [];
  let noted = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith(COMPILATION_NOTE)) {
      if (!noted) kept.push(...lines.slice(index, index + COMPILATION_NOTE_LINES));
      noted = true;
      index += COMPILATION_NOTE_LINES - 1;
      continue;
    }
    if (!PAGE_NUMBER.test(line.trim())) kept.push(line);
  }
  return kept.join("\n");
}

/**
 * The title a Carta Porte instructivo prints at the top of every page: the section the page is in,
 * on up to three lines (`CFDI de tipo ingreso` / `con complemento` / `Carta Porte`).
 */
const RUNNING_HEADER =
  /^(?:Índice|Introducción|Antecedentes|Marco jurídico|Autotransporte|Transporte (?:marítimo|aéreo|ferroviario)|CFDI de tipo (?:ingreso|traslado) con complemento Carta Porte|Apéndices)$/iu;
const RUNNING_HEADER_MAX_LINES = 3;

/**
 * A Carta Porte instructivo as MarkItDown converts it, without its page furniture: each
 * `Página 12 de 106` line goes, and so does the running header at the top of the next page. The
 * blank line where the page broke stays. A field that runs across a page then reads as one text.
 */
export function instructivoMarkdown(converted: string) {
  const lines = converted.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!PAGE_NUMBER.test(lines[index]!.trim())) {
      kept.push(lines[index]!);
      continue;
    }
    let next = index + 1;
    while (next < lines.length && !lines[next]!.trim()) next += 1;
    kept.push(...lines.slice(index + 1, next));
    for (let count = 1; count <= RUNNING_HEADER_MAX_LINES; count += 1) {
      const header = lines.slice(next, next + count).map((line) => line.trim());
      if (RUNNING_HEADER.test(header.join(" "))) {
        next += count;
        break;
      }
    }
    index = next - 1;
  }
  return kept.join("\n");
}

/** The header every generated SAT document starts with. */
export function provenanceHeader(input: ProvenanceInput) {
  return [
    `> **Source:** <${input.source.url}>`,
    `> **Format:** ${input.format}`,
    `> **Retrieved:** ${input.source.retrievedAt} · **SHA-256 of the original:** \`${input.source.sha256}\``,
    ">",
    "> Generated by `pnpm --filter @codice/api sat:knowledge` from the SAT's file; do not",
    "> edit by hand. The SAT's file is authoritative: re-check it before relying on a rule for a",
    "> production fiscal decision. See [README](./README.md).",
  ].join("\n");
}

function table(columns: readonly string[], rows: readonly (readonly string[])[]) {
  return [
    markdownTableRow(columns),
    markdownTableRow(columns.map(() => "---")),
    ...rows.map(markdownTableRow),
  ].join("\n");
}

const ERROR_COLUMNS = ["Código", "Atributo", "Validación", "Mensaje"];

/** The matrix as one section per node, each with its own table header. */
export function renderErrorMatrix(matrix: SatErrorMatrix) {
  const sections: Array<{ element: string; codes: SatErrorCode[] }> = [];
  for (const code of matrix.codes) {
    const last = sections.at(-1);
    if (last?.element === code.element) last.codes.push(code);
    else sections.push({ element: code.element, codes: [code] });
  }
  return [
    "# Matriz de códigos de error del CFDI 4.0 (validations CFDI40xxx)",
    "",
    provenanceHeader({
      source: matrix.source,
      format: `XLS, SAT file dated ${matrix.source.publishedAt ?? "unknown"}; ${matrix.title}`,
    }),
    "",
    "---",
    ...sections.flatMap((section) => [
      "",
      `## ${section.element}`,
      "",
      table(ERROR_COLUMNS, section.codes.map(errorCodeRow)),
    ]),
    "",
  ].join("\n");
}

/** A catalog's heading line; its rows follow it. */
export function catalogHeading(catalog: SatCatalog) {
  return `## ${catalog.name}`;
}

function versionLine(catalog: SatCatalog) {
  const parts = Object.entries(catalog.version)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  return parts.length > 0 ? parts.join(" · ") : "";
}

/** Every catalog as its own section: title, version block, and the whole table. */
export function renderCatalogs(set: SatCatalogSet) {
  return [
    "# Catálogos del CFDI 4.0 (catCFDI)",
    "",
    provenanceHeader({
      source: set.source,
      format: `XLS, SAT file dated ${set.source.publishedAt ?? "unknown"}; sheets ${set.catalogs.map((catalog) => catalog.name).join(", ")}`,
    }),
    "",
    "---",
    ...set.catalogs.flatMap((catalog) => [
      "",
      catalogHeading(catalog),
      "",
      catalog.title,
      ...(versionLine(catalog) ? ["", versionLine(catalog)] : []),
      "",
      table(catalog.columns, catalog.rows),
    ]),
    "",
  ].join("\n");
}
