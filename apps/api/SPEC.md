# Códice: specification

Status: Phase 0, not deployed. The Worker serves the whole [HTTP API](#http-api-v1) and
[MCP surface](#mcp-surface-mcp), behind the public rate limit; the ingestion has loaded
`docs/sat-md` into the AI Search instance and D1 (see [Infrastructure](#infrastructure)).

Códice is an index of Mexican tax (SAT) and customs rules that people and AI assistants can
search. It answers a question with the regulator's own words: the rule quoted verbatim, its source
URL, and the dates it applies. The Agent (`apps/agent`) reads the SAT's rules from it over a service
binding; before Códice it bundled them (`docs/adr/0010-agent-sat-knowledge.md`).

## Glossary

| Term            | Meaning                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SAT             | _Servicio de Administración Tributaria_, Mexico's tax authority.                                                        |
| CFDI            | _Comprobante Fiscal Digital por Internet_, the electronic invoice.                                                      |
| Anexo 20        | The SAT's technical standard and filling guide for CFDI 4.0.                                                            |
| RMF             | _Resolución Miscelánea Fiscal_, the SAT's yearly rulebook, amended during the year.                                     |
| CFF, LISR, LIVA | The federal tax code, the income tax law, and the VAT law.                                                              |
| RGCE, Anexo 22  | The general foreign-trade rules, and the filling guide for the _pedimento_ (customs declaration).                       |
| DOF             | _Diario Oficial de la Federación_, the official gazette where every change is published.                                |
| MCP             | Model Context Protocol, the standard way to give AI assistants (Claude, ChatGPT, Cursor) tools.                         |
| AI Search       | Cloudflare's managed search service. It stores, converts, chunks, embeds and indexes files, and answers search queries. |
| Item            | One file uploaded to AI Search. In Códice, one item is one passage.                                                     |
| Chunk           | A piece of an item that AI Search indexes and returns. A short passage is one chunk.                                    |
| Embedding       | Numbers that represent a passage's meaning, so a question matches a passage that uses other words.                      |
| BM25            | The standard keyword-ranking formula: exact words and codes.                                                            |
| Hybrid search   | Embedding search and BM25 run together, results merged (here with RRF, reciprocal rank fusion).                         |
| Reranking       | A second model that reorders the top results by relevance to the question.                                              |
| Source, Passage | A source is one published document (a PDF, a spreadsheet, a page). A passage is one rule or section of it.              |

## Goals

1. Answer "what does the rule say" with a verbatim quote, a source URL, and validity dates.
2. Find exact codes (`CFDI40149`, `c_UsoCFDI` `G03`) and plain-language questions with the same
   search.
3. Answer "as of" a date: a rule from the 2024 RMF must not answer a 2026 question.
4. Serve our Agent first, then the public over MCP.

## Non-goals

- Tax advice or conclusions. Códice returns rules; the caller interprets them.
- Validating or stamping CFDIs. That stays in `apps/stamping`.
- CargoWise data. That stays in `trstv/vault` and `apps/stamping`.
- Our own search engine. AI Search does storage, conversion, chunking, embeddings, keyword
  indexing, fusion and reranking. Códice owns only what AI Search cannot know: which passages
  exist, when each applies, and the exact-match records.

## What we build and what AI Search does

| Concern                                      | Owner                                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| File storage and the vector index            | AI Search built-in storage (R2 and Vectorize underneath)  |
| HTML and PDF to Markdown                     | AI Search (Workers AI Markdown conversion), when adequate |
| Chunking, embeddings, BM25, fusion, rerank   | AI Search                                                 |
| Citation data (item key, score, metadata)    | AI Search `search()` response                             |
| Splitting a source into passages             | Códice ingestion                                          |
| Validity dates and authority on each passage | Códice ingestion (custom metadata)                        |
| The "as of" filter on every query            | Códice Worker                                             |
| Error codes and catalogs (exact lookups)     | Códice D1                                                 |
| Source provenance (URL, hash, dates)         | Códice D1                                                 |
| HTTP API and MCP tools                       | Códice Worker                                             |

Why Códice splits passages itself: AI Search chunks by size, so a long PDF could be cut mid-rule
and a result would quote half a rule. Uploading one passage per item keeps each result a whole rule
and gives each rule its own validity dates. Spreadsheets (the catalogs, the error matrix) are
records, not prose: they go to D1, not to search.

## Corpus

| Phase | Sources                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `docs/sat-md/` today (Anexo 20 guide, Pagos 2.0 guide, `CFDI40xxx` error matrix, small catalogs), plus the large catalogs (`c_ClaveProdServ`, `c_CodigoPostal`, …) in D1. |
| 1     | CFF, LISR, LIVA and their regulations; the current RMF and its amendments; Ley Aduanera, RGCE, Anexo 22; the Carta Porte and Comercio Exterior complements.               |
| 2     | DOF watch for new publications; SAT FAQs, _criterios normativos_ and _criterios no vinculativos_; court rulings (SCJN, TFJA).                                             |

The AI Search website crawler only crawls domains we own, so SAT and DOF pages are fetched by our
ingestion and uploaded as items (`.html` items are converted to Markdown by AI Search).

## Search

### The AI Search instance

Instance `codice`, namespace `default`, built-in storage. Settings as created:

| Setting           | Value                                     | Note                                                         |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Embedding model   | `@cf/qwen/qwen3-embedding-0.6b` (default) | Multilingual, 8,192 input tokens. Compare `@cf/baai/bge-m3`. |
| Index method      | vector + keyword (hybrid), fusion `rrf`   |                                                              |
| Reranking         | on, default model                         |                                                              |
| Chunk size        | 1,024 tokens, 10% overlap                 | Most passages fit in one chunk.                              |
| Keyword tokenizer | `trigram`                                 | Chosen by the eval over `porter` (English stemming).         |
| Keyword match     | `and` (default)                           | Kept by the eval over `or`.                                  |
| Rerank threshold  | 0, sent per request                       | The default 0.4 dropped correct Spanish results.             |
| Public endpoint   | off                                       | Códice serves MCP itself; see [MCP](#mcp-surface-mcp).       |

The tokenizer, match mode and reranking threshold were decided by the retrieval eval (see
[Retrieval eval](#retrieval-eval)). A tokenizer change re-indexes the instance: about 30 minutes for
the Phase 0 passages (520 since the parser change).

### Items

- **Key:** `<source>/<anchor>.md`, at most 128 characters, e.g. `rmf-2026/regla-2.7.1.21.md`.
  AI Search's built-in `folder` attribute is then the source id, so it needs no custom field.
  Phase 0 sources: `anexo-20-guia-de-llenado` and `complemento-pagos-guia-de-llenado` (one item a
  section, anchored by its short path: `nodo-receptor-usocfdi`, `apendice-6-pregunta-6`,
  `apendice-8-3` for the third part of an appendix), and
  `matriz-de-errores-cfdi-40` (one item a code, such as `cfdi40149`).
- **Body:** the passage's verbatim Markdown, preceded by its heading path.
- **Custom metadata** (4 of the 5 allowed; one left for later):

| Field         | Type   | Example    | Meaning                                                    |
| ------------- | ------ | ---------- | ---------------------------------------------------------- |
| `authority`   | text   | `SAT`      | `SAT`, `DOF`, `SCJN`, `TFJA`, `Congreso`.                  |
| `kind`        | text   | `regla`    | `ley`, `reglamento`, `regla`, `anexo`, `guia`, `criterio`. |
| `valid_from`  | number | `20260101` | First day the passage applies, as `YYYYMMDD`.              |
| `valid_until` | number | `99991231` | Last day it applies; `99991231` while in force.            |

Dates are `YYYYMMDD` numbers, not datetimes, so an in-force passage has a real upper bound and a
range filter never meets a missing value. The Items API takes metadata values as strings and stores
these two as numbers, as the instance's schema types them. Phase 0 holds one version of each source:
`valid_from` is its publication date and `valid_until` is `99991231`.

### Query

Every search sets the validity filter; `asOf` defaults to today in `America/Mexico_City`:

```ts
await env.CODICE_SEARCH.search({
  messages: [{ role: "user", content: q }],
  ai_search_options: {
    retrieval: {
      filters: {
        valid_from: { $lte: asOf },
        valid_until: { $gte: asOf },
        // optional: folder: "rmf-2026/", authority: "SAT"
      },
      max_num_results: limit,
    },
  },
});
```

The Worker maps each returned chunk to a result: `item.key` → passage id, `text` → quote,
`item.metadata` → validity, `score` and `scoring_details` → relevance, and the source's provenance
from D1. `context_expansion` (0–3 neighbouring chunks) serves passages longer than one chunk.

## Records and provenance (D1)

D1 database `codice`, binding `CODICE_DATABASE`, schema in Drizzle (`db:generate`, never
hand-written migrations).

- `sources`: id, title, authority, url, sha256, published_at, retrieved_at, valid_from,
  valid_until. The ingestion writes it; `/v1/search` and `/v1/passages/:id` add it to each
  result, and `/v1/sources` reads it.
- `passages`: item key, source id, heading path, and the sha256 of the body uploaded. The
  ingestion compares it to upload only new or changed passages (AI Search's own item `checksum` is
  `0` for uploaded items, so it cannot). `/v1/passages/:id` reads it first, so an unknown id costs
  no AI Search call.
- `error_codes`: the `CFDI40xxx` matrix (code, node, attribute, validation, message). Each row
  is also a search passage, so a plain-language question (_"código postal de un receptor con RFC
  genérico"_) finds its code; the record answers the exact lookup.
- `catalog_entries`: catalog name, key, fields as JSON, valid_from, valid_until (the row's own
  validity columns, else the catalog's). A key can repeat (`c_TasaOCuota`); the ingestion inserts
  each catalog in its sheet's order, so the surrogate id keeps the SAT's order. It holds every
  catCFDI catalog: the 17 in `docs/sat-md`, and the 8 large ones that are not in `docs/sat-md`, which the ingestion reads from the same catCFDI file (see
  [Large catalogs](#large-catalogs)).

The shapes follow `scripts/sat-records.ts`, the records `sat:knowledge` generates. Schema:
`src/db/schema.ts`, migrations `migrations/0000_*.sql` (records) and `0001_*.sql` (`passages`).

- `sources.id` is the AI Search folder of the source's passages (`rmf-2026`). `authority` is one of
  `SAT`, `DOF`, `SCJN`, `TFJA`, `Congreso` (a check constraint).
- `valid_from` and `valid_until` are `YYYYMMDD` integers, as in the search metadata;
  `valid_until` defaults to `99991231` and may not precede `valid_from`. `published_at` is an ISO
  date or null; `retrieved_at` is epoch milliseconds.
- `error_codes` is keyed by `code` as published. `catalog_entries` has a surrogate id and an index
  on (catalog, key), because a key can repeat (c_TasaOCuota). The index is `COLLATE NOCASE`
  (`0002_*.sql`), as the lookup compares: an index in the default collation cannot serve a NOCASE
  comparison, and the lookup then scanned every row (39 ms against 0.006 ms per lookup on the
  362,380 rows, local SQLite). Both tables, and `passages`, reference `sources`.

### Large catalogs

| Catalog                | Rows    | Key                                                  |
| ---------------------- | ------- | ---------------------------------------------------- |
| `c_Colonia`            | 145,366 | `c_Colonia`; repeats per postal code (`0001`: 1,001) |
| `c_CodigoPostal`       | 95,749  | `c_CodigoPostal`                                     |
| `c_NumPedimentoAduana` | 59,055  | `c_Aduana-Patente-Ejercicio`, such as `16-2069-2026` |
| `c_ClaveProdServ`      | 52,513  | `c_ClaveProdServ`                                    |
| `c_PatenteAduanal`     | 3,420   | `C_PatenteAduanal`                                   |
| `c_Municipio`          | 2,478   | `c_Municipio`; repeats per state (`001`: 31)         |
| `c_ClaveUnidad`        | 2,418   | `c_ClaveUnidad`                                      |
| `c_Localidad`          | 664     | `c_Localidad`; repeats per state (`01`: 32)          |

Counts from `catCFDI_V_4_20261015.xls`. Codes keep the SAT's display format (`01000`, not
`1000`). The SAT splits `c_CodigoPostal` (`_Parte_1`, `_Parte_2`) and `c_Colonia` (`C_Colonia_1`
to `_3`) over several sheets; the ingestion merges them in order (`scripts/large-catalogs.ts`).
`c_NumPedimentoAduana` has no column of its own name: its key joins the three columns that
identify a row, the parts of a pedimento number the SAT checks. A repeated key returns every row
(`/v1/catalogs/c_Colonia/0001` is 1,001 entries, 144 KB) unless a column filter narrows it:
`/v1/catalogs/c_Colonia/0001?c_CodigoPostal=01000` is the one colonia San Ángel, and
`c_Municipio` or `c_Localidad` narrow by `c_Estado`. The filter runs after the indexed
(catalog, key) match, so it only reads the rows that share the key.

## HTTP API (`/v1`)

Responses use the repo envelope (`{ data, meta: { requestId } }`, `apiJson` in `src/http.ts`);
errors are `application/problem+json`. Every response, including `/health` and `/ready`, carries
`x-request-id`: the caller's when it is 1–128 characters, else a new UUID.

| Method and path                          | Backed by                                        |
| ---------------------------------------- | ------------------------------------------------ |
| `GET /v1/search?q=&asOf=&source=&limit=` | AI Search `search()` + D1 `sources`              |
| `GET /v1/passages/:id`                   | D1 `passages` + AI Search Items API + D1 sources |
| `GET /v1/sources`, `/v1/sources/:id`     | D1 `sources`                                     |
| `GET /v1/errors/:code`                   | D1 `error_codes`                                 |
| `GET /v1/catalogs/:name`                 | D1 `catalog_entries`                             |
| `GET /v1/catalogs/:name/:key?<column>=`  | D1 `catalog_entries`                             |

The handlers live in `src/handlers.ts`; the routes and MCP tools only pass them their input.

- **`/v1/passages/:id`**: `:id` is the item key `<source>/<anchor>.md` a search result gives as
  `passageId`, its slash plain or encoded (`%2F`). The handler reads the D1 `passages` row (404
  `passage_not_found` when absent), finds the item with `items.list({ key, per_page: 1 })`
  (`items.get` takes the item's id, not its key), and downloads its body with
  `items.get(id).download()`. It answers `{ passageId, heading, text, authority, kind, validFrom,
validUntil, source }`: `text` is the whole body as uploaded (heading path, then the verbatim
  Markdown), not one chunk; the validity comes from the item's metadata; `source` is the D1
  provenance. A malformed id is `400 invalid_request`; an item AI Search does not hold is 404
  `passage_not_found`; an Items API failure is `502 search_unavailable`.
- **`/v1/sources`**: `{ sources: [...] }`, every source by id. **`/v1/sources/:id`**: one source,
  or `404 source_not_found`. A source is `{ id, title, authority, url, sha256, publishedAt,
retrievedAt, validFrom, validUntil }`, the same provenance the other routes attach.
- **`/v1/errors/:code`**: the matrix row, its search passage as `passageId`
  (`errorCodePassageId`), and its source; or `404 error_code_not_found`.
- **`/v1/catalogs/:name/:key`**: `{ catalog, key, entries: [{ fields, validFrom, validUntil }],
source }`, every entry of the key in the SAT's order, or `404 catalog_entry_not_found`. Each query
  parameter names a column of the catalog by its SAT header (`c_CodigoPostal`, `c_Estado`) and
  keeps only the entries whose `fields[column]` equals its value, compared without case like the
  key; up to 8, each given once, the value 1–128 characters. The filter is
  `json_extract(fields, ?) = ? COLLATE NOCASE` after the indexed (catalog, key) match, the JSON
  path bound like the value; a column name is letters, digits, spaces and `_().-`, at most 64
  characters. A malformed parameter, or a column none of the key's entries hold, is
  `400 invalid_request` (the detail names the columns they hold; the ingestion leaves out empty
  cells, so a column empty in every entry of the key counts as unknown). A known column with no
  matching entry is `404 catalog_entry_not_found`. Telling the two apart costs one more query, only
  when a filtered lookup finds nothing.
- **`/v1/catalogs/:name`**: the whole catalog in the SAT's order, `{ catalog, entries: [{ key,
fields, validFrom, validUntil }], truncated, source }`, at most 500 entries (`truncated` says
  when there are more; the largest small catalog, c_Pais, has 250, while the large ones such as
  c_CodigoPostal come back truncated). `404 catalog_not_found`.

### Internal entrypoint

Transitive's own Workers call the same handlers over a service binding to the `CodiceKnowledge`
entrypoint (`src/index.ts`; contract `@codice/contracts`, mirrored by Transitive's
`@transitive/api-contracts/codice`): `search`,
`readPassage`, `lookupError`, `lookupCatalog` and `listCatalog`, each answering
`{ ok: true, data }` with the route's `data`, or `{ ok: false, problem: { status, code, title } }`
(RPC keeps only an error's message). It skips the public rate limit: a binding's requests carry no
`cf-connecting-ip`, so every caller would share one bucket. The Agent binds it as `CODICE`.

## MCP surface (`/mcp`)

| Tool             | Arguments                      | Handler, as                   |
| ---------------- | ------------------------------ | ----------------------------- |
| `search`         | `q`, `asOf`, `source`, `limit` | `GET /v1/search`              |
| `read_passage`   | `id`                           | `GET /v1/passages/:id`        |
| `lookup_error`   | `code`                         | `GET /v1/errors/:code`        |
| `lookup_catalog` | `name`, `key`, `where`         | `GET /v1/catalogs/:name/:key` |
| `list_sources`   | none                           | `GET /v1/sources`             |

Each is a thin call to the same handler as `/v1` and returns its `data` as `structuredContent` (and
as JSON text). A refusal is a tool result with `isError: true` and `{ error: { code, message,
status } }`, the problem's code and status. `lookup_catalog`'s optional `where` object
(`{ c_CodigoPostal: "01000" }`) is the route's column filters. All are annotated read-only and idempotent. Built with `createMcpHandler` from the `agents` package, as in
`apps/mcp`. Public and read-only, rate limited per client with the Workers rate-limit binding.

### Rate limiting

`/v1/*` and `/mcp/*` pass the Workers rate-limit binding `CODICE_PUBLIC_RATE_LIMITER` (namespace
`1601`, 60 requests per 60 seconds), keyed per client by `cf-connecting-ip`. Over the limit:
`429` problem+json, code `rate_limited`, `retry-after: 60`. `/`, `/health`, `/ready` and the
[internal entrypoint](#internal-entrypoint) are not limited.

Why not AI Search's own public endpoint, which also serves `/mcp`: it exposes one `search` tool and
cannot apply the validity filter by default, so a client could get a repealed rule, and it cannot
answer the exact lookups. It stays off. If a plain search endpoint is ever useful (for example a
search box on the marketing site), it can be turned on with its own rate limit and custom domain.

## Ingestion

A job outside the Worker (it needs LibreOffice and PDF tools for some sources):

```
fetch source → sha256 → unchanged? stop
  → convert (our converter for PDFs and spreadsheets; AI Search for HTML when its Markdown is good)
  → split into passages, attach authority, kind, validity
  → AI Search Items API: upload new and changed passages, delete removed ones
  → D1: upsert the source row, and the records for spreadsheet sources
```

- Phase 0: `pnpm --filter @codice/api sat:knowledge` (`scripts/sat-knowledge.ts`)
  generates `docs/sat-md` from the SAT's published files (`--check` exits 1 when the SAT published
  something new, `--force` regenerates all; it needs LibreOffice, and MarkItDown with Poppler for
  the PDF guides). `pnpm --filter @codice/api ingest` (`scripts/ingest.ts`) reads it,
  splits the guides with Códice's splitter (`scripts/sections.ts`, below), uploads only passages
  that are new, changed, missing or failed to index, deletes items no passage has any more, then
  replaces the D1 records. The Items listing repeats and skips items while they index, so the plan
  counts each item id once and a skipped item is handled on the next run. `--dry-run` prints the
  plan; `--local` writes D1 records to the local database for `wrangler dev`; `--wait` waits,
  before D1, until AI Search has indexed every item (none queued, running or outdated; one that
  failed to index fails the run). `--instance <name>` loads a comparison instance for an eval of
  other settings: every passage it lacks, no D1 and no catalogs. A change to the splitter changes
  passage keys, and with them the Agent's citations: prove the corpus with
  `test/corpus.unit.test.ts` and `test/sections.unit.test.ts` first.
- The splitter (`sections.ts`) finds each guide's parts and appendices from the guide's own table
  of contents (`Contenido`), in order, so a later line that only quotes a title starts nothing; a
  part the contents leave out (the Pagos guide's Part II) starts at its own `II. Guía de llenado…`
  line. In a part, a passage starts at each node (`Nodo: Receptor`) and attribute and runs to the
  next, so a rule keeps its examples and catalog table; a name the PDF wrapped onto the next lines
  (`InformacionGlo` / `bal`) is rejoined when the whole name appears elsewhere in the SAT's text,
  and a repeated attribute name in a node (an example table's header) starts nothing. A questions
  appendix is one passage a question; any other section is cut at blank lines into parts of at
  most 3,000 characters (about one 1,024-token chunk). The passages are verbatim slices that cover
  each guide in order.
- The large catalogs skip `docs/sat-md`: the ingestion downloads the catCFDI file
  `sources.json` pins, refuses it unless its SHA-256 is the manifest's (so every catalog comes from
  one version), converts it with LibreOffice (`workbookSheets`, shared with `sat:knowledge`), and
  parses it with `parseCatalogSheet` (`scripts/sat-knowledge-render.ts`). It loads them only when D1's catalog source hash
  differs from the manifest's or one of them has no rows; `--catalogs` forces a reload. With
  `--local` they load only with `--catalogs`, so the local stack's seed stays fast and needs no
  LibreOffice.
- D1 limits (<https://developers.cloudflare.com/d1/platform/limits/>): a statement holds at most
  100,000 bytes, an import (`d1 execute --file`) at most 5 GB, and one query must not change
  hundreds of thousands of rows. The load (`scripts/records-sql.ts`) writes multi-row `INSERT`s of
  at most 90,000 bytes in files of at most 8 MB, run in order. The first file clears the catalog
  source's hash and deletes the old rows in id ranges of 5,000; the other records' file, last, sets
  the hash again. A failed import leaves the database as it was, and a run that stops between files
  leaves the hash cleared, so the next run reloads. The other records' file upserts `sources`
  instead of deleting them, because the large catalogs' rows still reference theirs.
- Measured locally on 2026-10-25 (`ingest --local --catalogs`, Wrangler 4.129): 361,663 entries
  in 12 files; 77 s to download, convert and parse (most of it LibreOffice), 108 s to load, 3 min
  14 s in all. The local database is 103 MB after `VACUUM`. A lookup over HTTP to `wrangler dev`
  takes 36–50 ms end to end.
- Remote, 2026-10-25: the large catalogs loaded alone (the passages and the other records were left
  as they were): 12 files, 3.6–4.9 s each, 53.5 s in all; D1 `codice` is 106.2 MB with 362,380
  catalog entries. Before `0002` the remote lookup of `c_CodigoPostal` `01000` read all 362,380
  rows (130 ms). With `0002`, applied 2026-10-25, it is one index step: `c_Colonia` `0001`
  filtered by `c_CodigoPostal` reads 1,002 rows in 0.8 ms.
- Uploads through the Items REST API with an AI Search token (`AI Search:Edit`, `AI Search:Run`),
  read from `CODICE_AI_SEARCH_TOKEN`, else `CLOUDFLARE_API_TOKEN`. D1 goes through
  `wrangler d1 execute` with `CODICE_D1_TOKEN` (`D1:Edit`), else Wrangler's own login. Run it as
  `doppler run -p codice -c prd -- pnpm --filter @codice/api ingest` (both tokens in
  Doppler `codice` `prd`); `eval` reads the read-only token in `codice` `dev` itself.
- Runs from GitHub Actions (`.github/workflows/codice-corpus.yml`) every Monday and on demand
  (`workflow_dispatch`), from `main` only. Job `sources` runs `sat:knowledge --check`; when the SAT
  published new files it regenerates `docs/sat-md` and opens a pull request from
  `codice/sat-md-refresh` (one at a time; it waits while that PR is open), then dispatches the
  required checks onto it, since a PR opened with `GITHUB_TOKEN` starts no workflows. Job `ingest`
  ingests `main`'s `docs/sat-md` with `--wait` (until AI Search has indexed every item), then runs
  `eval --min-top3 48` when a passage was uploaded or deleted, or when a manual run asks for it
  (input `eval`); below the recorded top 3 the run fails. Doppler comes through GitHub OIDC, as in
  `sync-worker-secrets.yml` (setup: `docs/operations/doppler-secrets.md`, "Códice"). The eval never
  runs on pull requests: each run spends ~50 AI Search queries.

## Cost

AI Search billing starts on 2026-11-01. Each account gets every month: 5M ingestion tokens,
10 GB-month of storage, 1,000 semantic and 1,000 full-text queries. Beyond that: $0.75 per 1M
ingestion tokens, $2.00 per GB-month, $0.75 per 1,000 semantic or hybrid queries, $0.10 per 1,000
full-text queries. D1 at this size stays inside the Workers Paid allowance.

| Item                          | Estimate                                  | Monthly cost  |
| ----------------------------- | ----------------------------------------- | ------------- |
| Phase 0 ingestion             | ~0.3M tokens once                         | $0 (included) |
| Phase 1 ingestion             | ~3–5M tokens once, small re-ingests after | $0–$1         |
| Storage                       | well under 1 GB                           | $0            |
| Queries, internal use only    | < 1,000                                   | $0            |
| Queries, public at 10k/month  | 9,000 billable hybrid                     | ~$7           |
| Queries, public at 100k/month | 99,000 billable hybrid                    | ~$74          |

Queries are the only cost that grows; the per-client rate limit bounds it.

## Testing

- **Unit:** passage splitting, the validity filter, chunk-to-result mapping. Pure functions, Node
  vitest.
- **Worker routes:** `@cloudflare/vitest-pool-workers`. AI Search does not run locally, so route
  tests check request shaping and response mapping; they are not evidence of retrieval.
- **Retrieval eval:** a fixed question set, each with the passage it must return in the top 3,
  run against the real instance (start from the rules in `docs/sat-md/README.md`). It decides the
  tokenizer, match mode and embedding model, and runs after every ingestion change. ~50 questions
  per run stays inside the free query allowance. `pnpm --filter @codice/api eval`
  (`scripts/eval.ts`, questions in `scripts/eval-questions.json`) sends the Worker's own request;
  `--match or` overrides the match mode for one run. Results: [Retrieval eval](#retrieval-eval).

## Retrieval eval

Run 2026-10-24 on the Phase 0 load (501 passages), 50 Spanish questions, `asOf` 2026-10-24. A
question passes when one of its expected passages is in the top 3. MRR@10 is the mean of 1/rank of
the first expected passage in the top 10 (0 when absent).

| Tokenizer | Match mode | Reranking threshold | Top 3 | Top 1 | MRR@10 |
| --------- | ---------- | ------------------- | ----- | ----- | ------ |
| `porter`  | `and`      | 0.4 (default)       | 44    | 39    | 0.830  |
| `porter`  | `or`       | 0.4 (default)       | 44    | 38    | 0.824  |
| `trigram` | `and`      | 0.4 (default)       | 45    | 40    | 0.850  |
| `trigram` | `or`       | 0.4 (default)       | 44    | 38    | 0.824  |
| `trigram` | `and`      | 0.2                 | 46    | 41    | 0.870  |
| `trigram` | `and`      | 0.1                 | 46    | 41    | 0.870  |
| `trigram` | `and`      | **0**               | 47    | 41    | 0.883  |

Decisions:

- **Keyword tokenizer `trigram`** (instance setting, changed from `porter`; the change re-indexed
  every item). It won by one question at the default threshold. `porter` stems English, which
  Spanish text and codes such as `CFDI40149` do not need.
- **Keyword match mode `and`** (instance default, kept). `or` never scored better.
- **Reranking threshold 0** (sent with every request, `RERANKING_THRESHOLD` in `src/search.ts`).
  The default reranker scores Spanish passages low: a correct first result scored 0.34, so the
  default 0.4 returned no results at all for 4 questions. At 0, a search always returns `limit`
  results; each carries its `rerankingScore` for the caller to weigh.

The three misses at these settings: _"¿Qué UsoCFDI lleva el comprobante con complemento para
recepción de pagos?"_ (rank 6) and _"¿Cuándo es obligatorio el tipo de cambio en un CFDI en
dólares?"_ (rank 7), both outranked by long example sections the old PDF parser labelled
poorly (`nodo-trasladop-importep-*`, `nodo-addenda-*`), and _"¿Qué significa el atributo ObjetoImp
del concepto?"_ (rank 6), outranked by the matrix rows for `ObjetoImp`.

### Códice's splitter and the embedding model (2026-10-25)

The guides re-split by `scripts/sections.ts` (520 passages, from 501): real node names, examples
kept with their rule, one passage per appendix question. Same 50 questions, `trigram`, `and`,
threshold 0. The expected keys the splitter renamed were mapped to the passage that starts with the
same SAT line (`nodo-formato-tipocambio` → `nodo-comprobante-tipocambio`, and four more). One
question gained an expected passage: the UsoCFDI question now also accepts
`complemento-pagos-guia-de-llenado/apendice-6-pregunta-6.md`, the SAT's own answer to it ("en el
campo UsoCFDI se debe registrar la clave “CP01” Pagos"), which ranks first now that it is a
passage of its own.

| Passages                     | Embedding model                 | Chunk size | Top 3  | Top 1  | MRR@10    |
| ---------------------------- | ------------------------------- | ---------- | ------ | ------ | --------- |
| Agent parser (before)        | `@cf/qwen/qwen3-embedding-0.6b` | 1,024      | 47     | 41     | 0.883     |
| Códice splitter              | `@cf/qwen/qwen3-embedding-0.6b` | 1,024      | 47     | 42     | 0.892     |
| Códice splitter, UsoCFDI fix | `@cf/qwen/qwen3-embedding-0.6b` | **1,024**  | **48** | **43** | **0.909** |
| Códice splitter, UsoCFDI fix | `@cf/qwen/qwen3-embedding-0.6b` | 512        | 47     | 42     | 0.897     |
| Códice splitter, UsoCFDI fix | `@cf/baai/bge-m3`               | 512        | 47     | 42     | 0.892     |

The "before" row was re-run the same day on the old index and matched the table above exactly.
The 512-token rows ran on comparison instances (`ingest --instance`, `eval --instance`) built with
`codice`'s settings, since deleted: on AI Search `@cf/baai/bge-m3` takes at most 512 input
tokens, so it cannot use 1,024-token chunks, and the qwen row at 512 separates the model from the
chunk size.

Decisions:

- **Embedding model `@cf/qwen/qwen3-embedding-0.6b`, chunk size 1,024** (kept). bge-m3 scored no
  better than qwen at the same chunk size, and both lose a question at 512.
- **Eval floor 48 of 50** (`codice-corpus.yml`, `EVAL_MIN_TOP3`).

The two misses left, both real (the passage that outranks the rule does not answer the question):

- _"¿Cuándo es obligatorio el tipo de cambio en un CFDI en dólares?"_ (rank 9): question 22 of the
  Anexo 20 questions (the FIX rate for the financial system) shares "tipo de cambio" and "dólares";
  the rule, `CFDI40115` or `Nodo: Comprobante › TipoCambio`, says it without "dólares".
- _"¿Qué significa el atributo ObjetoImp del concepto?"_ (rank 6): the matrix rows `CFDI40170` to
  `CFDI40172` name `ObjetoImp` in their heading and outrank the guide's definition. A filter on
  `kind` (`guia` for definitions) is the lever, not the passages.

At 512 tokens, _"Retención de ISR al 1.25% para el Régimen Simplificado de Confianza"_ also falls
to rank 4 (qwen) and 8 (bge-m3), behind the `TotalRetencionesISR` rules.

Two stale items of the old split (`nodo-trasladop-importep-15`, `nodo-en-base`) are still in
`codice`: AI Search answers their deletion with 429 `ai_search_instance_overloaded`. The next
`ingest` deletes them; neither appears in a top 3 of the runs above.

## Infrastructure

Created 2026-10-24; Phase 0 loaded the same day:

| Resource           | Name     | Binding                      |
| ------------------ | -------- | ---------------------------- |
| AI Search instance | `codice` | `CODICE_SEARCH`              |
| D1 database        | `codice` | `CODICE_DATABASE`            |
| Rate limit         | `1601`   | `CODICE_PUBLIC_RATE_LIMITER` |

No route, no custom domain, no Cloudflare Git build. The AI Search binding is `"remote": true`, so
`wrangler dev` (`pnpm dev:up` in the local stack, or `pnpm --filter @codice/api dev`,
Doppler `codice` `dev`) queries the real instance through Wrangler's Cloudflare auth, and seeds the
local D1 with `ingest --local` when it is empty; the tests use a local binding.

### Readiness

`/ready` answers `200 { service, status: "ready" }` when `CODICE_DATABASE`, `CODICE_SEARCH` and
`CODICE_PUBLIC_RATE_LIMITER` are bound, else `503` problem+json with code
`codice_bindings_not_ready`. It checks bindings only; it makes no D1 or search call.

### Monitoring and deploy

Errors and 5xx responses go to Sentry project `codice-api` (`@sentry/cloudflare`, traces
sampled by `sampleSentryTrace` from `@codice/monitoring`); `SENTRY_DSN` is a required secret
and Sentry stays off unless `SENTRY_RELEASE` is set. `deploy:production` applies the D1
migrations remotely, uploads a version tagged with the commit and its source maps, then deploys it,
as `apps/providers` does. It runs only from the Cloudflare Git build of `main`.
`sync-worker-secrets.yml` pushes `SENTRY_DSN` (and only that name) from Doppler `codice` `prd` to
the Worker; it skips the Worker while the script or the secret does not exist.

### Go-live checklist

Until cutover (`docs/operations/cutover.md`) production builds, secrets sync and the corpus
workflow run from `trstv/transitive`; this repository builds and tests the same code but deploys
nothing. The paths in the steps below are Transitive's.

Each step needs explicit approval. Status 2026-10-25: the Sentry project is `codice-api` in org
`jaantonio`, and `SENTRY_DSN` is in Doppler `codice` `prd` and bound to the Worker (steps 1, 3, 4;
the alert connection in step 1 is unchecked).
The Git build of `main` deploys on every merge, but with deploy command `npx wrangler deploy` and no
build variables (step 5 is not yet matched), so it applies no D1 migrations and uploads no source
maps: `0002` was applied by hand on 2026-10-25. `codice.io` is not purchased yet.

The Worker must exist before anything can bind its secret: the secrets API answers `10007`
(Worker does not exist), and Wrangler refuses to upload a new Worker whose required `SENTRY_DSN`
is unset. So the order is fixed:

1. **Sentry.** Project `codice-api` (org `jaantonio`, platform Cloudflare Workers), connected to
   the org-wide `Production issues → incident.io` alert
   (`docs/architecture/production-monitoring.md`). Its DSN is `SENTRY_DSN` in Doppler `codice`
   `prd`; the build needs a source-map upload token (step 5).
2. **Sync access** (before the sync change reaches `main`). Give the Doppler service account
   `github-worker-secrets-sync` read access to `codice` `prd`, and add the `codice` webhook
   (`docs/operations/doppler-secrets.md`, "Worker sync"). Without the access the daily sync fails at
   `codice`, after every `transitive` Worker has synced.
3. **Create the Worker.** A placeholder `codice` script from the dashboard (Hello World, no route,
   `workers.dev` off). It serves nothing; the first Git build replaces it.
4. **Bind the secret.** Run "Sync Worker secrets" by hand with `worker` `codice` and `apply` on (a
   `SENTRY_DSN` written before the Worker existed is older than the watermark, so the scheduled run
   skips it). Check: `cf workers secrets list` for `codice` shows `SENTRY_DSN`.
5. **Register the Git build** on the existing `codice` Worker, with the settings of `providers`.
   Registered; still to match: the deploy command and the build variables.
   - Repository `trstv/transitive`, production branch `main`, root directory `apps/codice`. At
     cutover it moves to `trstv/codice`, root directory `apps/api` (`docs/operations/cutover.md`).
   - Deploy command `pnpm run deploy:production`; non-production branches
     `pnpm exec wrangler versions upload` (previews never apply D1 migrations).
   - Build variables: `SENTRY_ORG` = `jaantonio` and `SENTRY_AUTH_TOKEN` (from step 1).
   - Watch paths: `codice` is in `scripts/workers-build-watch-paths.mjs`; run
     `node scripts/workers-build-watch-paths.mjs apply --yes` with a token that can edit Workers
     Builds. It derives:
     includes `apps/codice/*`, `packages/access-policy/*`, `packages/api-contracts/*`,
     `packages/monitoring/*`, `packages/typescript-config/*` and the root install inputs; excludes
     `*.md` and test files.
6. **First `deploy:production`.** The first merge after step 5 builds Códice with migrations and
   source maps. D1 `0000` to `0002` are already applied. Verify with `cf builds list`,
   `cf workers versions list` and `cf workers deployments list`, and that the Sentry release for the commit has source maps.
7. **Attach `codice.io`.** Add the zone to the account if it is not there, then a PR with the
   custom domain route in `wrangler.jsonc` and `ready: "https://codice.io/ready"` on the `codice`
   entry of `scripts/secrets/sync-worker-secrets.mjs`. Verify `GET https://codice.io/ready` → 200.

## Rollout

1. Scaffold, spec, dormant resources (done).
2. Phase 0: ingestion into AI Search and D1; `/v1` and `/mcp`; retrieval eval passing (done, not
   deployed).
3. The Agent calls Códice through a service binding and deletes its bundled search (done).
4. Register the Cloudflare Git build and attach `codice.io` (needs explicit approval).
5. Phases 1 and 2 of the corpus; public launch.

## Next steps

The work after Phase 0, in order. Tick an item off here when it lands, and update the sections above
to match.

1. **Credentials** (partly done). Doppler project `codice` holds `CODICE_AI_SEARCH_TOKEN` in `prd`
   (Cloudflare token `codice-ai-search`: AI Search Write and Run, for the ingestion) and in `dev`
   (`codice-ai-search-dev`: AI Search Run and Read, for searches and the eval; it cannot change
   the index), and `CODICE_D1_TOKEN` in `prd` (`codice-d1`: D1 Edit, for `wrangler d1 execute`
   outside an operator's session). The Doppler service account `codice-corpus` (read on `dev` and
   `prd`) has the GitHub identity the scheduled ingestion signs in with. `sync-worker-secrets.yml`
   syncs `SENTRY_DSN` from `codice` `prd` to the Worker (done), for Sentry project `codice-api`.
   Still to do: the build's source-map token (Go-live checklist, step 5).
2. **Scheduled ingestion** (workflow in place, not yet run). `codice-corpus.yml` checks the SAT,
   opens a `docs/sat-md` PR, ingests `main` and runs the eval with a floor of 48 of 50 (see
   [Ingestion](#ingestion)). Its credentials exist and its identity ID is pinned; tick this off
   after the first green `workflow_dispatch` run from `main`.
3. **The rest of the API** (done). `GET /v1/passages/:id` (Items API `get` and download), `GET /v1/sources`
   and `/v1/sources/:id`, and the MCP tools `read_passage`, `lookup_error`, `lookup_catalog` and
   `list_sources`.
4. **Deploy** (explicit approval): the Go-live checklist under "Monitoring and deploy".
5. **Agent switch-over** (Rollout 3, done): the Agent calls `CodiceKnowledge` through its `CODICE`
   service binding and no longer bundles `docs/sat-md`. `sat:knowledge` and the passage splitter
   (`sections.ts`) live here, in `scripts/`.
6. **Better passages** (done 2026-10-25: Códice's splitter, 48 of 50; bge-m3 compared and not
   adopted; see [Retrieval eval](#retrieval-eval)). Next: grow the question set, and try a `kind`
   filter for definition questions (the `ObjetoImp` miss).
7. **Large catalogs** (done; loaded remotely and the NOCASE index `0002` applied, 2026-10-25). `c_ClaveProdServ`,
   `c_ClaveUnidad`, `c_CodigoPostal`, `c_Colonia`, `c_Localidad`, `c_Municipio`,
   `c_NumPedimentoAduana` and `c_PatenteAduanal` load into D1 `catalog_entries` (see
   [Large catalogs](#large-catalogs)), so `/v1/catalogs/:name/:key` answers for every catCFDI
   catalog, and a column filter narrows a repeated key (`c_Colonia` by `c_CodigoPostal`).
8. **Versions.** Keep a superseded source's passages with a real `valid_until` when the SAT
   publishes a new version, so an `asOf` before the change still answers. Phase 0 keeps one version
   per source.
9. **Corpus Phases 1 and 2**, and the open questions below before a public launch.

## Open questions

- Legal review of republishing government texts (LFDA art. 14 fr. VIII) and the disclaimer wording.
- IMPI trademark search for "Códice".
- Whether public MCP use needs an API key for abuse control beyond the rate limit.
