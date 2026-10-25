/**
 * Loads the Phase 0 corpus (`docs/sat-md`) into Códice: passages into the AI Search instance
 * `codice` through the Items REST API, records and provenance into the D1 database `codice`. The
 * large catalogs (`large-catalogs.ts`) come straight from the catCFDI file `sources.json` pins,
 * converted with LibreOffice (`soffice`), and load only when that file changed.
 *
 *   pnpm --filter @codice/api ingest             upload new and changed passages, delete removed ones, write D1
 *   pnpm --filter @codice/api ingest --dry-run   print the plan, change nothing
 *   pnpm --filter @codice/api ingest --local     write D1 records to the local database only (for `wrangler dev`)
 *   pnpm --filter @codice/api ingest --catalogs  reload the large catalogs even when unchanged; with
 *                                                           --local, load them at all (~3 minutes, needs soffice)
 *   pnpm --filter @codice/api ingest --wait      wait until AI Search has indexed every item before writing D1
 *   pnpm --filter @codice/api ingest --instance codice-bge-m3
 *       load a comparison instance (an eval of other settings): upload every passage it lacks;
 *       D1 and the large catalogs stay as they are
 *
 * A new version of a source keeps the passages it changes or drops under versioned keys, valid
 * until the day before it (SPEC.md, "Versions").
 *
 * The AI Search calls use `CODICE_AI_SEARCH_TOKEN` (AI Search:Edit and AI Search:Run), else
 * `CLOUDFLARE_API_TOKEN`; D1 goes through `wrangler d1 execute` with `CODICE_D1_TOKEN` (D1:Edit),
 * else Wrangler's own auth. Both tokens are in Doppler `codice` `prd`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { workbookSheets } from "./sat-workbook";
import type { SatSourceManifest } from "./sat-documents";
import type { SatSource } from "./sat-records";
import {
  buildCorpus,
  CATALOG_SOURCE_ID,
  catalogEntryRows,
  ingestionPlan,
  passageRecord,
  sha256,
  type Corpus,
  type IngestionPlan,
  type Passage,
  type PassageRecord,
  type Supersession,
  type SourceRow,
} from "./corpus";
import { LARGE_CATALOG_NAMES, parseLargeCatalogs } from "./large-catalogs";
import { largeCatalogFiles, recordsSql } from "./records-sql";

const APP = resolve(import.meta.dirname, "..");
const SAT_MD = resolve(APP, "../../docs/sat-md");
const ACCOUNT_ID = "2504eb0d24f17f6efbf89c1296a08389";
const INSTANCE = "codice";
const DATABASE = "codice";
const PAGE_SIZE = 50;
const CONCURRENCY = 6;

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    local: { type: "boolean", default: false },
    catalogs: { type: "boolean", default: false },
    wait: { type: "boolean", default: false },
    instance: { type: "string", default: INSTANCE },
  },
});
const dryRun = values["dry-run"];
const local = values.local;
const forceCatalogs = values.catalogs;
const wait = values.wait;
/** D1 records what the instance `codice` holds; a comparison instance has no records. */
const comparison = values.instance !== INSTANCE;
const ITEMS = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/namespaces/default/instances/${values.instance}/items`;
/** Indexing ~500 passages took about 30 minutes (SPEC.md, "The AI Search instance"). */
const WAIT_LIMIT_MS = 45 * 60 * 1000;
const POLL_MS = 30 * 1000;
/** AI Search's `item_not_found`. */
const ITEM_NOT_FOUND = 7041;

function token() {
  const value = process.env.CODICE_AI_SEARCH_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!value) throw new Error("Set CODICE_AI_SEARCH_TOKEN (or CLOUDFLARE_API_TOKEN)");
  return value;
}

type ApiEnvelope<T> = {
  readonly success: boolean;
  readonly errors: readonly { readonly code: number; readonly message: string }[] | null;
  readonly result: T;
  readonly result_info?: { readonly total_count?: number };
};

async function api<T>(url: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token()}`, ...init.headers },
    });
    // Rate limits and transient failures: back off and retry, a few times.
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      continue;
    }
    const body = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !body.success) {
      throw Object.assign(
        new Error(
          `${init.method ?? "GET"} ${url}: HTTP ${response.status} ${JSON.stringify(body.errors)}`,
        ),
        { codes: (body.errors ?? []).map((error) => error.code) },
      );
    }
    return body;
  }
}

/**
 * The listing's order shifts while items index (by status or by modification time alike), so pages
 * repeat some items and skip others. By id, a repeat counts once; a listing short of the total is
 * read again, and an item still missing after that is handled on the next run.
 */
async function listItems() {
  let items = new Map<string, { id: string; key: string; status: string }>();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    items = new Map();
    let total = 0;
    for (let page = 1; ; page += 1) {
      const body = await api<{ id: string; key: string; status: string }[]>(
        `${ITEMS}?source=builtin&per_page=${PAGE_SIZE}&page=${page}`,
      );
      total = body.result_info?.total_count ?? 0;
      for (const { id, key, status } of body.result) items.set(id, { id, key, status });
      if (body.result.length < PAGE_SIZE) break;
    }
    if (items.size >= total) break;
    console.log(`AI Search: listed ${items.size} of ${total} items, listing again`);
  }
  return [...items.values()];
}

/** Items in a status, from the filtered listing's total: exact while items move between pages. */
async function countItems(status: string) {
  const body = await api<unknown[]>(`${ITEMS}?source=builtin&per_page=1&status=${status}`);
  return body.result_info?.total_count ?? 0;
}

async function upload(passage: Pick<Passage, "key" | "body" | "metadata">) {
  const form = new FormData();
  form.set("file", new Blob([passage.body], { type: "text/markdown" }), passage.key);
  // The form takes every value as a string (a JSON number is `invalid_metadata_format`); AI Search
  // stores `valid_from` and `valid_until` as numbers, as the instance's schema types them.
  const metadata = Object.fromEntries(
    Object.entries(passage.metadata).map(([field, value]) => [field, String(value)]),
  );
  form.set("metadata", JSON.stringify(metadata));
  await api(ITEMS, { method: "POST", body: form });
}

/**
 * Uploads a superseded passage's old text under its versioned key: the body the current item still
 * holds, checked against the hash D1 recorded, with that item's metadata and the version's end.
 */
async function copySuperseded({ from, record }: Supersession) {
  const { result: item } = await api<{ metadata?: Record<string, unknown> }>(`${ITEMS}/${from.id}`);
  const response = await fetch(`${ITEMS}/${from.id}/download`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!response.ok) throw new Error(`Download ${from.key}: HTTP ${response.status}`);
  const body = await response.text();
  if (sha256(body) !== record.sha256) {
    throw new Error(`${from.key} no longer holds the text D1 recorded; its old version is lost`);
  }
  const { authority, kind } = item.metadata ?? {};
  if (typeof authority !== "string" || typeof kind !== "string") {
    throw new Error(`${from.key} has no authority or kind in its metadata`);
  }
  await upload({
    key: record.key,
    body,
    metadata: {
      authority,
      kind,
      valid_from: record.validFrom,
      valid_until: record.validUntil,
    },
  });
}

async function remove(id: string) {
  try {
    await api(`${ITEMS}/${id}`, { method: "DELETE" });
  } catch (error) {
    // Already gone: the goal of the delete.
    if (!(error as { codes?: number[] }).codes?.includes(ITEM_NOT_FOUND)) throw error;
  }
}

/**
 * Waits until no item is queued, running or outdated (needs re-indexing), so a search sees every
 * passage. An item that failed to index fails the wait; the next run uploads it again.
 */
async function waitForIndexing() {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const counts = await Promise.all(["queued", "running", "outdated"].map(countItems));
    const pending = counts.reduce((sum, count) => sum + count, 0);
    const failed = await countItems("error");
    if (pending === 0 && failed > 0) throw new Error(`AI Search: ${failed} items failed to index`);
    if (pending === 0) return console.log("AI Search: every item indexed");
    if (Date.now() > deadline) throw new Error(`AI Search: ${pending} items still indexing`);
    console.log(`AI Search: ${pending} items indexing`);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

async function each<T>(values: readonly T[], run: (value: T) => Promise<void>) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
    while (next < values.length) {
      await run(values[next++]!);
      done += 1;
      if (done % 50 === 0 || done === values.length) console.log(`  ${done}/${values.length}`);
    }
  });
  await Promise.all(workers);
}

function wrangler(commandArgs: string[]) {
  return execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", DATABASE, local ? "--local" : "--remote", ...commandArgs],
    {
      cwd: APP,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env.CODICE_D1_TOKEN
        ? { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CODICE_D1_TOKEN }
        : process.env,
    },
  );
}

/** Item key → what was last uploaded and when it applies, from D1, current and superseded. */
function recordedPassages() {
  const rows = query<PassageRecord>(
    "SELECT key, source_id AS sourceId, heading, sha256, valid_from AS validFrom, valid_until AS validUntil FROM passages",
  );
  return new Map(rows.map((row) => [row.key, row]));
}

/** The source versions in force at the last run, from D1. */
function recordedSources(): SourceRow[] {
  const rows = query<Omit<SourceRow, "retrievedAt"> & { retrievedAt: number }>(
    "SELECT id, title, authority, url, sha256, published_at AS publishedAt, retrieved_at AS retrievedAt, valid_from AS validFrom, valid_until AS validUntil FROM sources",
  );
  return rows.map((row) => ({ ...row, retrievedAt: new Date(row.retrievedAt).toISOString() }));
}

function executeFile(sql: string) {
  const file = join(mkdtempSync(join(tmpdir(), "codice-ingest-")), "records.sql");
  writeFileSync(file, sql);
  wrangler(["--yes", "--file", file]);
}

function query<T>(sql: string) {
  const output = wrangler(["--json", "--command", sql]);
  const [statement] = JSON.parse(output) as [{ results: T[] }];
  return statement.results;
}

function writeRecords(corpus: Corpus, plan: Pick<IngestionPlan, "records" | "sourceVersions">) {
  executeFile(
    recordsSql(corpus, LARGE_CATALOG_NAMES, {
      passages: plan.records,
      sourceVersions: plan.sourceVersions,
    }),
  );
  console.log(
    `D1 (${local ? "local" : "remote"}): ${corpus.sources.length} sources (${plan.sourceVersions.length} superseded now), ${plan.records.length} passages, ${corpus.errorCodes.length} error codes, ${corpus.catalogEntries.length} catalog entries`,
  );
}

/**
 * The large catalogs need loading when D1's catalog source hash is not the manifest's (a new
 * catCFDI, or a load that stopped part-way: it clears the hash first) or one of them has no rows
 * (a first load).
 */
function largeCatalogsStale(source: SourceRow) {
  const [row] = query<{ sha256: string }>(`SELECT sha256 FROM sources WHERE id = '${source.id}'`);
  // NOCASE, so each probe is one step on `catalog_entries_catalog_key_idx`.
  const present = LARGE_CATALOG_NAMES.map(
    (name) => `EXISTS (SELECT 1 FROM catalog_entries WHERE catalog = '${name}' COLLATE NOCASE)`,
  ).join(" + ");
  const [loaded] = query<{ present: number }>(`SELECT ${present} AS present`);
  return (
    forceCatalogs || row?.sha256 !== source.sha256 || loaded?.present !== LARGE_CATALOG_NAMES.length
  );
}

/**
 * Downloads the catCFDI the manifest pins, checks it is the same file, and parses the large
 * catalogs from it with the Agent's sheet parser.
 */
async function largeCatalogRows(source: SatSource) {
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== source.sha256) {
    throw new Error(
      `${source.url} is not the catCFDI docs/sat-md was generated from (SHA-256 ${hash}, manifest ${source.sha256}); run sat:knowledge first`,
    );
  }
  const work = mkdtempSync(join(tmpdir(), "codice-catalogs-"));
  const path = join(work, source.url.split("/").at(-1)!);
  writeFileSync(path, bytes);
  const catalogs = parseLargeCatalogs(workbookSheets(path, work));
  for (const catalog of catalogs) console.log(`  ${catalog.name}: ${catalog.rows.length} rows`);
  return catalogEntryRows({ source, catalogs });
}

async function loadLargeCatalogs(corpus: Corpus, manifest: SatSourceManifest) {
  const source = corpus.sources.find((row) => row.id === CATALOG_SOURCE_ID);
  if (!source) throw new Error("The corpus has no catalog source");
  if (!largeCatalogsStale(source)) {
    console.log("Large catalogs: unchanged");
    return;
  }
  console.log(`Large catalogs: loading from ${source.url}`);
  if (dryRun) return;
  const started = performance.now();
  const rows = await largeCatalogRows(manifest.catalogs);
  const parsed = performance.now();
  const [ids] = query<{ min: number | null; max: number | null }>(
    `SELECT min(id) AS min, max(id) AS max FROM catalog_entries WHERE catalog IN (${LARGE_CATALOG_NAMES.map((name) => `'${name}'`).join(", ")})`,
  );
  const files = largeCatalogFiles({
    source,
    rows,
    catalogs: LARGE_CATALOG_NAMES,
    ids: ids?.min != null && ids.max != null ? { min: ids.min, max: ids.max } : null,
  });
  for (const [index, sql] of files.entries()) {
    executeFile(sql);
    console.log(
      `  file ${index + 1}/${files.length} (${(Buffer.byteLength(sql) / 1e6).toFixed(1)} MB)`,
    );
  }
  const seconds = (to: number, from: number) => ((to - from) / 1000).toFixed(1);
  console.log(
    `Large catalogs: ${rows.length} entries in ${files.length} files; parsed in ${seconds(parsed, started)} s, loaded in ${seconds(performance.now(), parsed)} s`,
  );
}

async function main() {
  const corpus = buildCorpus({ read: (file) => readFileSync(join(SAT_MD, file), "utf8") });
  console.log(`Corpus: ${corpus.passages.length} passages from ${corpus.sources.length} sources`);
  const manifest = JSON.parse(
    readFileSync(join(SAT_MD, "sources.json"), "utf8"),
  ) as SatSourceManifest;
  if (local) {
    // The local stack seeds a fresh checkout with `--local`; the large catalogs only on request.
    if (forceCatalogs) await loadLargeCatalogs(corpus, manifest);
    if (!dryRun) {
      writeRecords(corpus, { records: corpus.passages.map(passageRecord), sourceVersions: [] });
    }
    return;
  }
  const plan = ingestionPlan({
    passages: corpus.passages,
    sources: corpus.sources,
    // A comparison instance takes the passages as they are now: it uploads only what it lacks.
    ...(comparison
      ? {
          recordedSources: corpus.sources,
          recorded: new Map(
            corpus.passages.map((passage) => [passage.key, passageRecord(passage)]),
          ),
        }
      : { recordedSources: recordedSources(), recorded: recordedPassages() }),
    items: await listItems(),
  });
  console.log(
    `AI Search${comparison ? ` ${values.instance}` : ""}: ${plan.supersede.length} to keep as superseded, ${plan.upload.length} to upload, ${plan.remove.length} to delete, ${plan.unchanged} unchanged`,
  );
  for (const version of plan.sourceVersions) {
    console.log(
      `  ${version.id}: the version from ${version.validFrom} ends ${version.validUntil}`,
    );
  }
  for (const { record } of plan.supersede) console.log(`  keep ${record.key}`);
  for (const item of plan.remove) console.log(`  delete ${item.key}`);
  if (dryRun) {
    if (!comparison) await loadLargeCatalogs(corpus, manifest);
    return;
  }
  // Superseded copies first, while the current items still hold the old text; then uploads, which
  // replace it. D1 records a passage's hash only once AI Search holds that version, so a failed run
  // plans the same changes again next time.
  await each(plan.supersede, copySuperseded);
  await each(plan.upload, upload);
  await each(plan.remove, (item) => remove(item.id));
  if (comparison) {
    if (wait) await waitForIndexing();
    return;
  }
  await loadLargeCatalogs(corpus, manifest);
  // Before D1: a run that times out waiting leaves the old hashes, so the next run plans the same
  // changes again and its eval still runs.
  if (wait) await waitForIndexing();
  writeRecords(corpus, plan);
}

await main();
