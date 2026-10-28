import * as Sentry from "@sentry/cloudflare";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  catalogEntries,
  errorCodes,
  IN_FORCE_UNTIL,
  passages,
  sources,
  sourceVersions,
} from "./db/schema";
import type { CodiceBindings } from "./env";
import { dateNumber, isoDate, searchWords } from "./search";

/**
 * Exact lookups and provenance from D1 `codice` (SPEC.md, "Records and provenance"). Only the
 * ingestion writes it, so every read may go to the nearest read replica: a session that starts
 * `first-unconstrained`. Each query is a Sentry span.
 */
export function recordsDatabase(env: CodiceBindings) {
  if (!env.CODICE_DATABASE) throw new Error("CODICE_DATABASE is not bound");
  const session = Sentry.instrumentD1WithSentry(env.CODICE_DATABASE).withSession(
    "first-unconstrained",
  );
  // Drizzle types its client as a D1Database; it calls only `prepare` and `batch`, which a
  // session has.
  return drizzle(session as unknown as D1Database);
}

type Database = ReturnType<typeof recordsDatabase>;

export function validity(validFrom: number, validUntil: number) {
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

/**
 * How long an isolate keeps the `sources` table: a few rows only the ingestion writes, which
 * every search and lookup cites. An ingestion's change shows within this time.
 */
export const SOURCES_CACHE_MS = 5 * 60 * 1000;

let sourcesCache: { readonly at: number; readonly byId: ReadonlyMap<string, SourceProvenance> } = {
  at: -Infinity,
  byId: new Map(),
};

/** Every source, by id; it refreshes the isolate's copy. */
export async function allSources(db: Database): Promise<SourceProvenance[]> {
  const rows = (await db.select().from(sources).orderBy(asc(sources.id))).map(provenanceOf);
  sourcesCache = { at: Date.now(), byId: new Map(rows.map((row) => [row.id, row])) };
  return rows;
}

/**
 * The sources by id, from the isolate's copy of the table; an id D1 does not hold is left out. A
 * copy older than `SOURCES_CACHE_MS`, or one without an id asked for, is read again first.
 */
export async function sourcesById(
  db: Database,
  ids: readonly string[],
): Promise<ReadonlyMap<string, SourceProvenance>> {
  if (ids.length === 0) return new Map();
  const fresh = Date.now() - sourcesCache.at < SOURCES_CACHE_MS;
  if (!fresh || ids.some((id) => !sourcesCache.byId.has(id))) await allSources(db);
  return new Map(
    ids.flatMap((id) => {
      const source = sourcesCache.byId.get(id);
      return source ? [[id, source] as const] : [];
    }),
  );
}

let corpusCache: { readonly at: number; readonly version: string } = { at: -Infinity, version: "" };

/**
 * A hash of what a search can return: each source's hash and each passage's hash, kind and
 * validity, the rows the ingestion writes after it uploads (a re-split changes passages under the
 * same source hash). It keys the search cache (`search-cache.ts`); the isolate keeps it
 * `SOURCES_CACHE_MS`.
 */
export async function corpusVersion(db: Database): Promise<string> {
  if (Date.now() - corpusCache.at < SOURCES_CACHE_MS) return corpusCache.version;
  const [sourceRows, passageRows] = await Promise.all([
    db.select({ id: sources.id, sha256: sources.sha256 }).from(sources).orderBy(asc(sources.id)),
    db
      .select({
        key: passages.key,
        sha256: passages.sha256,
        kind: passages.kind,
        validFrom: passages.validFrom,
        validUntil: passages.validUntil,
      })
      .from(passages)
      .orderBy(asc(passages.key)),
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([sourceRows, passageRows])),
  );
  const version = Array.from(new Uint8Array(digest, 0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  corpusCache = { at: Date.now(), version };
  return version;
}

/**
 * The sources by id as they read on `date` (`YYYYMMDD`): the version in force, or the superseded
 * version that applied that day (SPEC.md, "Versions"). A source D1 does not hold is left out; one
 * with no version that day (a date before its first) answers its current version.
 */
export async function sourcesOn(
  db: Database,
  ids: readonly string[],
  date: number,
): Promise<ReadonlyMap<string, SourceProvenance>> {
  const current = await sourcesById(db, ids);
  const earlier = [...current.values()]
    .filter((source) => dateNumber(source.validFrom) > date)
    .map((source) => source.id);
  if (earlier.length === 0) return current;
  const versions = await db
    .select()
    .from(sourceVersions)
    .where(
      and(
        inArray(sourceVersions.sourceId, earlier),
        lte(sourceVersions.validFrom, date),
        gte(sourceVersions.validUntil, date),
      ),
    );
  const byId = new Map(current);
  for (const { sourceId, ...version } of versions) {
    const source = current.get(sourceId);
    if (!source) continue;
    byId.set(sourceId, {
      ...source,
      ...version,
      retrievedAt: version.retrievedAt.toISOString(),
      ...validity(version.validFrom, version.validUntil),
    });
  }
  return byId;
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

/** Words too common to narrow a description search; a query of only these keeps them. */
const CATALOG_SEARCH_STOPWORDS = new Set(
  "a al con de del el en la las los o para por un una y an and for in of the to".split(" "),
);

/**
 * The words of a description search (`searchWords`) as FTS5 prefix terms, never the caller's own
 * syntax. Empty when the query has no letter or digit.
 */
export function catalogSearchTerms(query: string) {
  const words = searchWords(query);
  const meaningful = words.filter((word) => !CATALOG_SEARCH_STOPWORDS.has(word));
  return [...new Set(meaningful.length > 0 ? meaningful : words)].map((word) => `"${word}"*`);
}

type CatalogSearchRow = {
  readonly catalog: string;
  readonly key: string;
  readonly fields: string;
  readonly sourceId: string;
  readonly validFrom: number;
  readonly validUntil: number;
};

/**
 * The catalog's entries whose key or descriptions match the query (SPEC.md, "Catalog search"):
 * first those with a line that is the whole query (the key `kgm`, the name `kilogramo`), then by
 * BM25, then in the SAT's order. Every term must match; when that finds nothing, any term may, so
 * the entries that match the most terms come first.
 */
async function catalogMatches(db: Database, name: string, query: string, limit: number) {
  const catalog = catalogName(name);
  const terms = catalogSearchTerms(query);
  const line = `\n${searchWords(query).join(" ")}\n`;
  // The catalog as an FTS5 phrase: the index tokenizes `c_UsoCFDI` as `c usocfdi`.
  const inCatalog = `{catalog} : "${catalog.replaceAll('"', "")}"`;
  for (const operator of terms.length > 1 ? [" ", " OR "] : [" "]) {
    const match = `${inCatalog} AND {search_text} : (${terms.join(operator)})`;
    const rows = await db.all<CatalogSearchRow>(
      sql`SELECT entry.catalog AS catalog, entry.key AS key, entry.fields AS fields, entry.source_id AS sourceId, entry.valid_from AS validFrom, entry.valid_until AS validUntil FROM catalog_entries_fts JOIN ${catalogEntries} AS entry ON entry.id = catalog_entries_fts.rowid WHERE catalog_entries_fts MATCH ${match} AND entry.catalog = ${catalog} COLLATE NOCASE ORDER BY instr(char(10) || entry.search_text || char(10), ${line}) = 0, bm25(catalog_entries_fts, 0, 1), entry.id LIMIT ${limit}`,
    );
    if (rows.length > 0) return rows;
  }
  return [];
}

/**
 * Searches a catalog by description: `{ catalog, query, entries, source }`, each entry with its
 * key, fields and validity, as a listing gives them. Null when D1 holds no such catalog.
 */
export async function catalogSearch(db: Database, name: string, query: string, limit: number) {
  const rows = await catalogMatches(db, name, query, limit);
  const [first] =
    rows.length > 0
      ? rows
      : await db
          .select({ catalog: catalogEntries.catalog, sourceId: catalogEntries.sourceId })
          .from(catalogEntries)
          .where(sql`${catalogEntries.catalog} = ${catalogName(name)} COLLATE NOCASE`)
          .limit(1);
  if (!first) return null;
  const provenance = await sourcesById(db, [first.sourceId]);
  return {
    catalog: first.catalog,
    query,
    entries: rows.map((row) => ({
      key: row.key,
      fields: JSON.parse(row.fields) as Record<string, string | null>,
      ...validity(row.validFrom, row.validUntil),
    })),
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
