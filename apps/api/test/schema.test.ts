import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

import {
  catalogEntries,
  errorCodes,
  IN_FORCE_UNTIL,
  passages,
  sources,
  sourceVersions,
} from "../src/db/schema";

const database = env.CODICE_DATABASE;
const db = drizzle(database);

const SOURCE = {
  id: "catalogos-cfdi-4.0",
  title: "Catálogos CFDI 4.0",
  authority: "SAT" as const,
  url: "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/catCFDI_V_4.xls",
  sha256: "0".repeat(64),
  publishedAt: null,
  retrievedAt: new Date("2026-10-24T00:00:00.000Z"),
  validFrom: 20220101,
};

beforeAll(async () => {
  await applyD1Migrations(database, env.TEST_MIGRATIONS);
  await db.insert(sources).values(SOURCE).onConflictDoNothing();
});

describe("D1 schema", () => {
  it("keeps a source in force until 99991231 unless it ends", async () => {
    const [row] = await db.select().from(sources).where(eq(sources.id, SOURCE.id));

    expect(row).toEqual({ ...SOURCE, validUntil: IN_FORCE_UNTIL });
    expect(IN_FORCE_UNTIL).toBe(99991231);
  });

  it("rejects an authority outside the known set", async () => {
    await expect(
      db.insert(sources).values({ ...SOURCE, id: "unknown-authority", authority: "IMSS" as "SAT" }),
    ).rejects.toThrow();
  });

  it("rejects a validity range that ends before it starts", async () => {
    await expect(
      db
        .insert(sources)
        .values({ ...SOURCE, id: "inverted", validFrom: 20260101, validUntil: 20251231 }),
    ).rejects.toThrow();
  });

  it("keeps a passage in force until 99991231 and refuses one that ends before it starts", async () => {
    const passage = { sourceId: SOURCE.id, heading: "H", sha256: "1", validFrom: 20220101 };
    await db.insert(passages).values({ ...passage, key: `${SOURCE.id}/a.md` });
    const [row] = await db
      .select()
      .from(passages)
      .where(eq(passages.key, `${SOURCE.id}/a.md`));

    expect(row?.validUntil).toBe(IN_FORCE_UNTIL);
    await expect(
      db.insert(passages).values({ ...passage, key: `${SOURCE.id}/b.md`, validUntil: 20211231 }),
    ).rejects.toThrow();
  });

  it("holds one row per superseded version of a source", async () => {
    const version = {
      sourceId: SOURCE.id,
      title: SOURCE.title,
      url: SOURCE.url,
      sha256: "2".repeat(64),
      publishedAt: null,
      retrievedAt: SOURCE.retrievedAt,
      validFrom: 20200101,
      validUntil: 20211231,
    };
    await db.insert(sourceVersions).values(version);

    await expect(db.insert(sourceVersions).values(version)).rejects.toThrow();
    await expect(
      db.insert(sourceVersions).values({ ...version, validFrom: 20190101, validUntil: 20181231 }),
    ).rejects.toThrow();
    await expect(
      db.insert(sourceVersions).values({ ...version, sourceId: "missing", validFrom: 20190101 }),
    ).rejects.toThrow();
  });

  it("looks up an error code exactly and ties it to its source", async () => {
    await db.insert(errorCodes).values({
      code: "CFDI40149",
      node: "Receptor",
      attribute: "DomicilioFiscalReceptor",
      validation:
        "Debe pertenecer al nombre asociado al RFC registrado en el campo Rfc del Receptor.",
      message: "El campo DomicilioFiscalReceptor del receptor, debe pertenecer al nombre asociado.",
      sourceId: SOURCE.id,
    });

    const [row] = await db.select().from(errorCodes).where(eq(errorCodes.code, "CFDI40149"));

    expect(row?.sourceId).toBe(SOURCE.id);
    // A code is one row: the ingestion replaces it, never duplicates it.
    await expect(db.insert(errorCodes).values(row!)).rejects.toThrow();
  });

  it("refuses a record whose source does not exist", async () => {
    await expect(
      db.insert(errorCodes).values({
        code: "CFDI40101",
        node: "Comprobante",
        attribute: "Fecha",
        validation: "Patrón de fecha.",
        message: "El campo Fecha no cumple con el patrón requerido.",
        sourceId: "missing-source",
      }),
    ).rejects.toThrow();
  });

  it("holds one catalog key in several rows, with its fields as JSON", async () => {
    const rows: Record<string, string>[] = [
      { c_TasaOCuota: "0.160000", Impuesto: "IVA", Factor: "Tasa", Traslado: "Sí" },
      { c_TasaOCuota: "0.160000", Impuesto: "IVA", Factor: "Tasa", Retención: "No" },
    ];
    await db.insert(catalogEntries).values(
      rows.map((fields) => ({
        catalog: "c_TasaOCuota",
        key: "0.160000",
        fields,
        sourceId: SOURCE.id,
        validFrom: 20220101,
      })),
    );

    const stored = await db
      .select()
      .from(catalogEntries)
      .where(and(eq(catalogEntries.catalog, "c_TasaOCuota"), eq(catalogEntries.key, "0.160000")));

    expect(stored.map((row) => row.fields)).toEqual(rows);
    expect(stored.every((row) => row.validUntil === IN_FORCE_UNTIL)).toBe(true);
  });

  it("looks a catalog entry up through the (catalog, key) index, in any case", async () => {
    // The lookup in `records.ts` compares NOCASE; c_CodigoPostal alone holds ~95k rows.
    const plan = await database
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM catalog_entries WHERE catalog = ? COLLATE NOCASE AND key = ? COLLATE NOCASE ORDER BY id",
      )
      .bind("c_codigopostal", "01000")
      .all<{ detail: string }>();

    expect(plan.results.map((step) => step.detail)).toContain(
      "SEARCH catalog_entries USING INDEX catalog_entries_catalog_key_idx (catalog=? AND key=?)",
    );
  });
});
