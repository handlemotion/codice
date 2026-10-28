import { describe, expect, it } from "vitest";

import { parseCsv } from "../scripts/sat-knowledge-render";
import type { SatSource } from "../scripts/sat-records";
import {
  catalogEntryRows,
  type CatalogEntryRow,
  type Corpus,
  type SourceRow,
} from "../scripts/corpus";
import {
  catalogSheetNames,
  LARGE_CATALOG_NAMES,
  parseLargeCatalogs,
} from "../scripts/large-catalogs";
import {
  DELETE_ROWS_MAX,
  FILE_BYTES_MAX,
  insertStatements,
  largeCatalogFiles,
  recordsSql,
  sqlFiles,
  STATEMENT_BYTES_MAX,
} from "../scripts/records-sql";

const SOURCE: SatSource = {
  url: "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/catCFDI_V_4_20261015.xls",
  sha256: "fde78b456d1e0d90366bfc68f8312f9edce5703ad5dc8ccebf09c462db13a079",
  publishedAt: "2026-10-15",
  retrievedAt: "2026-10-21",
};

const SOURCE_ROW: SourceRow = {
  id: "catalogos-cfdi-40",
  title: "Catálogos del CFDI 4.0 (catCFDI)",
  authority: "SAT",
  url: SOURCE.url,
  sha256: SOURCE.sha256,
  publishedAt: SOURCE.publishedAt,
  retrievedAt: SOURCE.retrievedAt,
  validFrom: 20261015,
  validUntil: 99991231,
};

const POSTAL_HEADER = `Catálogo de códigos postales.,,,,,
Versión CFDI,Versión catálogo,Revisión catálogo,Fecha publicación de catálogo,Fecha  inicio de vigencia del catálogo,
4.0,1.0,8,1/22/2026,1/1/2022,
c_CodigoPostal,c_Estado,c_Municipio,c_Localidad,Fecha inicio de vigencia ,Fecha fin de vigencia `;

/** One sheet per large catalog, with c_CodigoPostal and c_Colonia split as the SAT splits them. */
function workbook(): Map<string, string[][]> {
  const sheets: Record<string, string> = {
    c_CodigoPostal_Parte_2: `${POSTAL_HEADER}\n99999,YUC,050,,1/1/2022,\n`,
    c_CodigoPostal_Parte_1: `${POSTAL_HEADER}\n01000,CMX,010,01,1/7/2019,\n01010,CMX,010,01,1/1/2022,\n`,
    C_Colonia_1: "c_Colonia,c_CodigoPostal,Nombre del asentamiento\n0001,01000,San Ángel\n",
    C_Colonia_2:
      "c_Colonia,c_CodigoPostal,Nombre del asentamiento\n0001,16514,Tetitla la Gallera\n",
    c_ClaveProdServ:
      "c_ClaveProdServ,Descripción,FechaInicioVigencia\n01010101,No existe en el catálogo,1/1/2022\n",
    c_ClaveUnidad: "c_ClaveUnidad,Nombre,Fecha de inicio de vigencia\nH87,Pieza,1/1/2022\n",
    C_Localidad:
      "c_Localidad,c_Estado,Descripción,Fecha de inicio de vigencia\n01,AGU,Aguascalientes,1/1/2022\n",
    C_Municipio:
      "c_Municipio,c_Estado,Descripción,Fecha de inicio de vigencia\n001,AGU,Aguascalientes,1/1/2022\n",
    c_NumPedimentoAduana: `Catálogo de números de pedimento operados por aduana y ejercicio.,,,,,
Versión CFDI,Versión catálogo,Revisión catálogo,Fecha publicación de catálogo,Fecha  inicio de vigencia del catálogo,
4.0,126.0,0,15/10/2026,01/01/2022,
c_Aduana,Patente,Ejercicio,Cantidad,Fecha inicio de vigencia,Fecha fin de vigencia
16,2069,2026,999999,31/07/2026,
`,
    c_PatenteAduanal:
      "C_PatenteAduanal,Inicio de vigencia de la patente,Fin de vigencia de la patente\n0074,7/3/2001,\n",
    c_UsoCFDI: "c_UsoCFDI,Descripción\nS01,Sin efectos fiscales.\n",
  };
  return new Map(Object.entries(sheets).map(([name, csv]) => [name, parseCsv(csv)]));
}

function entry(catalog: string, key: string, fields: Record<string, string>): CatalogEntryRow {
  return {
    catalog,
    key,
    sourceId: SOURCE_ROW.id,
    fields,
    validFrom: 20220101,
    validUntil: 99991231,
  };
}

describe("parseLargeCatalogs", () => {
  it("finds a catalog's sheets in part order, in any case", () => {
    const names = [
      "C_Colonia_2",
      "c_CodigoPostal_Parte_2",
      "C_Colonia_1",
      "c_CodigoPostal_Parte_1",
    ];
    expect(catalogSheetNames("c_Colonia", names)).toEqual(["C_Colonia_1", "C_Colonia_2"]);
    expect(catalogSheetNames("c_CodigoPostal", names)).toEqual([
      "c_CodigoPostal_Parte_1",
      "c_CodigoPostal_Parte_2",
    ]);
    expect(catalogSheetNames("c_Municipio", ["C_Municipio", "c_Moneda"])).toEqual(["C_Municipio"]);
  });

  it("merges a split catalog in sheet order and keeps the SAT's codes and dates", () => {
    const catalogs = parseLargeCatalogs(workbook());
    expect(catalogs.map((catalog) => catalog.name)).toEqual(LARGE_CATALOG_NAMES);
    const rows = catalogEntryRows({ source: SOURCE, catalogs });
    const postal = rows.filter((row) => row.catalog === "c_CodigoPostal");
    expect(postal.map((row) => row.key)).toEqual(["01000", "01010", "99999"]);
    expect(postal[0]).toEqual({
      catalog: "c_CodigoPostal",
      key: "01000",
      sourceId: "catalogos-cfdi-40",
      fields: {
        c_CodigoPostal: "01000",
        c_Estado: "CMX",
        c_Municipio: "010",
        c_Localidad: "01",
        "Fecha inicio de vigencia": "2019-01-07",
      },
      validFrom: 20190107,
      validUntil: 99991231,
    });
    expect(rows.filter((row) => row.catalog === "c_Colonia").map((row) => row.key)).toEqual([
      "0001",
      "0001",
    ]);
    expect(rows.find((row) => row.catalog === "c_NumPedimentoAduana")).toMatchObject({
      key: "16-2069-2026",
      validFrom: 20260731,
    });
    expect(rows.find((row) => row.catalog === "c_PatenteAduanal")).toMatchObject({
      key: "0074",
      validFrom: 20010703,
    });
  });

  it("refuses parts whose columns differ, and a catalog with no sheet", () => {
    const split = workbook();
    split.set("C_Colonia_2", parseCsv("c_Colonia,c_CodigoPostal\n0001,16514\n"));
    expect(() => parseLargeCatalogs(split)).toThrow(/C_Colonia_2: columns differ/u);
    const missing = workbook();
    missing.delete("c_ClaveUnidad");
    expect(() => parseLargeCatalogs(missing)).toThrow(/no sheet c_ClaveUnidad/u);
  });

  it("refuses a date it cannot read instead of storing a wrong validity", () => {
    const [catalog] = parseLargeCatalogs(workbook());
    const broken = { ...catalog!, rows: [["01010101", "No existe", "2026-31-07"]] };
    expect(() => catalogEntryRows({ source: SOURCE, catalogs: [broken] })).toThrow(
      /c_ClaveProdServ 01010101: no date in "2026-31-07"/u,
    );
    for (const value of ["2026-02-31", "2026-07-31x"]) {
      const bad = { ...catalog!, rows: [["01010101", "No existe", value]] };
      expect(() => catalogEntryRows({ source: SOURCE, catalogs: [bad] })).toThrow(/no date in/u);
    }
  });
});

describe("D1 batches", () => {
  const rows = Array.from({ length: 10_000 }, (_, index) =>
    entry("c_CodigoPostal", String(index).padStart(5, "0"), {
      c_CodigoPostal: String(index).padStart(5, "0"),
      "Descripción del Huso Horario": "Tiempo del Centro, l'été",
    }),
  );

  it("keeps every statement under D1's limit and every row in order, once", () => {
    const statements = insertStatements(
      "catalog_entries",
      ["catalog", "key"],
      rows.map((row) => [row.catalog, row.key]),
    );
    expect(statements.length).toBeGreaterThan(1);
    for (const statement of statements) {
      expect(Buffer.byteLength(statement)).toBeLessThanOrEqual(STATEMENT_BYTES_MAX);
    }
    const keys = statements.join("\n").match(/'\d{5}'/gu)!;
    expect(keys).toEqual(rows.map((row) => `'${row.key}'`));
  });

  it("escapes quotes and writes NULL", () => {
    expect(insertStatements("t", ["a", "b", "c"], [["l'été", null, 1]])).toEqual([
      "INSERT INTO t (a, b, c) VALUES ('l''été', NULL, 1);",
    ]);
  });

  it("groups statements into files under the import size", () => {
    const statement = `SELECT '${"x".repeat(STATEMENT_BYTES_MAX - 20)}';`;
    const files = sqlFiles(Array.from({ length: 200 }, () => statement));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) expect(Buffer.byteLength(file)).toBeLessThanOrEqual(FILE_BYTES_MAX);
    expect(files.join("").split("\n").filter(Boolean)).toHaveLength(200);
  });

  it("clears the source hash and deletes the old rows by id range before the inserts", () => {
    const [first, ...inserts] = largeCatalogFiles({
      source: SOURCE_ROW,
      rows,
      catalogs: LARGE_CATALOG_NAMES,
      ids: { min: 1_001, max: 1_000 + DELETE_ROWS_MAX * 2 + 1 },
    });
    expect(first).toMatch(
      /^INSERT INTO sources .*'catalogos-cfdi-40'.*, '', .*ON CONFLICT \(id\) DO UPDATE SET/u,
    );
    const deletes = first!.match(
      /^DELETE FROM catalog_entries WHERE id BETWEEN \d+ AND \d+ .*$/gmu,
    )!;
    expect(deletes).toHaveLength(3);
    expect(deletes[0]).toContain(`BETWEEN 1001 AND ${1_000 + DELETE_ROWS_MAX}`);
    expect(deletes[2]).toContain(
      `BETWEEN ${1_001 + DELETE_ROWS_MAX * 2} AND ${1_001 + DELETE_ROWS_MAX * 2}`,
    );
    expect(inserts.join("")).toContain("'c_CodigoPostal', '09999'");
    expect(
      largeCatalogFiles({ source: SOURCE_ROW, rows, catalogs: LARGE_CATALOG_NAMES, ids: null })[0],
    ).not.toContain("DELETE");
  });

  it("replaces the other records without touching the large catalogs or deleting their source", () => {
    const corpus: Corpus = {
      sources: [SOURCE_ROW],
      passages: [],
      errorCodes: [],
      catalogEntries: [entry("c_UsoCFDI", "S01", { c_UsoCFDI: "S01" })],
      links: [],
    };
    const sql = recordsSql(corpus, LARGE_CATALOG_NAMES, { passages: [], sourceVersions: [] });
    expect(sql).toContain(
      "DELETE FROM catalog_entries WHERE catalog NOT IN ('c_ClaveProdServ', 'c_ClaveUnidad', 'c_CodigoPostal', 'c_Colonia', 'c_Localidad', 'c_Municipio', 'c_NumPedimentoAduana', 'c_PatenteAduanal');",
    );
    expect(sql).not.toMatch(/DELETE FROM sources;/u);
    expect(sql).toContain("DELETE FROM sources WHERE id NOT IN ('catalogos-cfdi-40');");
    expect(sql).toContain(
      "DELETE FROM source_versions WHERE source_id NOT IN ('catalogos-cfdi-40');",
    );
    expect(sql).toContain(`'${SOURCE.sha256}'`);
  });

  it("records the links between written passages, numbered in order, after the passages", () => {
    const record = (key: string) => ({
      key,
      sourceId: SOURCE_ROW.id,
      heading: key,
      sha256: "1",
      body: "# X\n",
      kind: "guia",
      validFrom: 20220101,
      validUntil: 99991231,
    });
    const corpus: Corpus = {
      sources: [SOURCE_ROW],
      passages: [],
      errorCodes: [],
      catalogEntries: [],
      links: [
        { from: "s/a.md", to: "s/b.md" },
        { from: "s/a.md", to: "s/unwritten.md" },
        { from: "s/a.md", to: "s/c.md" },
        { from: "s/b.md", to: "s/a.md" },
      ],
    };
    const sql = recordsSql(corpus, LARGE_CATALOG_NAMES, {
      passages: ["s/a.md", "s/b.md", "s/c.md"].map(record),
      sourceVersions: [],
    });
    expect(sql.indexOf("DELETE FROM passage_links;")).toBeLessThan(
      sql.indexOf("DELETE FROM passages;"),
    );
    expect(sql).toContain(
      "INSERT INTO passage_links (passage_key, related_key, position) VALUES ('s/a.md', 's/b.md', 0), ('s/a.md', 's/c.md', 1), ('s/b.md', 's/a.md', 0);",
    );
    expect(sql.indexOf("INSERT INTO passage_links")).toBeGreaterThan(
      sql.indexOf("INSERT INTO passages"),
    );
  });

  it("records the passages with their validity and the superseded source versions", () => {
    const corpus: Corpus = {
      sources: [SOURCE_ROW],
      passages: [],
      errorCodes: [],
      catalogEntries: [],
      links: [],
    };
    const sql = recordsSql(corpus, LARGE_CATALOG_NAMES, {
      passages: [
        {
          key: "catalogos-cfdi-40/x.20220101.md",
          sourceId: SOURCE_ROW.id,
          heading: "X",
          sha256: "1",
          body: "# X\n\nIt's the old text.\n",
          kind: "guia",
          validFrom: 20220101,
          validUntil: 20261014,
        },
      ],
      sourceVersions: [{ ...SOURCE_ROW, validFrom: 20220101, validUntil: 20261014 }],
    });
    expect(sql).toContain(
      "INSERT INTO passages (key, source_id, heading, sha256, body, kind, valid_from, valid_until) VALUES ('catalogos-cfdi-40/x.20220101.md', 'catalogos-cfdi-40', 'X', '1', '# X\n\nIt''s the old text.\n', 'guia', 20220101, 20261014);",
    );
    expect(sql).toMatch(
      /INSERT INTO source_versions \(source_id, .*\) VALUES \('catalogos-cfdi-40', .*, 20220101, 20261014\) ON CONFLICT \(source_id, valid_from\) DO UPDATE/u,
    );
    // After the source it references.
    expect(sql.indexOf("INSERT INTO source_versions")).toBeGreaterThan(
      sql.indexOf("INSERT INTO sources"),
    );
  });
});
