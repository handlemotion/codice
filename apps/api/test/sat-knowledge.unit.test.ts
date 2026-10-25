import { describe, expect, it } from "vitest";

import {
  buildSatLibrary,
  compactSatMarkdown,
  type SatSourceManifest,
} from "../scripts/sat-documents";
import {
  catalogXsdDifferences,
  parseCatalogSheet,
  parseCsv,
  parseErrorMatrix,
  renderCatalogs,
  renderErrorMatrix,
  sheetDate,
  xsdCatalogCodes,
} from "../scripts/sat-knowledge-render";
import {
  catalogEntryFields,
  catalogEntryKey,
  errorCodeRow,
  markdownTableRow,
  type SatCatalogSet,
  type SatErrorMatrix,
  type SatSource,
} from "../scripts/sat-records";

const SOURCE: SatSource = {
  url: "http://omawww.sat.gob.mx/documentos/catCFDI_V_4_20261015.xls",
  sha256: "0".repeat(64),
  publishedAt: "2026-10-15",
  retrievedAt: "2026-10-21",
};

/** c_RegimenFiscal as LibreOffice exports it: a group row above the header. */
const REGIMEN_CSV = `Catálogo de Régimen Fiscal.,,,,,
Versión CFDI,Versión catálogo,Revisión catálogo,Fecha publicación de catálogo,Fecha  inicio de vigencia del catálogo,Fecha fin de vigencia del catálogo
4.0,1.0,0,0,1/1/2022,
,,,,,
,,Aplica para tipo persona,,,
c_RegimenFiscal,Descripción,Física,Moral,Fecha de inicio de vigencia,Fecha de fin de vigencia
601,General de Ley Personas Morales,No,Sí,1/1/2022,
612,Personas Físicas con Actividades Empresariales y Profesionales,Sí,No,1/1/2022,
`;

/** c_UsoCFDI: the grouped columns are named in a second header row under the first. */
const USO_CSV = `Catálogo de uso de comprobantes.,,,,,,
Versión CFDI,Versión catálogo,Revisión catálogo,Fecha publicación de catálogo,Fecha  inicio de vigencia del catálogo,Fecha fin de vigencia del catálogo,
4.0,2.0,0,4/22/2023,1/1/2022,,
c_UsoCFDI,Descripción,Aplica para tipo persona,,Fecha inicio de vigencia,Fecha fin de vigencia,Régimen Fiscal Receptor
,,Física,Moral,,,
G03,Gastos en general.,Sí,Sí,1/1/2022,,"601, 603, 606, 612"
CP01,Pagos,Sí,Sí,1/1/2022,,"601, 603, 605"
`;

/** c_TasaOCuota: the key header spans two cells, and fixed rates fill only the second. */
const TASA_CSV = `Catálogo de tasas o cuotas de impuestos.,,,,,
Rango o Fijo,c_TasaOCuota,,Impuesto,Factor,Fecha inicio de vigencia
,Valor mínimo,Valor máximo,,,
Fijo,,0.160000 ,IVA,Tasa,1/1/2022
Rango,0.000000 ,0.160000 ,IVA,Tasa,1/1/2022
`;

/** c_TipoDeComprobante: one header the SAT merged over two cells. */
const TIPO_CSV = `c_TipoDeComprobante,Descripción,Valor máximo,,Fecha inicio de vigencia
I,Ingreso,999999999999999999.999999,,1/1/2022
N,Nómina,NS,NdS,1/1/2022
`;

const MATRIX_CSV = `Matriz de códigos de error para el Comprobante fiscal digital por Internet. Versión 4.0,,,,,
NÚM,ELEMENTO,ATRIBUTO,VALIDACIÓN,CÓDIGO ERROR,DESCRIPCIÓN DE CÓDIGO DE ERROR
1,Comprobante,Fecha,"Debe cumplir con el patrón (0[1-9]|1[0-2]).",CFDI40101,"El campo Fecha no cumple con el patrón requerido.
"
58,cfdi:Receptor,RegimenFiscalReceptor,El régimen fiscal que se registre en este atributo debe corresponder con el tipo de persona del receptor.,CFDI40158,La clave del campo RegimenFiscalR debe corresponder con el tipo de persona (física o moral).
59,cfdi:Receptor,RegimenFiscalReceptor,"Si el atributo Rfc es ""XEXX010101000"", debe ser 616.",CFDI40159,El régimen fiscal debe ser 616.
`;

function catalogSet(): SatCatalogSet {
  return {
    source: SOURCE,
    catalogs: [
      parseCatalogSheet("c_RegimenFiscal", parseCsv(REGIMEN_CSV)),
      parseCatalogSheet("c_UsoCFDI", parseCsv(USO_CSV)),
      parseCatalogSheet("c_TasaOCuota", parseCsv(TASA_CSV)),
    ],
  };
}

function errorMatrix(): SatErrorMatrix {
  return {
    source: { ...SOURCE, publishedAt: "2026-03-25" },
    ...parseErrorMatrix(parseCsv(MATRIX_CSV)),
  };
}

function syntheticLibrary() {
  const matrix = errorMatrix();
  const catalogs = catalogSet();
  const guide = [
    "# Anexo 20",
    "",
    "Nodo: Receptor En este nodo se debe expresar la información del receptor.",
    "Rfc Se debe registrar la clave del RFC del receptor.",
    "RegimenFiscalRe Se debe registrar la clave vigente del régimen fiscal del",
    "ceptor contribuyente receptor.",
    "15 / 123",
    "UsoCFDI Se debe registrar la clave del uso del comprobante.",
  ].join("\n");
  const files: Record<string, string> = {
    "anexo-20-guia-de-llenado-cfdi.md": guide,
    "complemento-pagos-guia-de-llenado.md":
      "# Pagos\n\nNodo: Pago\nMonedaP Se debe registrar la moneda.",
    "matriz-de-errores-cfdi-4.0.md": renderErrorMatrix(matrix),
    "catalogos-cfdi-4.0.md": renderCatalogs(catalogs),
  };
  const sources = {
    anexo20: SOURCE,
    pagos: SOURCE,
    matrix: matrix.source,
    catalogs: SOURCE,
  } satisfies SatSourceManifest;
  return buildSatLibrary({
    markdown: (file) => files[file],
    sources,
    records: { errorMatrix: matrix, catalogs },
  });
}

describe("SAT knowledge sources", () => {
  it("parse CSV with quoted commas, quotes, and line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nd,,e\n')).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["d", "", "e"],
    ]);
    expect(sheetDate("12/31/2025")).toBe("2025-12-31");
    expect(sheetDate("1/2/2026")).toBe("2026-01-02");
    expect(sheetDate("0")).toBeNull();
    // Dates the SAT typed as text are day first and padded.
    expect(sheetDate("31/07/2026")).toBe("2026-07-31");
    expect(sheetDate("01/07/2026")).toBe("2026-07-01");
    expect(sheetDate("15/10/2026")).toBe("2026-10-15");
  });

  it("parse a catalog's version, columns, and keys from either header layout", () => {
    const [regimen, uso, tasa] = catalogSet().catalogs;
    expect(regimen).toMatchObject({
      name: "c_RegimenFiscal",
      title: "Catálogo de Régimen Fiscal.",
      columns: [
        "c_RegimenFiscal",
        "Descripción",
        "Física",
        "Moral",
        "Fecha de inicio de vigencia",
        "Fecha de fin de vigencia",
      ],
      keyColumn: 0,
    });
    expect(regimen!.version).toMatchObject({
      "Versión catálogo": "1.0",
      "Fecha publicación de catálogo": null,
      "Fecha inicio de vigencia del catálogo": "2022-01-01",
    });
    expect(regimen!.rows[0]).toEqual([
      "601",
      "General de Ley Personas Morales",
      "No",
      "Sí",
      "2022-01-01",
      "",
    ]);
    expect(uso!.columns.slice(0, 4)).toEqual(["c_UsoCFDI", "Descripción", "Física", "Moral"]);
    expect(uso!.version["Fecha publicación de catálogo"]).toBe("2023-04-22");
    expect(catalogEntryFields(uso!, uso!.rows[0]!)).toMatchObject({
      "Régimen Fiscal Receptor": "601, 603, 606, 612",
    });
    expect(tasa!.rows.map((row) => catalogEntryKey(tasa!, row))).toEqual(["0.160000", "0.000000"]);
    const tipo = parseCatalogSheet("c_TipoDeComprobante", parseCsv(TIPO_CSV));
    expect(catalogEntryFields(tipo, tipo.rows[1]!)).toMatchObject({
      "Valor máximo": "NS",
      "Valor máximo (2)": "NdS",
    });
  });

  it("key a catalog by several columns, number repeated labels, and read vigencia dates", () => {
    const pedimento = parseCatalogSheet(
      "c_NumPedimentoAduana",
      parseCsv(`Catálogo de números de pedimento operados por aduana y ejercicio.,,,,,
c_Aduana,Patente,Ejercicio,Cantidad,Fecha inicio de vigencia,Fecha fin de vigencia
01,3173,2007,999999,1/1/2017,
16,2069,2026,999999,31/07/2026,
`),
      ["c_Aduana", "Patente", "Ejercicio"],
    );
    expect(pedimento.rows.map((row) => catalogEntryKey(pedimento, row))).toEqual([
      "01-3173-2007",
      "16-2069-2026",
    ]);
    expect(pedimento.rows[1]![4]).toBe("2026-07-31");

    const postal = parseCatalogSheet(
      "c_CodigoPostal",
      parseCsv(`c_CodigoPostal,c_Estado,Referencias del Huso Horario,,
,,Mes_Inicio_Horario_Verano,Día_Inicio_Horario_Verano,Día_Inicio_Horario_Verano
01000,CMX,Abril,primer domingo,02:00
`),
    );
    expect(catalogEntryFields(postal, postal.rows[0]!)).toEqual({
      c_CodigoPostal: "01000",
      c_Estado: "CMX",
      Mes_Inicio_Horario_Verano: "Abril",
      Día_Inicio_Horario_Verano: "primer domingo",
      "Día_Inicio_Horario_Verano (2)": "02:00",
    });

    const patente = parseCatalogSheet(
      "c_PatenteAduanal",
      parseCsv(`C_PatenteAduanal,Inicio de vigencia de la patente,Fin de vigencia de la patente
0074,7/3/2001,
`),
    );
    expect(patente.rows).toEqual([["0074", "2001-07-03", ""]]);
  });

  it("compare a catalog with the codes catCFDI.xsd allows", () => {
    const xsd = `<xs:simpleType name="c_RegimenFiscal"><xs:restriction base="xs:string"><xs:enumeration value="601"/><xs:enumeration value="609"/><xs:enumeration value="612"/></xs:restriction></xs:simpleType>`;
    const codes = xsdCatalogCodes(xsd, "c_RegimenFiscal")!;
    expect(codes).toEqual(["601", "609", "612"]);
    expect(xsdCatalogCodes(xsd, "c_TasaOCuota")).toBeNull();
    expect(catalogXsdDifferences(catalogSet().catalogs[0]!, codes)).toEqual({
      missingFromSheet: ["609"],
      missingFromXsd: [],
    });
  });

  it("render the matrix as one section per node, each row on its own findable line", () => {
    const matrix = errorMatrix();
    expect(matrix.codes.map((code) => code.code)).toEqual(["CFDI40101", "CFDI40158", "CFDI40159"]);
    expect(matrix.codes[0]!.message).toBe("El campo Fecha no cumple con el patrón requerido.");
    const document = syntheticLibrary().documents.find(
      (candidate) => candidate.slug === "matriz-de-errores-cfdi-4-0",
    )!;
    expect(document.markdown).toContain(
      "## cfdi:Receptor\n\n| Código | Atributo | Validación | Mensaje |",
    );
    expect(document.markdown).toContain("(0[1-9]\\|1[0-2])");
    const lines = document.markdown.split("\n");
    for (const code of matrix.codes) {
      expect(lines).toContain(compactSatMarkdown(markdownTableRow(errorCodeRow(code))));
    }
  });
});
