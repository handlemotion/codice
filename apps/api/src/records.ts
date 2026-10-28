import * as Sentry from "@sentry/cloudflare";
import { and, asc, eq, gte, inArray, lte, min, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  catalogEntries,
  errorCodes,
  IN_FORCE_UNTIL,
  passageLinks,
  passages,
  sources,
  sourceVersions,
} from "./db/schema";
import type { CodiceBindings } from "./env";
import { dateNumber, isoDate } from "./search";

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

/**
 * The matrix rows of the codes, by their `matrixCode`, in one query, each with its passage, the
 * guide passages that passage links to (`related`) and its source; an unknown code is left out.
 */
export async function errorCodeRows(db: Database, codes: readonly string[]) {
  const rows = (
    await db
      .select()
      .from(errorCodes)
      .where(inArray(errorCodes.code, [...new Set(codes.map(matrixCode))]))
  ).map((row) => ({ ...row, passageId: errorCodePassageId(row.sourceId, row.code) }));
  const [related, provenance] = await Promise.all([
    relatedPassagesOf(
      db,
      rows.map((row) => row.passageId),
    ),
    sourcesById(db, [...new Set(rows.map((row) => row.sourceId))]),
  ]);
  return new Map(
    rows.map((row) => [
      row.code,
      {
        ...row,
        related: related.get(row.passageId) ?? [],
        source: provenance.get(row.sourceId) ?? null,
      },
    ]),
  );
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
/** Each passage's heading path by key, for brief search results; at most 50 keys, one query. */
export async function passageHeadings(
  db: Database,
  keys: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({ key: passages.key, heading: passages.heading })
    .from(passages)
    .where(inArray(passages.key, [...new Set(keys)]));
  return new Map(rows.map((row) => [row.key, row.heading]));
}

export async function passageRow(db: Database, key: string) {
  const [row] = await db.select().from(passages).where(eq(passages.key, key)).limit(1);
  return row ?? null;
}

/** The passage ids a passage links to, in its text's order (SPEC.md, "Related passages"). */
export async function relatedPassages(db: Database, key: string) {
  return (await relatedPassagesOf(db, [key])).get(key) ?? [];
}

/** The passage ids each passage links to, by its key, in one query; a passage without links is left out. */
async function relatedPassagesOf(db: Database, keys: readonly string[]) {
  const related = new Map<string, string[]>();
  if (keys.length === 0) return related;
  const rows = await db
    .select({ from: passageLinks.passageKey, to: passageLinks.relatedKey })
    .from(passageLinks)
    .where(inArray(passageLinks.passageKey, [...keys]))
    .orderBy(asc(passageLinks.passageKey), asc(passageLinks.position));
  for (const row of rows) related.set(row.from, [...(related.get(row.from) ?? []), row.to]);
  return related;
}

/** A `YYYYMMDD` date moved by whole days: `addDays(20260301, -1)` is `20260228`. */
export function addDays(date: number, days: number): number {
  const day = new Date(
    Date.UTC(Math.floor(date / 10000), (Math.floor(date / 100) % 100) - 1, date % 100),
  );
  day.setUTCDate(day.getUTCDate() + days);
  return dateNumber(day.toISOString());
}

/** A superseded passage's dated key back to the key its passage has in force (`versionedKey`). */
function currentKey(key: string) {
  return key.replace(/\.\d{8}\.md$/u, ".md");
}

export type PassageChange = {
  /** `changed` with no `previousPassageId` when Códice holds no text from before `date`. */
  readonly change: "added" | "changed" | "removed";
  /** The day the change applies from, ISO. */
  readonly date: string;
  /** The text in force from `date`; for `removed`, the dated id of the last text. */
  readonly passageId: string;
  /** For `changed`, the dated id of the text that applied until the day before `date`. */
  readonly previousPassageId: string | null;
  readonly source: string;
  readonly heading: string;
  readonly kind: string | null;
  /** The validity of `passageId`'s text. */
  readonly validFrom: string;
  readonly validUntil: string | null;
};

/**
 * The passages added, changed or removed from `since` through `until` (`YYYYMMDD`), from the
 * passages' validity alone (SPEC.md, "Changes"). A text that starts the day after the passage's
 * previous text ended is a change of it; a text that ends with none after it is removed the next
 * day. A text that starts with none before it is added when Códice held an earlier version of its
 * source then, and otherwise a change Códice holds no earlier text of (an amendment the first
 * version Códice loaded already carried, such as an RMF regla from the Primera RMRMF). The texts
 * that start on a source's earliest date are where its history starts, not changes.
 */
export async function passageChanges(
  db: Database,
  since: number,
  until: number,
  source?: string,
): Promise<PassageChange[]> {
  const rows = await db
    .select({
      key: passages.key,
      sourceId: passages.sourceId,
      heading: passages.heading,
      kind: passages.kind,
      validFrom: passages.validFrom,
      validUntil: passages.validUntil,
    })
    .from(passages)
    .where(
      and(
        source === undefined ? undefined : eq(passages.sourceId, source),
        or(
          and(gte(passages.validFrom, since), lte(passages.validFrom, until)),
          and(
            gte(passages.validUntil, addDays(since, -1)),
            lte(passages.validUntil, addDays(until, -1)),
          ),
        ),
      ),
    );
  const sourceIds = [...new Set(rows.map((row) => row.sourceId))];
  const [current, versions, firsts] = await Promise.all([
    sourcesById(db, sourceIds),
    sourceIds.length === 0
      ? []
      : db
          .select({ sourceId: sourceVersions.sourceId, validFrom: sourceVersions.validFrom })
          .from(sourceVersions)
          .where(inArray(sourceVersions.sourceId, sourceIds)),
    sourceIds.length === 0
      ? []
      : db
          .select({ sourceId: passages.sourceId, validFrom: min(passages.validFrom) })
          .from(passages)
          .where(inArray(passages.sourceId, sourceIds))
          .groupBy(passages.sourceId),
  ]);
  // The days each version of a source starts, and the earliest day any of its passages applies.
  const versionStarts = new Map<string, number[]>();
  for (const { id, validFrom } of current.values()) {
    versionStarts.set(id, [dateNumber(validFrom)]);
  }
  for (const { sourceId, validFrom } of versions) versionStarts.get(sourceId)?.push(validFrom);
  const historyStarts = new Map(firsts.map(({ sourceId, validFrom }) => [sourceId, validFrom]));

  // The texts that ended, by the passage's current key and their last day.
  const ended = new Map<string, (typeof rows)[number]>(
    rows
      .filter((row) => row.validUntil !== IN_FORCE_UNTIL)
      .map((row) => [`${currentKey(row.key)} ${row.validUntil}`, row]),
  );
  const changes: PassageChange[] = [];
  const entry = (
    change: PassageChange["change"],
    date: number,
    row: (typeof rows)[number],
    previousPassageId: string | null = null,
  ): PassageChange => ({
    change,
    date: isoDate(date),
    passageId: row.key,
    previousPassageId,
    source: row.sourceId,
    heading: row.heading,
    kind: row.kind,
    ...validity(row.validFrom, row.validUntil),
  });
  for (const row of rows) {
    if (row.validFrom < since || row.validFrom > until) continue;
    const endedKey = `${currentKey(row.key)} ${addDays(row.validFrom, -1)}`;
    const previous = ended.get(endedKey);
    if (previous) {
      ended.delete(endedKey);
      changes.push(entry("changed", row.validFrom, row, previous.key));
      continue;
    }
    if (row.validFrom <= (historyStarts.get(row.sourceId) ?? row.validFrom)) continue;
    // Two versions started by then: Códice held the source before the one this text is in.
    const heldBefore =
      (versionStarts.get(row.sourceId) ?? []).filter((start) => start <= row.validFrom).length > 1;
    changes.push(entry(heldBefore ? "added" : "changed", row.validFrom, row));
  }
  for (const row of ended.values()) {
    const date = addDays(row.validUntil, 1);
    if (date >= since && date <= until) changes.push(entry("removed", date, row));
  }
  return changes.sort(
    (a, b) => a.date.localeCompare(b.date) || a.passageId.localeCompare(b.passageId),
  );
}
