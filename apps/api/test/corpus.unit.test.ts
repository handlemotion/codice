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
  stuckItem,
  type Passage,
  type PassageRecord,
  type SourceRow,
  settledRecords,
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
      expect(key).toMatch(/^[a-z0-9-]+\/[a-z0-9][a-z0-9.-]*\.md$/u);
    }
  });

  it("splits both guides, the matrix, the RMF and the CFF into passages with their metadata", () => {
    const sources = new Set(corpus.passages.map((passage) => passage.sourceId));
    expect([...sources]).toEqual([
      "anexo-20-guia-de-llenado",
      "complemento-pagos-guia-de-llenado",
      "matriz-de-errores-cfdi-40",
      "rmf-2026",
      "cff",
    ]);
    for (const passage of corpus.passages) {
      expect(passage.metadata.authority).toBe(passage.sourceId === "cff" ? "Congreso" : "SAT");
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

  it("quotes an article of the CFF under its heading path, valid from the law's last reform", () => {
    const article = corpus.passages.find((candidate) => candidate.key === "cff/articulo-29-a.md");
    expect(article?.body).toMatch(
      /^# Código Fiscal de la Federación \(texto vigente\) › TITULO SEGUNDO\. .* › CAPITULO UNICO › Artículo 29-A\n\nArtículo 29-A\. Los comprobantes fiscales digitales/u,
    );
    expect(article?.metadata).toEqual({
      authority: "Congreso",
      kind: "ley",
      valid_from: 20_260_409,
      valid_until: 99_991_231,
    });
    const keys = corpus.passages.map((candidate) => candidate.key);
    expect(keys).toContain("cff/articulo-1.md");
    expect(keys).toContain("cff/articulo-17-h-bis.md");
    expect(keys).toContain("cff/articulo-20-bis.md");
    expect(keys).not.toContain("cff/articulo-29-b.md");
    expect(corpus.sources.find((source) => source.id === "cff")).toMatchObject({
      authority: "Congreso",
      url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
      publishedAt: "2026-04-09",
      validFrom: 20_260_409,
    });
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
      "cff",
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
    // As `passage` builds it: the body is the hash.
    body: sha256,
    kind: "guia",
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

  it("uploads new, changed, missing and stuck passages and deletes items no passage has", () => {
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
    expect(plan.repair).toEqual([{ id: "i4", key: "a/failed.md" }]);
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

  it("supersedes an amended regla the day before its own new text starts", () => {
    const AMENDED = 20260709;
    const plan = ingestionPlan({
      passages: [passage("a/regla-2.7.1.21.md", "new", AMENDED), passage("a/same.md", "1", V1)],
      // The compilation changed, but it is still the RMF published on V1.
      sources: [source("s2", V1)],
      recordedSources: [source("s1", V1)],
      recorded: recorded(record("a/regla-2.7.1.21.md", "old", V1), record("a/same.md", "1", V1)),
      items: [
        { id: "i1", key: "a/regla-2.7.1.21.md" },
        { id: "i2", key: "a/same.md" },
      ],
    });
    expect(plan.supersede).toEqual([
      {
        from: { id: "i1", key: "a/regla-2.7.1.21.md" },
        record: record("a/regla-2.7.1.21.20250101.md", "old", V1, 20260708),
      },
    ]);
    expect(plan.upload.map((entry) => [entry.key, entry.metadata.valid_from])).toEqual([
      ["a/regla-2.7.1.21.md", AMENDED],
    ]);
    // No new version of the source, so no source version ends.
    expect(plan.sourceVersions).toEqual([]);
  });

  it("replaces a changed passage in place when its new text starts no later", () => {
    const plan = ingestionPlan({
      passages: [passage("a/x.md", "new", V1)],
      sources: [source("s2", V1)],
      recordedSources: [source("s1", V1)],
      recorded: recorded(record("a/x.md", "old", V1)),
      items: [{ id: "i1", key: "a/x.md" }],
    });
    expect(plan.supersede).toEqual([]);
    expect(plan.records).toEqual([record("a/x.md", "new", V1)]);
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

  it("deletes stuck items before uploading their passages again", () => {
    const plan = ingestionPlan({
      passages: [passage("a/timed-out.md", "1"), passage("a/reindexing.md", "2")],
      sources: [source("s1", V1)],
      recordedSources: [source("s1", V1)],
      recorded: recorded(record("a/timed-out.md", "1"), record("a/reindexing.md", "2")),
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

  it("copies a stuck superseded passage out of itself before the repair deletes it", () => {
    const old = record("a/x.20250101.md", "old", V1, 20260228);
    const plan = ingestionPlan({
      passages: [passage("a/x.md", "new", V2)],
      sources: [source("s2", V2)],
      recordedSources: [source("s2", V2)],
      recorded: recorded(record("a/x.md", "new", V2), old),
      items: [
        { id: "i1", key: "a/x.md" },
        { id: "i2", key: "a/x.20250101.md", status: "outdated", next_action: null },
      ],
    });
    expect(plan.supersede).toEqual([{ from: { id: "i2", key: "a/x.20250101.md" }, record: old }]);
    expect(plan.repair).toEqual([{ id: "i2", key: "a/x.20250101.md" }]);
    expect(plan.records).toContainEqual(old);
    expect(plan.remove).toEqual([]);
  });

  it("copies a superseded passage from a stuck current item", () => {
    const plan = ingestionPlan({
      passages: [passage("a/x.md", "new", V2)],
      sources: [source("s2", V2)],
      recordedSources: [source("s1", V1)],
      recorded: recorded(record("a/x.md", "old", V1)),
      items: [{ id: "i1", key: "a/x.md", status: "error" }],
    });
    expect(plan.supersede).toEqual([
      { from: { id: "i1", key: "a/x.md" }, record: record("a/x.20250101.md", "old", V1, 20260228) },
    ]);
    expect(plan.repair).toEqual([{ id: "i1", key: "a/x.md" }]);
    expect(plan.upload.map((entry) => entry.key)).toEqual(["a/x.md"]);
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

describe("settledRecords", () => {
  const V1 = 20250101;
  const V2 = 20260301;
  const record = (key: string, body: string, validFrom = V1, validUntil = 99_991_231) => ({
    key,
    sourceId: "a",
    heading: "A",
    sha256: body,
    body,
    kind: "regla",
    validFrom,
    validUntil,
  });
  const byKey = (...records: ReturnType<typeof record>[]) =>
    new Map(records.map((entry) => [entry.key, entry]));

  it("writes every record when every item indexed", () => {
    const records = [record("a/x.md", "new", V2), record("a/x.20250101.md", "old", V1, 20260228)];

    expect(settledRecords(records, byKey(record("a/x.md", "old")), new Set())).toEqual(records);
  });

  it("records what indexed and leaves out a new passage that did not", () => {
    const records = [record("a/ok.md", "1"), record("a/stuck.md", "2")];

    expect(settledRecords(records, new Map(), new Set(["a/stuck.md"]))).toEqual([
      record("a/ok.md", "1"),
    ]);
  });

  it("keeps a stuck changed passage's earlier record and drops the copy made from it", () => {
    const earlier = record("a/x.md", "old", V1);
    const records = [record("a/x.md", "new", V2), record("a/x.20250101.md", "old", V1, 20260228)];

    // As a run that stopped before D1 leaves it: the next run supersedes the old text again.
    expect(settledRecords(records, byKey(earlier), new Set(["a/x.md"]))).toEqual([earlier]);
  });

  it("writes a superseded copy even when its own item is stuck", () => {
    const copy = record("a/x.20250101.md", "old", V1, 20260228);
    const records = [record("a/x.md", "new", V2), copy];

    expect(
      settledRecords(records, byKey(record("a/x.md", "old")), new Set(["a/x.20250101.md"])),
    ).toEqual(records);
  });

  it("keeps a superseded record an earlier run wrote when its current passage is reverted", () => {
    const kept = record("a/x.20240101.md", "older", 20240101, 20241231);
    const earlier = record("a/x.md", "old", V1);
    const records = [
      record("a/x.md", "new", V2),
      record("a/x.20250101.md", "old", V1, 20260228),
      kept,
    ];

    expect(settledRecords(records, byKey(earlier, kept), new Set(["a/x.md"]))).toEqual([
      earlier,
      kept,
    ]);
  });
});
