import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { catalogEntries, errorCodes, IN_FORCE_UNTIL, passages, sources } from "./db/schema";
import type { CodiceBindings } from "./env";
import { isoDate } from "./search";

/** Exact lookups and provenance from D1 `codice` (SPEC.md, "Records and provenance"). */
export function recordsDatabase(env: CodiceBindings) {
  if (!env.CODICE_DATABASE) throw new Error("CODICE_DATABASE is not bound");
  return drizzle(env.CODICE_DATABASE);
}

type Database = ReturnType<typeof recordsDatabase>;

function validity(validFrom: number, validUntil: number) {
  return {
    validFrom: isoDate(validFrom),
    validUntil: validUntil === IN_FORCE_UNTIL ? null : isoDate(validUntil),
  };
}

export type SourceProvenance = {
  readonly id: string;
  readonly title: string;
  readonly authority: string;
  readonly url: string;
  readonly sha256: string;
  readonly publishedAt: string | null;
  /** When the ingestion fetched it, ISO. */
  readonly retrievedAt: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
};

function provenanceOf({
  validFrom,
  validUntil,
  retrievedAt,
  ...row
}: typeof sources.$inferSelect): SourceProvenance {
  return { ...row, retrievedAt: retrievedAt.toISOString(), ...validity(validFrom, validUntil) };
}

/** Every source, by id. */
export async function allSources(db: Database): Promise<SourceProvenance[]> {
  const rows = await db.select().from(sources).orderBy(asc(sources.id));
  return rows.map(provenanceOf);
}

/** The sources by id; an id D1 does not hold is left out. */
export async function sourcesById(
  db: Database,
  ids: readonly string[],
): Promise<ReadonlyMap<string, SourceProvenance>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(sources)
    .where(inArray(sources.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, provenanceOf(row)]));
}

/**
 * The code as the matrix spells it: uppercase, and CFDI40223 to CFDI40228 as the SAT's
 * CFDI140223 to CFDI140228, as a PAC may quote them.
 */
export function matrixCode(code: string) {
  return code
    .trim()
    .toUpperCase()
    .replace(/^CFDI(4022[3-8])$/u, "CFDI1$1");
}

/**
 * The search passage of one matrix row, anchored by its code as the ingestion anchors it
 * (`anchorOf` in `scripts/corpus.ts`): `CFDI40149` is `matriz-de-errores-cfdi-40/cfdi40149.md`.
 */
export function errorCodePassageId(sourceId: string, code: string) {
  return `${sourceId}/${code.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}.md`;
}

export async function errorCode(db: Database, code: string) {
  const [row] = await db
    .select()
    .from(errorCodes)
    .where(eq(errorCodes.code, matrixCode(code)))
    .limit(1);
  if (!row) return null;
  const provenance = await sourcesById(db, [row.sourceId]);
  return {
    ...row,
    passageId: errorCodePassageId(row.sourceId, row.code),
    source: provenance.get(row.sourceId) ?? null,
  };
}

/** `UsoCFDI` and `c_usocfdi` both name c_UsoCFDI. */
export function catalogName(name: string) {
  const trimmed = name.trim();
  return /^c_/iu.test(trimmed) ? trimmed : `c_${trimmed}`;
}

/** The (catalog, key) match the NOCASE index serves. */
function catalogKeyMatch(name: string, key: string) {
  return and(
    sql`${catalogEntries.catalog} = ${catalogName(name)} COLLATE NOCASE`,
    sql`${catalogEntries.key} = ${key.trim()} COLLATE NOCASE`,
  );
}

/** A column filter on an entry's `fields`, as `[column, value]`. */
export type CatalogFilter = readonly [column: string, value: string];

/**
 * The catalog's entries for one key; c_TasaOCuota can hold several, c_Colonia one per postal code.
 * Each filter keeps the entries whose `fields[column]` equals its value, after the indexed match.
 * The JSON path is bound like the value, never spliced into the SQL.
 */
export async function catalogEntry(
  db: Database,
  name: string,
  key: string,
  filters: readonly CatalogFilter[] = [],
) {
  const rows = await db
    .select()
    .from(catalogEntries)
    .where(
      and(
        catalogKeyMatch(name, key),
        ...filters.map(
          ([column, value]) =>
            sql`json_extract(${catalogEntries.fields}, ${`$."${column}"`}) = ${value} COLLATE NOCASE`,
        ),
      ),
    )
    // The ingestion inserts a catalog in its sheet's order, so the id keeps the SAT's order.
    .orderBy(catalogEntries.id);
  const first = rows[0];
  if (!first) return null;
  const provenance = await sourcesById(db, [first.sourceId]);
  return {
    catalog: first.catalog,
    key: first.key,
    entries: rows.map((row) => ({
      fields: row.fields,
      ...validity(row.validFrom, row.validUntil),
    })),
    source: provenance.get(first.sourceId) ?? null,
  };
}

/** The most entries one catalog listing returns; the largest small catalog, c_Pais, has 250. */
export const CATALOG_LIST_MAX = 500;

/** A whole catalog in the SAT's order, up to `CATALOG_LIST_MAX` entries. */
export async function catalogListing(db: Database, name: string) {
  const rows = await db
    .select()
    .from(catalogEntries)
    .where(sql`${catalogEntries.catalog} = ${catalogName(name)} COLLATE NOCASE`)
    .orderBy(catalogEntries.id)
    .limit(CATALOG_LIST_MAX + 1);
  const first = rows[0];
  if (!first) return null;
  const provenance = await sourcesById(db, [first.sourceId]);
  return {
    catalog: first.catalog,
    entries: rows.slice(0, CATALOG_LIST_MAX).map((row) => ({
      key: row.key,
      fields: row.fields,
      ...validity(row.validFrom, row.validUntil),
    })),
    truncated: rows.length > CATALOG_LIST_MAX,
    source: provenance.get(first.sourceId) ?? null,
  };
}

/**
 * The columns the key's entries hold, sorted. The ingestion leaves out an empty cell, so a column
 * that is empty in every entry of the key is not among them. Empty when the key is unknown.
 */
export async function catalogColumns(db: Database, name: string, key: string) {
  const rows = await db.all<{ name: string }>(
    sql`SELECT DISTINCT field.key AS name FROM ${catalogEntries}, json_each(${catalogEntries.fields}) AS field WHERE ${catalogKeyMatch(name, key)} ORDER BY name`,
  );
  return rows.map((row) => row.name);
}

/** The ingestion's row for one AI Search item key. */
export async function passageRow(db: Database, key: string) {
  const [row] = await db.select().from(passages).where(eq(passages.key, key)).limit(1);
  return row ?? null;
}
