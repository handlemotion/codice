import type { CodiceBindings } from "./env";
import {
  allSources,
  catalogColumns,
  catalogEntry,
  catalogListing,
  type CatalogFilter,
  errorCode,
  passageRow,
  recordsDatabase,
  sourcesById,
  sourcesOn,
  validity,
} from "./records";
import {
  parseAsOf,
  PASSAGE_KINDS,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  searchRequest,
  searchResults,
  todayInMexicoCity,
  isoDate,
  passageMetadata,
} from "./search";
import { measured } from "./timing";

/** A request Códice refuses, as a problem document's fields. */
export class CodiceProblem extends Error {
  constructor(
    readonly status: 400 | 404 | 502 | 503,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
    this.name = "CodiceProblem";
  }
}

export type SearchParameters = {
  readonly q?: string | undefined;
  readonly asOf?: string | undefined;
  readonly source?: string | undefined;
  readonly kind?: string | undefined;
  readonly limit?: string | number | undefined;
};

const QUERY_MAX = 1000;
const SOURCE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
/** An AI Search item key, `<source>/<anchor>.md`, at most 128 characters (SPEC.md, "Items"). */
const PASSAGE_ID = /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9.-]*\.md$/u;
const PASSAGE_ID_MAX = 128;

function invalid(detail: string) {
  return new CodiceProblem(400, "invalid_request", "Invalid request", detail);
}

/** The search input from query parameters or MCP arguments, validated. */
export function searchInput(parameters: SearchParameters, now: Date = new Date()) {
  const q = parameters.q?.trim() ?? "";
  if (!q) throw invalid("`q` is required.");
  if (q.length > QUERY_MAX) throw invalid(`\`q\` is longer than ${QUERY_MAX} characters.`);
  const asOf = parameters.asOf ? parseAsOf(parameters.asOf) : todayInMexicoCity(now);
  if (asOf === null) throw invalid("`asOf` must be a date as YYYY-MM-DD.");
  const source = parameters.source?.trim() || undefined;
  if (source && !SOURCE.test(source)) throw invalid("`source` is not a source id.");
  const kind = parameters.kind?.trim() || undefined;
  if (kind && !(PASSAGE_KINDS as readonly string[]).includes(kind)) {
    throw invalid(`\`kind\` is one of ${PASSAGE_KINDS.join(", ")}.`);
  }
  const limit =
    parameters.limit === undefined || parameters.limit === ""
      ? SEARCH_LIMIT_DEFAULT
      : Number(parameters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) {
    throw invalid(`\`limit\` must be a whole number from 1 to ${SEARCH_LIMIT_MAX}.`);
  }
  return { q, asOf, source, kind, limit };
}

/**
 * Searches the passages in force on `asOf`, superseded ones included, and adds the provenance of
 * each result's source as it read that day.
 */
export async function search(env: CodiceBindings, parameters: SearchParameters) {
  const input = searchInput(parameters);
  if (!env.CODICE_SEARCH) throw new Error("CODICE_SEARCH is not bound");
  let response: AiSearchSearchResponse;
  try {
    const instance = env.CODICE_SEARCH;
    response = await measured("search", { op: "ai_search.search", name: "AI Search search" }, () =>
      instance.search(searchRequest(input)),
    );
  } catch (cause) {
    throw searchUnavailable("codice.search_failed", cause);
  }
  const results = searchResults(response.chunks);
  // The version of each source in force on `asOf`, the one a superseded passage was read from.
  const provenance = await sourcesOn(
    recordsDatabase(env),
    results.map((result) => result.source),
    input.asOf,
  );
  return {
    query: input.q,
    asOf: isoDate(input.asOf),
    source: input.source ?? null,
    kind: input.kind ?? null,
    results: results.map((result) => {
      const source = provenance.get(result.source);
      return {
        ...result,
        sourceTitle: source?.title ?? null,
        sourceUrl: source?.url ?? null,
        sourcePublishedAt: source?.publishedAt ?? null,
      };
    }),
  };
}

function searchUnavailable(event: string, cause: unknown) {
  console.error(event, cause);
  return new CodiceProblem(502, "search_unavailable", "Search is unavailable");
}

/**
 * One passage in full: its body as uploaded to AI Search, its metadata and its source, from D1.
 * A row the ingestion wrote before D1 kept bodies takes them from AI Search instead.
 */
export async function readPassage(env: CodiceBindings, id: string) {
  const key = id.trim();
  if (key.length > PASSAGE_ID_MAX || !PASSAGE_ID.test(key)) {
    throw invalid("`id` must be a passage id as `<source>/<anchor>.md`.");
  }
  const db = recordsDatabase(env);
  const row = await passageRow(db, key);
  if (!row) throw new CodiceProblem(404, "passage_not_found", "Passage not found");
  // The source version the passage was last read from: a superseded one's, else the current one.
  const [indexed, provenance] = await Promise.all([
    row.body === null ? indexedPassage(env, key) : null,
    sourcesOn(db, [row.sourceId], row.validUntil),
  ]);
  const source = provenance.get(row.sourceId) ?? null;
  return {
    passageId: row.key,
    heading: row.heading,
    ...(indexed ?? {
      text: row.body ?? "",
      authority: source?.authority ?? null,
      kind: row.kind,
      ...validity(row.validFrom, row.validUntil),
    }),
    source,
  };
}

/** A passage's body and metadata from AI Search: `items.get` takes the id the listing by key gives. */
async function indexedPassage(env: CodiceBindings, key: string) {
  if (!env.CODICE_SEARCH) throw new Error("CODICE_SEARCH is not bound");
  const items = env.CODICE_SEARCH.items;
  try {
    const [item] = (
      await measured("search", { op: "ai_search.items.list", name: "AI Search items.list" }, () =>
        items.list({ key, per_page: 1 }),
      )
    ).result;
    if (!item) throw new CodiceProblem(404, "passage_not_found", "Passage not found");
    const text = await measured(
      "search",
      { op: "ai_search.items.download", name: "AI Search items.download" },
      async () => new Response((await items.get(item.id).download()).body).text(),
    );
    return { text, ...passageMetadata(item.metadata) };
  } catch (cause) {
    if (cause instanceof CodiceProblem) throw cause;
    throw searchUnavailable("codice.passage_failed", cause);
  }
}

export async function lookupError(env: CodiceBindings, code: string) {
  const row = await errorCode(recordsDatabase(env), code);
  if (!row) throw new CodiceProblem(404, "error_code_not_found", "Error code not found");
  return row;
}

/** Column filters on a catalog key, by the catalog's own header: `{ c_CodigoPostal: "01000" }`. */
export type CatalogWhere = Readonly<Record<string, string | readonly string[]>>;

const CATALOG_FILTERS_MAX = 8;
/** A SAT header, such as `c_CodigoPostal` or `Valor máximo (2)`; never a quote or a backslash. */
const CATALOG_COLUMN = /^[\p{L}\p{N} _().-]{1,64}$/u;
const CATALOG_VALUE_MAX = 128;

function catalogFilters(where: CatalogWhere): CatalogFilter[] {
  const filters = Object.entries(where).map(([column, values]): CatalogFilter => {
    if (!CATALOG_COLUMN.test(column)) throw invalid(`\`${column}\` is not a catalog column.`);
    const all = typeof values === "string" ? [values] : values;
    if (all.length !== 1) throw invalid(`\`${column}\` must be given once.`);
    const value = all[0]!.trim();
    if (!value || value.length > CATALOG_VALUE_MAX) {
      throw invalid(`\`${column}\` must be a value of 1 to ${CATALOG_VALUE_MAX} characters.`);
    }
    return [column, value];
  });
  if (filters.length > CATALOG_FILTERS_MAX) {
    throw invalid(`At most ${CATALOG_FILTERS_MAX} column filters.`);
  }
  return filters;
}

/**
 * The catalog's entries for one key, narrowed by column filters. An empty answer costs one more
 * query to tell a column the key's entries do not hold (400) from no match (404).
 */
export async function lookupCatalog(
  env: CodiceBindings,
  name: string,
  key: string,
  where: CatalogWhere = {},
) {
  const filters = catalogFilters(where);
  const db = recordsDatabase(env);
  const entry = await catalogEntry(db, name, key, filters);
  if (entry) return entry;
  if (filters.length > 0) {
    const columns = await catalogColumns(db, name, key);
    const unknown = columns.length > 0 && filters.find(([column]) => !columns.includes(column));
    if (unknown) {
      throw invalid(
        `\`${unknown[0]}\` is not a column of this catalog entry; its columns are ${columns.map((column) => `\`${column}\``).join(", ")}.`,
      );
    }
  }
  throw new CodiceProblem(404, "catalog_entry_not_found", "Catalog entry not found");
}

export async function listCatalog(env: CodiceBindings, name: string) {
  const listing = await catalogListing(recordsDatabase(env), name);
  if (!listing) throw new CodiceProblem(404, "catalog_not_found", "Catalog not found");
  return listing;
}

export async function listSources(env: CodiceBindings) {
  return { sources: await allSources(recordsDatabase(env)) };
}

export async function readSource(env: CodiceBindings, id: string) {
  const sourceId = id.trim();
  const source = (await sourcesById(recordsDatabase(env), [sourceId])).get(sourceId);
  if (!source) throw new CodiceProblem(404, "source_not_found", "Source not found");
  return source;
}
