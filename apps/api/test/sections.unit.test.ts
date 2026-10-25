import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compactSatMarkdown } from "../scripts/sat-documents";
import {
  guideSections,
  nameVocabulary,
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
