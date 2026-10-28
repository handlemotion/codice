import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compactSatMarkdown } from "../scripts/sat-documents";
import {
  guideSections,
  lawArticles,
  nameVocabulary,
  rmfReglas,
  SECTION_MAX_CHARS,
  type GuideSection,
} from "../scripts/sections";

const SAT_MD = join(import.meta.dirname, "../../../docs/sat-md");
const read = (file: string) => compactSatMarkdown(readFileSync(join(SAT_MD, file), "utf8"));
const GUIDES = {
  anexo20: read("anexo-20-guia-de-llenado-cfdi.md"),
  pagos: read("complemento-pagos-guia-de-llenado.md"),
};
const VOCABULARY = nameVocabulary([
  GUIDES.anexo20,
  GUIDES.pagos,
  read("matriz-de-errores-cfdi-4.0.md"),
]);

/** The guide as MarkItDown converts a SAT PDF: contents, a two-column part, appendices. */
const GUIDE = [
  "# Guía",
  "",
  "Contenido",
  "I. Guía de llenado del CFDI ........ 5",
  "Apéndice 1 Notas Generales ........ 9",
  "Apéndice 2 Preguntas y respuestas sobre el",
  "CFDI ........ 10",
  "1 / 12",
  "",
  "I. Guía de llenado del CFDI",
  "Nombre del Descripción",
  "Nodo: En este nodo se puede expresar la información relacionada con el",
  "InformacionGlo comprobante global de operaciones con el público en general.",
  "bal",
  "Nodo: Receptor En este nodo se debe expresar la información del receptor.",
  "DomicilioFiscalR Se debe registrar el código postal del domicilio fiscal del receptor",
  "eceptor del comprobante.",
  "Cantidad Se debe registrar la cantidad.",
  "Importe Se debe registrar el importe total.",
  "Ejemplo:",
  "Cantidad Valor unitario Importe",
  "",
  "Apéndice 1 Notas Generales",
  "Nota 1: El documento incluye ejemplos.",
  "",
  "Apéndice 2 Preguntas y respuestas sobre el CFDI",
  "1. ¿Se puede cancelar?",
  "Sí. Fundamento Legal: regla 2.7.1.29. del SAT. 2. ¿Qué UsoCFDI lleva?",
  "CP01. Véase el Apéndice 1 Notas Generales.",
  "",
].join("\n");
const VOCABULARY_SYNTHETIC = new Set(["InformacionGlobal", "DomicilioFiscalReceptor"]);

/** The slices cover the guide in order, nothing dropped or repeated but blank space. */
function covers(sections: readonly GuideSection[], markdown: string) {
  const strip = (text: string) => text.replaceAll(/\s+/gu, "");
  return strip(sections.map((section) => section.text).join("")) === strip(markdown);
}

describe("guideSections", () => {
  const sections = guideSections(GUIDE, { title: "Guía", vocabulary: VOCABULARY_SYNTHETIC });

  it("label a node and an attribute by the whole name the PDF wrapped", () => {
    expect(sections.map((section) => section.anchor)).toEqual([
      "portada",
      "parte I",
      "Nodo: InformacionGlobal",
      "Nodo: Receptor",
      "Nodo: Receptor › DomicilioFiscalReceptor",
      "Nodo: Receptor › Cantidad",
      "Nodo: Receptor › Importe",
      "Apéndice 1",
      "Apéndice 2",
      "Apéndice 2 › Pregunta 1",
      "Apéndice 2 › Pregunta 2",
    ]);
    expect(sections[4]!.label).toBe(
      "I. Guía de llenado del CFDI › Nodo: Receptor › DomicilioFiscalReceptor",
    );
  });

  it("keep an example with its rule, and cut a question where its number starts", () => {
    const importe = sections.find((section) => section.anchor === "Nodo: Receptor › Importe");
    expect(importe?.text.trim()).toBe(
      "Importe Se debe registrar el importe total.\nEjemplo:\nCantidad Valor unitario Importe",
    );
    const [first, second] = sections.filter((section) => section.anchor.includes("Pregunta"));
    expect(first!.text).toBe(
      "1. ¿Se puede cancelar?\nSí. Fundamento Legal: regla 2.7.1.29. del SAT. ",
    );
    expect(second!.text).toMatch(/^2\. ¿Qué UsoCFDI lleva\?\nCP01\. Véase el Apéndice 1/u);
    expect(second!.label).toBe("Apéndice 2 Preguntas y respuestas sobre el CFDI › Pregunta 2");
  });

  it("quote the guide verbatim and whole", () => {
    expect(covers(sections, GUIDE)).toBe(true);
    for (const section of sections) expect(GUIDE).toContain(section.text);
  });

  it("cut a long section at blank lines into numbered parts", () => {
    const paragraph = `${"Texto del apéndice. ".repeat(60).trim()}\n\n`;
    const guide = `# Guía\n\nContenido\nApéndice 1 Casos ........ 2\n1 / 9\n\nApéndice 1 Casos\n${paragraph.repeat(6)}`;
    const parts = guideSections(guide, { title: "Guía", vocabulary: new Set() }).slice(1);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.label).toBe(`Apéndice 1 Casos (parte 1 de ${parts.length})`);
    for (const part of parts) {
      expect(part.anchor).toBe("Apéndice 1");
      expect(part.text.length).toBeLessThanOrEqual(SECTION_MAX_CHARS);
    }
    expect(covers(parts, guide.slice(guide.indexOf("Apéndice 1 Casos\n")))).toBe(true);
  });
});

describe("guideSections over the SAT's guides", () => {
  for (const [name, markdown] of Object.entries(GUIDES)) {
    const sections = guideSections(markdown, { title: name, vocabulary: VOCABULARY });

    it(`${name}: covers the guide verbatim, with no node left unnamed`, () => {
      expect(covers(sections, markdown)).toBe(true);
      for (const section of sections) {
        expect(section.label).not.toMatch(/Nodo: (?:En|Este|Formato)\b|sin nombre/u);
      }
    });

    it(`${name}: finds every part and appendix its contents list, once and in order`, () => {
      const top = [
        ...new Set(sections.map((section) => section.label.split(" › ")[0]!.split(" (parte")[0]!)),
      ];
      const appendices = top.filter((title) => title.startsWith("Apéndice"));
      expect(appendices.map((title) => Number(/^Apéndice (\d+)/u.exec(title)![1]))).toEqual(
        appendices.map((_, index) => index + 1),
      );
      expect(top.filter((title) => /^[IV]+\. Guía de llenado/u.test(title))).toHaveLength(2);
      expect(top).toContain("Glosario");
    });

    it(`${name}: numbers the questions 1, 2, 3, … with no gap`, () => {
      const questions = [
        ...new Set(
          sections.flatMap((section) => {
            const number = / › Pregunta (\d+)$/u.exec(section.anchor)?.[1];
            return number ? [Number(number)] : [];
          }),
        ),
      ];
      expect(questions.length).toBeGreaterThan(10);
      expect(questions).toEqual(questions.map((_, index) => index + 1));
    });
  }

  it("names the nodes the PDF wrapped in the Anexo 20", () => {
    const anchors = guideSections(GUIDES.anexo20, {
      title: "Anexo 20",
      vocabulary: VOCABULARY,
    }).map((section) => section.anchor);
    expect(anchors).toEqual(
      expect.arrayContaining([
        "Nodo: Comprobante › TipoCambio",
        "Nodo: InformacionGlobal",
        "Nodo: CfdiRelacionados › TipoRelacion",
        "Nodo: CfdiRelacionado › UUID",
        "Nodo: Receptor › DomicilioFiscalReceptor",
        "Nodo: Concepto › ObjetoImp",
        "Nodo: ACuentaTerceros › RfcACuentaTerceros",
        "Nodo: InformacionAduanera › NumeroPedimento",
        "Nodo: Retenciones › FolioInt",
      ]),
    );
  });
});

/** The compiled RMF as `sat:knowledge` writes it: cover, contents, glossary, reglas, transitorios. */
const RMF = [
  "Resolución Miscelánea Fiscal para 2026",
  "Publicada en el Diario Oficial de la Federación el 28 de",
  "diciembre de 2025, reformada mediante la Primera Resolución de Modificaciones.",
  "Contenido",
  "Glosario",
  "Título",
  "1. Disposiciones generales",
  "2. Código Fiscal de la Federación",
  "Capítulo 2.1. Disposiciones generales",
  "Capítulo 2.7. De los Comprobantes Fiscales Digitales por Internet o Factura",
  "Electrónica",
  "Sección 2.7.1. Disposiciones generales",
  "Transitorios",
  "Glosario",
  "1. CFF. Código Fiscal de la Federación.",
  "Título 1. Disposiciones generales",
  "Lugar y forma para presentar documentación",
  "1.1. Para los efectos del RISAT, los documentos se presentarán conforme a la regla",
  "2.1.18. y la ficha de trámite.",
  "CFF 18, 29-A",
  "Título 2. Código Fiscal de la Federación",
  "Capítulo 2.1. Disposiciones generales",
  "Regla 2.1.1.",
  "- Reformada en la Primera RMRMF para 2026, publicada en el DOF el 09 de julio de 2026.",
  "",
  "Días inhábiles",
  "2.1.1. Para los efectos del artículo 12 del CFF, son inhábiles el 2 y 3 de abril de 2026.",
  "CFF 12",
  "Documentos emitidos en el extranjero para representación de particulares,",
  "autoridades nacionales y extranjeras",
  "2.1.2. Para los efectos del artículo 19 del CFF, se estará a lo siguiente:",
  "2.1.1. Cuando se trate de documentos públicos, se apostillarán.",
  "CFF 19, LISR 2013 218",
  "Cancelación de comprobantes de expedición de",
  "CFDI",
  "2.1.3. Para los efectos del artículo 29-A del CFF, se cancelará el CFDI.",
  "CFF 29",
  "Formalidades para la garantía",
  "2.1.4. Se deroga.",
  "Capítulo 2.7. De los Comprobantes Fiscales Digitales por Internet o",
  "Factura Electrónica",
  "Sección 2.7.1. Disposiciones generales",
  "Expedición de comprobantes en operaciones con el público en general",
  "",
  "2.7.1.1. Para los efectos del artículo 29 del CFF, se expedirá un CFDI diario.",
  "CFF 17-A, 20, 26, 32-A, 84-",
  "L, 84-N, 86, 86-B, 88",
  "Capítulo 2.8.",
  "-Adicionado en la Primera RMRMF para 2026, publicada en el DOF el 09 de julio de 2026.",
  "Capítulo 2.8. De la contabilidad del sector",
  "primario y sus declaraciones",
  "Contabilidad simplificada",
  "2.8.1. Para los efectos del artículo 28 del CFF, se llevará la contabilidad.",
  "CFF 28",
  "Transitorios",
  "Primero. La presente Resolución entrará en vigor el 1 de enero de 2026.",
  "",
].join("\n");

describe("rmfReglas", () => {
  const reglas = rmfReglas(RMF);
  const regla = (number: string) => reglas.find((candidate) => candidate.number === number)!;

  it("finds each regla once, in order, and none for a repealed one or a wrapped reference", () => {
    expect(reglas.map((candidate) => candidate.number)).toEqual([
      "1.1",
      "2.1.1",
      "2.1.2",
      "2.1.3",
      "2.7.1.1",
      "2.8.1",
    ]);
    expect(regla("1.1").text).toContain("2.1.18. y la ficha de trámite.\nCFF 18, 29-A\n");
    expect(regla("2.1.2").text).toContain("2.1.1. Cuando se trate de documentos públicos");
    expect(regla("2.1.3").text).not.toContain("Formalidades para la garantía");
  });

  it("labels a regla by its headings, spelled as the contents spell them, and its title", () => {
    expect(regla("1.1").label).toBe(
      "Título 1. Disposiciones generales › Regla 1.1. Lugar y forma para presentar documentación",
    );
    expect(regla("2.1.2").label).toBe(
      "Título 2. Código Fiscal de la Federación › Capítulo 2.1. Disposiciones generales › Regla 2.1.2. Documentos emitidos en el extranjero para representación de particulares, autoridades nacionales y extranjeras",
    );
    expect(regla("2.1.3").label).toMatch(
      / › Regla 2\.1\.3\. Cancelación de comprobantes de expedición de CFDI$/u,
    );
    expect(regla("2.7.1.1").label).toBe(
      "Título 2. Código Fiscal de la Federación › Capítulo 2.7. De los Comprobantes Fiscales Digitales por Internet o Factura Electrónica › Sección 2.7.1. Disposiciones generales › Regla 2.7.1.1. Expedición de comprobantes en operaciones con el público en general",
    );
  });

  it("names a heading the contents leave out, and keeps its note out of the regla before", () => {
    expect(regla("2.8.1").label).toBe(
      "Título 2. Código Fiscal de la Federación › Capítulo 2.8. De la contabilidad del sector primario y sus declaraciones › Regla 2.8.1. Contabilidad simplificada",
    );
    expect(regla("2.7.1.1").text).toMatch(/L, 84-N, 86, 86-B, 88\n$/u);
  });

  it("starts an amended regla at the SAT's note and dates it to that amendment", () => {
    expect(regla("2.1.1").text).toMatch(/^Regla 2\.1\.1\.\n- Reformada en la Primera RMRMF/u);
    expect(regla("2.1.1").label).toMatch(/ › Regla 2\.1\.1\. Días inhábiles$/u);
    expect(regla("2.1.1").publishedAt).toBe("2026-07-09");
    expect(regla("2.1.2").publishedAt).toBe("2025-12-28");
    expect(regla("2.8.1").publishedAt).toBe("2025-12-28");
  });

  it("quotes each regla verbatim, from its title to its references", () => {
    for (const candidate of reglas) expect(RMF).toContain(candidate.text);
    expect(regla("2.1.3").text).toBe(
      "Cancelación de comprobantes de expedición de\nCFDI\n2.1.3. Para los efectos del artículo 29-A del CFF, se cancelará el CFDI.\nCFF 29\n",
    );
    expect(regla("2.8.1").text).toMatch(/CFF 28\n$/u);
  });
});

describe("rmfReglas over the SAT's compiled RMF", () => {
  const markdown = read("resolucion-miscelanea-fiscal-2026.md");
  const reglas = rmfReglas(markdown);

  it("numbers the reglas of each heading 1, 2, 3, … but for those the RMF repeals", () => {
    const repealed = new Set(
      [...markdown.matchAll(/^(\d+(?:\.\d+)+)\. Se deroga\./gmu)].map((match) => match[1]!),
    );
    const numbers = new Set(reglas.map((candidate) => candidate.number));
    expect(reglas.length).toBeGreaterThan(1000);
    for (const candidate of reglas) {
      const parent = candidate.number.slice(0, candidate.number.lastIndexOf("."));
      const index = Number(candidate.number.slice(candidate.number.lastIndexOf(".") + 1));
      for (let earlier = 1; earlier < index; earlier += 1) {
        const number = `${parent}.${earlier}`;
        expect(numbers.has(number) || repealed.has(number), number).toBe(true);
      }
    }
  });

  it("dates every regla the SAT notes as amended to its amendment, and titles every regla", () => {
    const noted = [...markdown.matchAll(/^Regla (\d+(?:\.\d+)+)\.\n- (?:Reformada|Adicionada)/gmu)];
    expect(noted.length).toBeGreaterThan(0);
    for (const [, number] of noted) {
      expect(reglas.find((candidate) => candidate.number === number)?.publishedAt, number).not.toBe(
        "2025-12-28",
      );
    }
    for (const candidate of reglas) {
      expect(candidate.label, candidate.number).toMatch(
        /› Regla [\d.]+\. (?:[A-ZÁÉÍÓÚÑ¿“]|[A-Z]{2,} )/u,
      );
    }
  });

  it("keeps a CFDI regla whole under its headings", () => {
    const regla = reglas.find((candidate) => candidate.number === "2.7.1.21")!;
    expect(regla.label).toBe(
      "Título 2. Código Fiscal de la Federación › Capítulo 2.7. De los Comprobantes Fiscales Digitales por Internet o Factura Electrónica › Sección 2.7.1. Disposiciones generales › Regla 2.7.1.21. Expedición de comprobantes en operaciones con el público en general",
    );
    expect(regla.text).toMatch(/^Expedición de comprobantes en operaciones con el público/u);
    expect(regla.text).toMatch(/\nCFF 29, 29-A, .*RMF 2\.6\.1\.2\., 2\.7\.1\.23\..*\n$/u);
  });
});

/** A law as `sat:knowledge` converts the Cámara de Diputados' PDF, without its page furniture. */
const LAW = [
  "# Código Fiscal de la Federación (texto vigente)",
  "",
  "Última reforma publicada DOF 09-04-2026",
  "El Congreso de los Estados Unidos Mexicanos, Decreta:",
  "Artículo Único.- Se expide el Código.",
  "TITULO PRIMERO",
  "Disposiciones Generales",
  "CAPITULO I",
  "Artículo 1o.- Las personas físicas y las morales, están obligadas a contribuir.",
  "Artículo 4o.-A.- Los impuestos exigibles por los Estados extranjeros se cobrarán conforme al",
  "Artículo 21 de este Código.",
  "Artículo reformado DOF 12-11-2021",
  "CAPÍTULO II",
  "DE LOS MEDIOS ELECTRÓNICOS",
  "Artículo 17-H Bis. Tratándose de certificados de sello digital.",
  "Párrafo adicionado DOF 12-11-2021",
  "Artículo 20-Bis. El Índice Nacional de Precios al Consumidor.",
  "Artículo 29-A. Los comprobantes fiscales digitales deberán contener:",
  "I. La clave del Registro Federal de Contribuyentes.",
  "Artículo 29-B. (Se deroga).",
  "Artículo 29-C. Se deroga.",
  "Nota: Por Decreto DOF 09-12-2019 se adicionó un nuevo Título Segundo.",
  "TITULO SEGUNDO",
  "De los Procedimientos",
  "CAPITULO I",
  "Sección Primera",
  "Del Recurso de Revocación",
  "Artículo 116. Contra los actos administrativos podrá interponerse el recurso de revocación.",
  "TRANSITORIOS",
  "Artículo Primero.- Este Código entrará en vigor el 1o. de enero de 1983.",
  "",
].join("\n");

describe("lawArticles", () => {
  const articles = lawArticles(LAW);
  const article = (number: string) => articles.find((candidate) => candidate.number === number)!;

  it("finds each article once, in order, and none for a repealed one or a wrapped reference", () => {
    expect(articles.map((candidate) => candidate.number)).toEqual([
      "1",
      "4-A",
      "17-H Bis",
      "20 Bis",
      "29-A",
      "116",
    ]);
  });

  it("labels an article by its Título, Capítulo and Sección, with their names", () => {
    expect(article("1").label).toBe(
      "TITULO PRIMERO. Disposiciones Generales › CAPITULO I › Artículo 1o.",
    );
    expect(article("17-H Bis").label).toBe(
      "TITULO PRIMERO. Disposiciones Generales › CAPÍTULO II. DE LOS MEDIOS ELECTRÓNICOS › Artículo 17-H Bis",
    );
    expect(article("116").label).toBe(
      "TITULO SEGUNDO. De los Procedimientos › CAPITULO I › Sección Primera. Del Recurso de Revocación › Artículo 116",
    );
  });

  it("quotes each article verbatim with its reform notes, up to the next article, heading or note", () => {
    for (const candidate of articles) expect(LAW).toContain(candidate.text);
    expect(article("4-A").text).toBe(
      "Artículo 4o.-A.- Los impuestos exigibles por los Estados extranjeros se cobrarán conforme al\nArtículo 21 de este Código.\nArtículo reformado DOF 12-11-2021\n",
    );
    expect(article("17-H Bis").text).toMatch(/\nPárrafo adicionado DOF 12-11-2021\n$/u);
    expect(article("29-A").text).toMatch(/Contribuyentes\.\n$/u);
    expect(article("116").text).not.toContain("TRANSITORIOS");
  });
});

describe("lawArticles over the Cámara de Diputados' CFF", () => {
  const markdown = read("codigo-fiscal-de-la-federacion.md");
  const articles = lawArticles(markdown);
  const body = markdown.slice(0, markdown.indexOf("\nTRANSITORIOS\n"));

  it("has a passage for every article of the body that is not repealed", () => {
    // An article's number ends in a period or dash; `Artículo 192 de este Código.` is a reference.
    const listed = [
      ...body.matchAll(/^Artículo \d+\S*(?: (?:Bis|Ter|Quáter|Quinquies))?[.-]+ .*$/gmu),
    ].filter((match) => !/\(?(?:Se deroga|Derogado)\)?\.?$/u.test(match[0]));
    expect(articles.length).toBe(listed.length);
    expect(articles.length).toBeGreaterThan(300);
    expect(new Set(articles.map((candidate) => candidate.number)).size).toBe(articles.length);
    for (const candidate of articles) expect(markdown).toContain(candidate.text);
  });

  it("keeps the CFDI requirements of article 29-A whole under their headings", () => {
    const article = articles.find((candidate) => candidate.number === "29-A")!;
    expect(article.label).toBe(
      "TITULO SEGUNDO. De los Derechos y Obligaciones de los Contribuyentes › CAPITULO UNICO › Artículo 29-A",
    );
    expect(article.text).toMatch(/^Artículo 29-A\. Los comprobantes fiscales digitales/u);
    expect(article.text).toContain("Párrafo adicionado DOF 12-11-2021");
    expect(article.text).not.toContain("Artículo 29-A Bis.");
  });
});
