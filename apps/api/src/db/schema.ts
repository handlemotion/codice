import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The last `YYYYMMDD` day of a record that is still in force. */
export const IN_FORCE_UNTIL = 99991231;

export const SOURCE_AUTHORITIES = ["SAT", "DOF", "SCJN", "TFJA", "Congreso"] as const;

/**
 * Validity as `YYYYMMDD` numbers, the same encoding as the AI Search item metadata (SPEC.md,
 * "Items"), so an "as of" filter compares numbers and an in-force record has a real upper bound.
 */
const validity = {
  validFrom: integer("valid_from").notNull(),
  validUntil: integer("valid_until").notNull().default(IN_FORCE_UNTIL),
};

/**
 * One published document (a PDF, a spreadsheet, a page). `id` is the AI Search folder of its
 * passages, such as `rmf-2026`. The ingestion writes it; `/v1/sources` reads it.
 */
export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    authority: text("authority", { enum: SOURCE_AUTHORITIES }).notNull(),
    url: text("url").notNull(),
    /** Hex SHA-256 of the fetched file; an unchanged hash stops a re-ingestion. */
    sha256: text("sha256").notNull(),
    /** The date the authority published this version, ISO `YYYY-MM-DD`, when it states one. */
    publishedAt: text("published_at"),
    retrievedAt: integer("retrieved_at", { mode: "timestamp_ms" }).notNull(),
    ...validity,
  },
  (table) => [
    check(
      "sources_authority_check",
      sql`${table.authority} IN ('SAT', 'DOF', 'SCJN', 'TFJA', 'Congreso')`,
    ),
    check("sources_validity_check", sql`${table.validFrom} <= ${table.validUntil}`),
  ],
);

/**
 * A version of a source that a newer one replaced, with the last day it applied as `valid_until`
 * (SPEC.md, "Versions"). `sources` holds the version in force; the passages of a superseded version
 * stay searchable with that version's validity, and cite it through this row.
 */
export const sourceVersions = sqliteTable(
  "source_versions",
  {
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    title: text("title").notNull(),
    url: text("url").notNull(),
    sha256: text("sha256").notNull(),
    publishedAt: text("published_at"),
    retrievedAt: integer("retrieved_at", { mode: "timestamp_ms" }).notNull(),
    validFrom: integer("valid_from").notNull(),
    validUntil: integer("valid_until").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.validFrom] }),
    check("source_versions_validity_check", sql`${table.validFrom} <= ${table.validUntil}`),
  ],
);

/** The `CFDI40xxx` error matrix: one row per validation, keyed by its code as published. */
export const errorCodes = sqliteTable(
  "error_codes",
  {
    /** As published; six SAT rows read `CFDI140223`… for what look like `CFDI40223`…. */
    code: text("code").primaryKey(),
    /** The node, such as `cfdi:Receptor`, as the matrix names it. */
    node: text("node").notNull(),
    attribute: text("attribute").notNull(),
    validation: text("validation").notNull(),
    message: text("message").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
  },
  (table) => [index("error_codes_source_idx").on(table.sourceId)],
);

/**
 * One row of a SAT catalog (`c_UsoCFDI`, `c_CodigoPostal`, …). A key is not unique: a catalog can
 * hold one key in several rows (c_TasaOCuota ranges) or across validity periods.
 */
export const catalogEntries = sqliteTable(
  "catalog_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The catalog's own name, such as `c_RegimenFiscal`. */
    catalog: text("catalog").notNull(),
    key: text("key").notNull(),
    /** The row's columns by the catalog's own header names. */
    fields: text("fields", { mode: "json" }).$type<Record<string, string | null>>().notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    ...validity,
  },
  (table) => [
    // NOCASE, as the lookup compares (`records.ts`, `catalogEntry`): an index in the default
    // collation cannot serve it, and c_CodigoPostal alone holds ~95k rows.
    index("catalog_entries_catalog_key_idx").on(
      sql`${table.catalog} COLLATE NOCASE`,
      sql`${table.key} COLLATE NOCASE`,
    ),
    index("catalog_entries_source_idx").on(table.sourceId),
    check("catalog_entries_validity_check", sql`${table.validFrom} <= ${table.validUntil}`),
  ],
);

/**
 * The passages uploaded to AI Search, keyed by item key, with the hash of the body uploaded and the
 * validity the item's metadata holds. The ingestion compares hashes to upload only new or changed
 * passages: AI Search reports `0` as the checksum of an uploaded item. A superseded passage keeps
 * its row under its versioned key, with the last day it applied as `valid_until`.
 */
export const passages = sqliteTable(
  "passages",
  {
    /** The AI Search item key, `<source>/<anchor>.md`. */
    key: text("key").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    /** The heading path, such as `Nodo: Receptor › UsoCFDI`. */
    heading: text("heading").notNull(),
    sha256: text("sha256").notNull(),
    /**
     * The body uploaded to AI Search, verbatim, so `readPassage` answers from D1 alone. Null only
     * for a row written before this column, until the next ingestion rewrites it.
     */
    body: text("body"),
    /** The item's `kind` metadata (SPEC.md, "Items"); null as `body` is. */
    kind: text("kind"),
    ...validity,
  },
  (table) => [
    index("passages_source_idx").on(table.sourceId),
    // The change feed (`passageChanges`) reads the texts that start or end in a window.
    index("passages_valid_from_idx").on(table.validFrom),
    index("passages_valid_until_idx").on(table.validUntil),
    check("passages_validity_check", sql`${table.validFrom} <= ${table.validUntil}`),
  ],
);
