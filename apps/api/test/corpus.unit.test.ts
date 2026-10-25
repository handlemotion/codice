import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  anchorOf,
  buildCorpus,
  catalogEntryRows,
  dayBefore,
  ingestionPlan,
  ITEM_KEY_MAX,
  type Passage,
  type PassageRecord,
  type SourceRow,
  versionedKey,
} from "../scripts/corpus";
import { errorCodePassageId } from "../src/records";
import { isoDate } from "../src/search";

const SAT_MD = join(import.meta.dirname, "../../../docs/sat-md");
const corpus = buildCorpus({ read: (file) => readFileSync(join(SAT_MD, file), "utf8") });

describe("buildCorpus", () => {
  it("gives every passage a unique key within AI Search's limit", () => {
    const keys = corpus.passages.map((passage) => passage.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.length).toBeLessThanOrEqual(ITEM_KEY_MAX);
      expect(key).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+\.md$/u);
    }
  });

  it("splits both guides and the matrix into passages with SAT metadata", () => {
    const sources = new Set(corpus.passages.map((passage) => passage.sourceId));
    expect([...sources]).toEqual([
      "anexo-20-guia-de-llenado",
      "complemento-pagos-guia-de-llenado",
      "matriz-de-errores-cfdi-40",
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

describe("versionedKey and dayBefore", () => {
  it("dates a superseded key by its first day and ends a version the day before the next", () => {
    expect(versionedKey("anexo-20-guia-de-llenado/nodo-receptor-usocfdi.md", 20220101)).toBe(
      "anexo-20-guia-de-llenado/nodo-receptor-usocfdi.20220101.md",
    );
    expect(dayBefore(20260301)).toBe(20260228);
    expect(dayBefore(20240301)).toBe(20240229);
    expect(dayBefore(20260101)).toBe(20251231);
  });

  it("leaves room for the date in every passage key", () => {
    for (const { key } of corpus.passages) {
      expect(versionedKey(key, 20261231).length).toBeLessThanOrEqual(ITEM_KEY_MAX);
    }
  });
});

describe("ingestionPlan", () => {
  const V1 = 20250101;
  const V2 = 20260301;
  const passage = (key: string, sha256: string, validFrom = V1): Passage => ({
    key,
    sourceId: "a",
    heading: "A",
    body: sha256,
    sha256,
    metadata: { authority: "SAT", kind: "guia", valid_from: validFrom, valid_until: 99_991_231 },
  });
  const record = (
    key: string,
    sha256: string,
    validFrom = V1,
    validUntil = 99_991_231,
  ): PassageRecord => ({
    key,
    sourceId: "a",
    heading: "A",
    sha256,
    validFrom,
    validUntil,
  });
  const source = (sha256: string, validFrom: number): SourceRow => ({
    id: "a",
    title: "A",
    authority: "SAT",
    url: "https://sat.gob.mx/a.pdf",
    sha256,
    publishedAt: isoDate(validFrom),
    retrievedAt: "2026-10-25",
    validFrom,
    validUntil: 99_991_231,
  });
  const recorded = (...records: PassageRecord[]) =>
    new Map(records.map((entry) => [entry.key, entry]));

  it("uploads new, changed, missing and failed passages and deletes items no passage has", () => {
    const plan = ingestionPlan({
      passages: [
        passage("a/same.md", "1"),
        passage("a/changed.md", "2"),
        passage("a/new.md", "3"),
        passage("a/lost.md", "4"),
        passage("a/failed.md", "5"),
      ],
      sources: [source("s1", V1)],
      recordedSources: [source("s1", V1)],
      recorded: recorded(
        record("a/same.md", "1"),
        record("a/changed.md", "old"),
        record("a/lost.md", "4"),
        record("a/failed.md", "5"),
      ),
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
    expect(plan.remove).toEqual([{ id: "i3", key: "a/gone.md" }]);
    expect(plan.unchanged).toBe(1);
    // The same version re-split: replaced in place, nothing kept.
    expect(plan.supersede).toEqual([]);
    expect(plan.sourceVersions).toEqual([]);
    expect(plan.records.map((entry) => entry.key)).not.toContain("a/gone.md");
  });

  describe("a new version of a source", () => {
    const items = [
      { id: "i1", key: "a/same.md" },
      { id: "i2", key: "a/changed.md" },
      { id: "i3", key: "a/dropped.md" },
    ];
    const plan = ingestionPlan({
      passages: [
        passage("a/same.md", "1", V2),
        passage("a/changed.md", "2-new", V2),
        passage("a/added.md", "4", V2),
      ],
      sources: [source("s2", V2)],
      recordedSources: [source("s1", V1)],
      recorded: recorded(
        record("a/same.md", "1"),
        record("a/changed.md", "2"),
        record("a/dropped.md", "3"),
      ),
      items,
    });

    it("keeps the old text of a changed or dropped passage under its dated key until the day before", () => {
      expect(plan.supersede).toEqual([
        {
          from: { id: "i2", key: "a/changed.md" },
          record: record("a/changed.20250101.md", "2", V1, 20260228),
        },
        {
          from: { id: "i3", key: "a/dropped.md" },
          record: record("a/dropped.20250101.md", "3", V1, 20260228),
        },
      ]);
    });

    it("uploads the new text from the new version's first day and keeps an unchanged passage's", () => {
      expect(
        plan.upload.map((entry) => [entry.key, entry.sha256, entry.metadata.valid_from]),
      ).toEqual([
        ["a/changed.md", "2-new", V2],
        ["a/added.md", "4", V2],
      ]);
      expect(plan.unchanged).toBe(1);
      expect(plan.records).toEqual([
        record("a/same.md", "1", V1),
        record("a/changed.md", "2-new", V2),
        record("a/added.md", "4", V2),
        record("a/changed.20250101.md", "2", V1, 20260228),
        record("a/dropped.20250101.md", "3", V1, 20260228),
      ]);
    });

    it("deletes the dropped passage's current item and records the old source version", () => {
      expect(plan.remove).toEqual([{ id: "i3", key: "a/dropped.md" }]);
      expect(plan.sourceVersions).toEqual([{ ...source("s1", V1), validUntil: 20260228 }]);
    });

    it("plans the same records again after a run that stopped before D1", () => {
      // The copies and uploads landed; D1 still holds the first version.
      const again = ingestionPlan({
        passages: [
          passage("a/same.md", "1", V2),
          passage("a/changed.md", "2-new", V2),
          passage("a/added.md", "4", V2),
        ],
        sources: [source("s2", V2)],
        recordedSources: [source("s1", V1)],
        recorded: recorded(
          record("a/same.md", "1"),
          record("a/changed.md", "2"),
          record("a/dropped.md", "3"),
        ),
        items: [
          { id: "i1", key: "a/same.md" },
          { id: "i2", key: "a/changed.md" },
          { id: "i5", key: "a/added.md" },
          { id: "i6", key: "a/changed.20250101.md" },
          { id: "i7", key: "a/dropped.20250101.md" },
        ],
      });
      expect(again.supersede).toEqual([]);
      expect(again.records).toEqual(plan.records);
      expect(again.sourceVersions).toEqual(plan.sourceVersions);
      expect(again.remove).toEqual([]);
    });

    it("refuses when the passage to keep is not in AI Search", () => {
      expect(() =>
        ingestionPlan({
          passages: [],
          sources: [source("s2", V2)],
          recordedSources: [source("s1", V1)],
          recorded: recorded(record("a/changed.md", "2")),
          items: [],
        }),
      ).toThrow("a/changed.md is not in AI Search");
    });
  });

  it("keeps superseded passages on later runs and drops a removed source's", () => {
    const old = record("a/changed.20250101.md", "2", V1, 20260228);
    const other = { ...record("b/x.20250101.md", "9", V1, 20260228), sourceId: "b" };
    const plan = ingestionPlan({
      passages: [passage("a/changed.md", "2-new", V2)],
      sources: [source("s2", V2)],
      recordedSources: [source("s2", V2)],
      recorded: recorded(record("a/changed.md", "2-new", V2), old, other),
      items: [
        { id: "i2", key: "a/changed.md" },
        { id: "i6", key: "a/changed.20250101.md" },
        { id: "i8", key: "b/x.20250101.md" },
      ],
    });
    expect(plan.upload).toEqual([]);
    expect(plan.records).toEqual([record("a/changed.md", "2-new", V2), old]);
    expect(plan.remove).toEqual([{ id: "i8", key: "b/x.20250101.md" }]);
  });

  it("supersedes again from the day a passage first applied", () => {
    const V3 = 20270101;
    const plan = ingestionPlan({
      passages: [passage("a/same.md", "1-new", V3)],
      sources: [source("s3", V3)],
      recordedSources: [source("s2", V2)],
      // Unchanged in the second version, so it still applies from the first.
      recorded: recorded(record("a/same.md", "1", V1)),
      items: [{ id: "i1", key: "a/same.md" }],
    });
    expect(plan.supersede.map((entry) => entry.record)).toEqual([
      record("a/same.20250101.md", "1", V1, 20261231),
    ]);
  });
});
