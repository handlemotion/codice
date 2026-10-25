import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  anchorOf,
  buildCorpus,
  catalogEntryRows,
  ingestionPlan,
  ITEM_KEY_MAX,
  stuckItem,
  type Passage,
} from "../scripts/corpus";
import { errorCodePassageId } from "../src/records";

const SAT_MD = join(import.meta.dirname, "../../../docs/sat-md");
const corpus = buildCorpus({ read: (file) => readFileSync(join(SAT_MD, file), "utf8") });

describe("buildCorpus", () => {
  it("gives every passage a unique key within AI Search's limit", () => {
    const keys = corpus.passages.map((passage) => passage.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.length).toBeLessThanOrEqual(ITEM_KEY_MAX);
      expect(key).toMatch(/^[a-z0-9-]+\/[a-z0-9][a-z0-9.-]*\.md$/u);
    }
  });

  it("splits both guides, the matrix and the RMF into passages with SAT metadata", () => {
    const sources = new Set(corpus.passages.map((passage) => passage.sourceId));
    expect([...sources]).toEqual([
      "anexo-20-guia-de-llenado",
      "complemento-pagos-guia-de-llenado",
      "matriz-de-errores-cfdi-40",
      "rmf-2026",
    ]);
    for (const passage of corpus.passages) {
      expect(passage.metadata.authority).toBe("SAT");
      expect(passage.metadata.valid_until).toBe(99_991_231);
      expect(passage.metadata.valid_from).toBeGreaterThan(20_220_000);
    }
  });

  it("quotes the matrix row verbatim under its heading path", () => {
    const passage = corpus.passages.find(
      (candidate) => candidate.key === "matriz-de-errores-cfdi-40/cfdi40149.md",
    );
    expect(passage?.body).toContain(
      'Validación: Si el valor del atributo Rfc del receptor es "XAXX010101000" o "XEXX010101000", este atributo debe ser igual al valor del atributo LugarExpedicion.',
    );
    expect(passage?.heading).toMatch(/› cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149$/u);
    expect(passage?.metadata).toEqual({
      authority: "SAT",
      kind: "anexo",
      valid_from: 20_260_325,
      valid_until: 99_991_231,
    });
  });

  it("keeps a guide section whole and starts it with its heading path", () => {
    const passage = corpus.passages.find(
      (candidate) =>
        candidate.key ===
        "complemento-pagos-guia-de-llenado/nodo-receptor-domiciliofiscalreceptor.md",
    );
    expect(passage?.body).toMatch(
      /^# Guía de llenado .* › Nodo: Receptor › DomicilioFiscalReceptor\n/u,
    );
    expect(passage?.body).toContain(
      "El código postal, en caso de que sea diferente de los RFC genéricos, debe estar asociado a",
    );
  });

  it("quotes a regla of the RMF under its heading path, valid from its DOF date", () => {
    const original = corpus.passages.find(
      (candidate) => candidate.key === "rmf-2026/regla-2.7.1.21.md",
    );
    expect(original?.body).toMatch(
      /^# Resolución Miscelánea Fiscal para 2026 \(compilación del SAT\) › Título 2\. .* › Sección 2\.7\.1\. Disposiciones generales › Regla 2\.7\.1\.21\. Expedición de comprobantes en operaciones con el público en general\n\nExpedición de comprobantes/u,
    );
    expect(original?.metadata).toEqual({
      authority: "SAT",
      kind: "regla",
      valid_from: 20_251_228,
      valid_until: 99_991_231,
    });
    const amended = corpus.passages.find(
      (candidate) => candidate.key === "rmf-2026/regla-2.1.6.md",
    );
    expect(amended?.body).toContain(
      "- Reformada en la Primera RMRMF para 2026, publicada en el DOF el 09 de julio de 2026.",
    );
    expect(amended?.metadata.valid_from).toBe(20_260_709);
    expect(corpus.passages.some((candidate) => candidate.key === "rmf-2026/regla-2.12.4.md")).toBe(
      false,
    );
  });

  it("labels a guide passage by its node, and has every passage the eval expects", () => {
    const passage = corpus.passages.find(
      (candidate) => candidate.key === "anexo-20-guia-de-llenado/nodo-comprobante-tipocambio.md",
    );
    expect(passage?.heading).toMatch(
      / › I\. Guía de llenado .* › Nodo: Comprobante › TipoCambio$/u,
    );
    const questions = JSON.parse(
      readFileSync(join(import.meta.dirname, "../scripts/eval-questions.json"), "utf8"),
    ) as { expect: string[] }[];
    const keys = new Set(corpus.passages.map((candidate) => candidate.key));
    expect(
      questions.flatMap((question) => question.expect).filter((key) => !keys.has(key)),
    ).toEqual([]);
  });

  it("records every matrix code and catalog entry for D1", () => {
    expect(corpus.errorCodes.find((row) => row.code === "CFDI40149")).toMatchObject({
      node: "cfdi:Receptor",
      attribute: "DomicilioFiscalReceptor",
      message: "El campo DomicilioFiscalReceptor, no es igual al valor del campo LugarExpedicion.",
    });
    expect(
      corpus.catalogEntries.find((row) => row.catalog === "c_UsoCFDI" && row.key === "S01"),
    ).toMatchObject({ fields: { Descripción: "Sin efectos fiscales." }, validFrom: 20_220_101 });
    expect(corpus.sources.map((source) => source.id)).toEqual([
      "anexo-20-guia-de-llenado",
      "complemento-pagos-guia-de-llenado",
      "matriz-de-errores-cfdi-40",
      "catalogos-cfdi-40",
      "rmf-2026",
    ]);
  });

  it("gives every matrix code the passage id its lookup answers", () => {
    const keys = new Set(corpus.passages.map((passage) => passage.key));
    for (const row of corpus.errorCodes) {
      expect(keys).toContain(errorCodePassageId(row.sourceId, row.code));
    }
  });
});

describe("anchorOf", () => {
  it("folds accents and punctuation, within the length", () => {
    expect(anchorOf("Nodo: Receptor › UsoCFDI", 80)).toBe("nodo-receptor-usocfdi");
    expect(anchorOf("Apéndice 3 — Catálogos", 80)).toBe("apendice-3-catalogos");
    expect(anchorOf("Nodo: Receptor › UsoCFDI", 10)).toBe("nodo-recep");
    expect(anchorOf("›", 80)).toBe("seccion");
  });
});

describe("catalogEntryRows", () => {
  it("takes a row's own validity, else the catalog's start, and leaves an open end in force", () => {
    const rows = catalogEntryRows({
      source: { url: "u", sha256: "s", publishedAt: "2026-10-15", retrievedAt: "2026-10-21" },
      catalogs: [
        {
          name: "c_Pais",
          title: "Países",
          version: { "Fecha inicio de vigencia del catálogo": "2022-01-01" },
          columns: ["c_Pais", "Descripción"],
          keyColumn: 0,
          rows: [["MEX", "México"]],
        },
        {
          name: "c_Meses",
          title: "Meses",
          version: {},
          columns: ["c_Meses", "Descripción", "Fecha inicio de vigencia", "Fecha fin de vigencia"],
          keyColumn: 0,
          rows: [["13", "Julio-Agosto", "2022-01-01", "2023-12-31"]],
        },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({ key: "MEX", validFrom: 20_220_101, validUntil: 99_991_231 }),
      expect.objectContaining({ key: "13", validFrom: 20_220_101, validUntil: 20_231_231 }),
    ]);
  });
});

describe("ingestionPlan", () => {
  const passage = (key: string, sha256: string) => ({ key, sha256 }) as Passage;

  it("uploads new, changed, missing and stuck passages and deletes items no passage has", () => {
    const plan = ingestionPlan({
      passages: [
        passage("a/same.md", "1"),
        passage("a/changed.md", "2"),
        passage("a/new.md", "3"),
        passage("a/lost.md", "4"),
        passage("a/failed.md", "5"),
      ],
      recorded: new Map([
        ["a/same.md", "1"],
        ["a/changed.md", "old"],
        ["a/lost.md", "4"],
        ["a/failed.md", "5"],
      ]),
      items: [
        { id: "i1", key: "a/same.md" },
        { id: "i2", key: "a/changed.md" },
        { id: "i3", key: "a/gone.md" },
        { id: "i4", key: "a/failed.md", status: "error" },
      ],
    });
    expect(plan.upload.map((entry) => entry.key)).toEqual([
      "a/changed.md",
      "a/new.md",
      "a/lost.md",
      "a/failed.md",
    ]);
    expect(plan.repair).toEqual([{ id: "i4", key: "a/failed.md" }]);
    expect(plan.remove).toEqual([{ id: "i3", key: "a/gone.md" }]);
    expect(plan.unchanged).toBe(1);
  });

  it("deletes stuck items before uploading their passages again", () => {
    const plan = ingestionPlan({
      passages: [passage("a/timed-out.md", "1"), passage("a/reindexing.md", "2")],
      recorded: new Map([
        ["a/timed-out.md", "1"],
        ["a/reindexing.md", "2"],
      ]),
      items: [
        { id: "i1", key: "a/timed-out.md", status: "outdated", next_action: null },
        { id: "i2", key: "a/reindexing.md", status: "outdated", next_action: "reindex" },
        { id: "i3", key: "a/gone.md", status: "error" },
      ],
    });
    expect(plan.repair).toEqual([
      { id: "i1", key: "a/timed-out.md" },
      { id: "i3", key: "a/gone.md" },
    ]);
    expect(plan.upload.map((entry) => entry.key)).toEqual(["a/timed-out.md"]);
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });
});

describe("stuckItem", () => {
  const item = (status: string, next_action?: string | null) => ({
    id: "i",
    key: "a/b.md",
    status,
    next_action,
  });

  it("selects failed items and outdated items AI Search will do nothing with", () => {
    expect(stuckItem(item("error"))).toBe(true);
    expect(stuckItem(item("error", "reindex"))).toBe(true);
    expect(stuckItem(item("outdated", null))).toBe(true);
  });

  it("leaves items that are indexed or still indexing", () => {
    expect(stuckItem(item("outdated", "reindex"))).toBe(false);
    // A listing without the field says nothing about the item: keep it.
    expect(stuckItem(item("outdated"))).toBe(false);
    for (const status of ["queued", "running", "completed", "skipped"]) {
      expect(stuckItem(item(status, null))).toBe(false);
    }
  });
});
