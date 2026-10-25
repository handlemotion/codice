/**
 * The SAT's structured rules: every CFDI40xxx row of the error matrix and the catCFDI catalogs
 * (c_RegimenFiscal, c_UsoCFDI, …), parsed from the SAT's own spreadsheets by
 * `sat-knowledge.ts` into `docs/sat-md/*.json`, which the ingestion loads into D1 for the exact
 * lookups (`/v1/errors/:code`, `/v1/catalogs/:name`).
 */

/**
 * The catalogs the corpus holds: those the CFDI's header, Receptor, tax, and payment fields use.
 * The large ones (c_ClaveProdServ, c_ClaveUnidad, c_CodigoPostal, c_Colonia, c_Localidad,
 * c_Municipio, c_NumPedimentoAduana, c_PatenteAduanal) come later (SPEC.md, "Next steps").
 */
export const SAT_CORPUS_CATALOGS = [
  "c_RegimenFiscal",
  "c_UsoCFDI",
  "c_FormaPago",
  "c_MetodoPago",
  "c_TipoDeComprobante",
  "c_Exportacion",
  "c_Moneda",
  "c_Pais",
  "c_Estado",
  "c_ObjetoImp",
  "c_Impuesto",
  "c_TipoFactor",
  "c_TasaOCuota",
  "c_TipoRelacion",
  "c_Periodicidad",
  "c_Meses",
  "c_Aduana",
] as const;

/** Where a set came from: the SAT file, its hash, and the dates that version it. */
export type SatSource = {
  readonly url: string;
  readonly sha256: string;
  /** The date the SAT published this file (its file name or PDF date), ISO. */
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
};

export type SatErrorCode = {
  readonly number: string;
  /** The node, such as `cfdi:Receptor`, as the matrix names it. */
  readonly element: string;
  readonly attribute: string;
  readonly validation: string;
  /** As published; six SAT rows read `CFDI140223`… for what look like CFDI40223…. */
  readonly code: string;
  readonly message: string;
};

export type SatErrorMatrix = {
  readonly source: SatSource;
  readonly title: string;
  readonly codes: readonly SatErrorCode[];
};

export type SatCatalog = {
  /** The catalog's own name, such as `c_RegimenFiscal`. */
  readonly name: string;
  readonly title: string;
  /** The sheet's version block: Versión catálogo, Revisión, publication and validity dates. */
  readonly version: Readonly<Record<string, string | null>>;
  readonly columns: readonly string[];
  /** The column that holds each entry's key, such as `601`. */
  readonly keyColumn: number;
  /**
   * For a catalog with no key column of its own (c_NumPedimentoAduana), the columns whose cells,
   * joined with `-`, key a row: `01-3173-2007` for c_Aduana, Patente, Ejercicio.
   */
  readonly keyColumns?: readonly number[];
  readonly rows: readonly (readonly string[])[];
};

export type SatCatalogSet = {
  readonly source: SatSource;
  readonly catalogs: readonly SatCatalog[];
};

export type SatRecords = {
  readonly errorMatrix: SatErrorMatrix;
  readonly catalogs: SatCatalogSet;
};

/** A row's key: its key column, or the next cell of a merged key header (c_TasaOCuota). */
export function catalogEntryKey(catalog: SatCatalog, row: readonly string[]) {
  if (catalog.keyColumns) {
    const cells = catalog.keyColumns.map((column) => row[column] ?? "");
    return cells.every(Boolean) ? cells.join("-") : "";
  }
  return row[catalog.keyColumn] || row[catalog.keyColumn + 1] || "";
}

/** An entry as named fields, without the empty ones. */
export function catalogEntryFields(catalog: SatCatalog, row: readonly string[]) {
  const fields: Record<string, string> = {};
  catalog.columns.forEach((column, index) => {
    const value = row[index];
    if (column && value) fields[column] = value;
  });
  return fields;
}

/** The matrix row as its Markdown table shows it: code, attribute, validation, message. */
export function errorCodeRow(code: SatErrorCode) {
  return [code.code, code.attribute, code.validation, code.message];
}

/** One Markdown table row; the renderer and the line lookup share it, so they always agree. */
export function markdownTableRow(cells: readonly string[]) {
  const escaped = cells.map((cell) =>
    cell
      .replaceAll("\\", "\\\\")
      .replaceAll("|", "\\|")
      .replaceAll(/\s*\n\s*/gu, " ")
      .trim(),
  );
  return `| ${escaped.join(" | ")} |`;
}
