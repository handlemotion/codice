/**
 * The catCFDI catalogs too large for `docs/sat-md` (SPEC.md, "Records
 * and provenance"). The ingestion reads them from the same `catCFDI_V_4_*.xls` the small catalogs
 * come from, parses them with `parseCatalogSheet`, and loads them straight into D1. Pure:
 * `ingest.ts` does the download and the conversion.
 */
import { parseCatalogSheet } from "./sat-knowledge-render";
import type { SatCatalog } from "./sat-records";

type LargeCatalog = {
  readonly name: string;
  /** The headers of the columns that key a row, when no column has the catalog's name. */
  readonly keyHeaders?: readonly string[];
};

export const LARGE_CATALOGS = [
  { name: "c_ClaveProdServ" },
  { name: "c_ClaveUnidad" },
  { name: "c_CodigoPostal" },
  { name: "c_Colonia" },
  { name: "c_Localidad" },
  { name: "c_Municipio" },
  // One row per customs office, patent and year: the parts of a pedimento number the SAT checks.
  { name: "c_NumPedimentoAduana", keyHeaders: ["c_Aduana", "Patente", "Ejercicio"] },
  { name: "c_PatenteAduanal" },
] as const satisfies readonly LargeCatalog[];

export const LARGE_CATALOG_NAMES: readonly string[] = LARGE_CATALOGS.map((catalog) => catalog.name);

/**
 * A catalog's sheets, in order. The SAT splits the longest across several (`c_CodigoPostal_Parte_1`,
 * `C_Colonia_3`) and capitalizes some names (`C_Municipio`).
 */
export function catalogSheetNames(name: string, sheetNames: Iterable<string>) {
  const pattern = new RegExp(`^${name}(?:_Parte)?(?:_(\\d+))?$`, "iu");
  return [...sheetNames]
    .map((sheet) => ({ sheet, part: pattern.exec(sheet) }))
    .filter((entry) => entry.part)
    .sort((left, right) => Number(left.part![1] ?? 0) - Number(right.part![1] ?? 0))
    .map((entry) => entry.sheet);
}

/** Every large catalog, its parts merged into one; parts must share their columns. */
export function parseLargeCatalogs(
  workbook: ReadonlyMap<string, readonly (readonly string[])[]>,
): SatCatalog[] {
  return LARGE_CATALOGS.map((spec: LargeCatalog) => {
    const sheets = catalogSheetNames(spec.name, workbook.keys());
    if (sheets.length === 0) throw new Error(`catCFDI has no sheet ${spec.name}`);
    const parts = sheets.map((sheet) =>
      parseCatalogSheet(spec.name, workbook.get(sheet)!, spec.keyHeaders),
    );
    const [first] = parts;
    for (const [index, part] of parts.entries()) {
      if (JSON.stringify(part.columns) !== JSON.stringify(first!.columns)) {
        throw new Error(`${sheets[index]}: columns differ from ${sheets[0]}`);
      }
    }
    return { ...first!, rows: parts.flatMap((part) => part.rows) };
  });
}
