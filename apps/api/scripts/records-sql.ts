/**
 * The SQL the ingestion runs through `wrangler d1 execute --file`, sized to D1's limits: a
 * statement holds at most 100,000 bytes, and one statement must not change hundreds of thousands of
 * rows (https://developers.cloudflare.com/d1/platform/limits/). Pure: `ingest.ts` runs the files.
 */
import type { CatalogEntryRow, Corpus, PassageRecord, SourceRow } from "./corpus";

/** Under D1's 100,000-byte statement limit, with room to spare. */
export const STATEMENT_BYTES_MAX = 90_000;
/** One `wrangler d1 execute --file` import; D1 allows 5 GB, smaller files keep each step short. */
export const FILE_BYTES_MAX = 8_000_000;
/** Rows one range `DELETE` removes. */
export const DELETE_ROWS_MAX = 5_000;

type Value = string | number | null;

export function sqlValue(value: Value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function bytes(text: string) {
  return Buffer.byteLength(text, "utf8");
}

/** Multi-row `INSERT`s in row order, each under `STATEMENT_BYTES_MAX`. */
export function insertStatements(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly Value[])[],
) {
  const head = `INSERT INTO ${table} (${columns.join(", ")}) VALUES `;
  const statements: string[] = [];
  let tuples: string[] = [];
  let size = bytes(head) + 1;
  for (const row of rows) {
    const tuple = `(${row.map(sqlValue).join(", ")})`;
    const added = bytes(tuple) + 2;
    if (bytes(head) + added + 1 > STATEMENT_BYTES_MAX) {
      throw new Error(`A ${table} row does not fit one statement`);
    }
    if (tuples.length > 0 && size + added > STATEMENT_BYTES_MAX) {
      statements.push(`${head}${tuples.join(", ")};`);
      tuples = [];
      size = bytes(head) + 1;
    }
    tuples.push(tuple);
    size += added;
  }
  if (tuples.length > 0) statements.push(`${head}${tuples.join(", ")};`);
  return statements;
}

/** Statements grouped into files of at most `FILE_BYTES_MAX`, in order. */
export function sqlFiles(statements: readonly string[]) {
  const files: string[][] = [];
  let size = 0;
  for (const statement of statements) {
    const length = bytes(statement) + 1;
    if (files.length === 0 || size + length > FILE_BYTES_MAX) {
      files.push([]);
      size = 0;
    }
    files.at(-1)!.push(statement);
    size += length;
  }
  return files.map((file) => `${file.join("\n")}\n`);
}

const SOURCE_COLUMNS = [
  "id",
  "title",
  "authority",
  "url",
  "sha256",
  "published_at",
  "retrieved_at",
  "valid_from",
  "valid_until",
] as const;

/** Inserts a source, or updates it in place: catalog rows that stay keep referencing it. */
function upsertSource(row: SourceRow, sha256 = row.sha256) {
  const values: Value[] = [
    row.id,
    row.title,
    row.authority,
    row.url,
    sha256,
    row.publishedAt,
    // `retrieved_at` is a timestamp in milliseconds; the manifest records the day.
    Date.parse(row.retrievedAt),
    row.validFrom,
    row.validUntil,
  ];
  const updates = SOURCE_COLUMNS.slice(1).map((column) => `${column} = excluded.${column}`);
  return `INSERT INTO sources (${SOURCE_COLUMNS.join(", ")}) VALUES (${values.map(sqlValue).join(", ")}) ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")};`;
}

/** Records a superseded source version; a run that repeats the plan writes the same row. */
function upsertSourceVersion(row: SourceRow) {
  const columns = [
    "source_id",
    "title",
    "url",
    "sha256",
    "published_at",
    "retrieved_at",
    "valid_from",
    "valid_until",
  ];
  const values: Value[] = [
    row.id,
    row.title,
    row.url,
    row.sha256,
    row.publishedAt,
    Date.parse(row.retrievedAt),
    row.validFrom,
    row.validUntil,
  ];
  const updates = columns
    .filter((column) => column !== "source_id" && column !== "valid_from")
    .map((column) => `${column} = excluded.${column}`);
  return `INSERT INTO source_versions (${columns.join(", ")}) VALUES (${values.map(sqlValue).join(", ")}) ON CONFLICT (source_id, valid_from) DO UPDATE SET ${updates.join(", ")};`;
}

function nameList(names: readonly string[]) {
  return `(${names.map(sqlValue).join(", ")})`;
}

// `search_text` fills the full-text index `catalog_entries_fts` through its triggers (`0008`).
const CATALOG_COLUMNS = [
  "catalog",
  "key",
  "fields",
  "search_text",
  "source_id",
  "valid_from",
  "valid_until",
];

function catalogValues(row: CatalogEntryRow): Value[] {
  return [
    row.catalog,
    row.key,
    JSON.stringify(row.fields),
    row.searchText,
    row.sourceId,
    row.validFrom,
    row.validUntil,
  ];
}

/**
 * Replaces every record but the large catalogs' with the corpus's, as one file (an import that
 * fails leaves the database as it was). Sources are upserted, not deleted, because the large
 * catalogs' rows reference theirs; a source the corpus no longer has goes once nothing references
 * it, with its superseded versions. `passages` are the plan's records, current and superseded, and
 * `sourceVersions` the versions this run supersedes; earlier ones stay.
 */
export function recordsSql(
  corpus: Corpus,
  largeCatalogs: readonly string[],
  versions: {
    readonly passages: readonly PassageRecord[];
    readonly sourceVersions: readonly SourceRow[];
  },
) {
  const sourceIds = nameList(corpus.sources.map((row) => row.id));
  return [
    "DELETE FROM passages;",
    "DELETE FROM error_codes;",
    `DELETE FROM catalog_entries WHERE catalog NOT IN ${nameList(largeCatalogs)};`,
    ...corpus.sources.map((row) => upsertSource(row)),
    `DELETE FROM source_versions WHERE source_id NOT IN ${sourceIds};`,
    `DELETE FROM sources WHERE id NOT IN ${sourceIds};`,
    ...versions.sourceVersions.map(upsertSourceVersion),
    ...insertStatements(
      "passages",
      ["key", "source_id", "heading", "sha256", "body", "kind", "valid_from", "valid_until"],
      versions.passages.map((row) => [
        row.key,
        row.sourceId,
        row.heading,
        row.sha256,
        row.body,
        row.kind,
        row.validFrom,
        row.validUntil,
      ]),
    ),
    ...insertStatements(
      "error_codes",
      ["code", "node", "attribute", "validation", "message", "source_id"],
      corpus.errorCodes.map((row) => [
        row.code,
        row.node,
        row.attribute,
        row.validation,
        row.message,
        row.sourceId,
      ]),
    ),
    // In sheet order, so the row id keeps the SAT's order of a repeated key.
    ...insertStatements(
      "catalog_entries",
      CATALOG_COLUMNS,
      corpus.catalogEntries.map(catalogValues),
    ),
  ].join("\n");
}

/**
 * Reloads the large catalogs, in files to run in order. The first clears the catalog source's
 * hash (so a run that stops part-way reloads next time; `recordsSql` sets it back) and deletes
 * the old rows by id range; the rest insert the new rows in sheet order.
 */
export function largeCatalogFiles(input: {
  readonly source: SourceRow;
  readonly rows: readonly CatalogEntryRow[];
  readonly catalogs: readonly string[];
  /** The id range the large catalogs' rows hold now, if any. */
  readonly ids: { readonly min: number; readonly max: number } | null;
}) {
  const deletes: string[] = [];
  if (input.ids) {
    for (let from = input.ids.min; from <= input.ids.max; from += DELETE_ROWS_MAX) {
      const to = Math.min(from + DELETE_ROWS_MAX - 1, input.ids.max);
      deletes.push(
        `DELETE FROM catalog_entries WHERE id BETWEEN ${from} AND ${to} AND catalog IN ${nameList(input.catalogs)};`,
      );
    }
  }
  return [
    `${[upsertSource(input.source, ""), ...deletes].join("\n")}\n`,
    ...sqlFiles(
      insertStatements("catalog_entries", CATALOG_COLUMNS, input.rows.map(catalogValues)),
    ),
  ];
}
