import { z } from "zod";

import { SEARCH_SOURCES_MAX } from "./handlers";
import {
  CatalogLookupArgument,
  ErrorCodeArgument,
  ListChangesArguments,
  MCP_SERVER_VERSION,
  ReadPassageArguments,
  SearchArguments,
  SearchCatalogArguments,
} from "./mcp";

/**
 * The public HTTP API as an OpenAPI 3.1 document, for the docs' API reference (apps/site renders
 * it with fumadocs-openapi). Parameters reuse the MCP tools' Zod schemas, so their limits and
 * descriptions stay one source; responses mirror `@codice/contracts`. `/v1/chat` is the site's own
 * endpoint and stays out. `pnpm --filter @codice/api openapi` writes it to the site; a test fails
 * when the written file or the route list drifts from this.
 */

const Source = z.object({
  id: z.string(),
  title: z.string(),
  authority: z.string(),
  url: z.string().describe("Where the SAT publishes the document."),
  sha256: z
    .string()
    .describe("Hash of the document Códice read, to check it against the original."),
  publishedAt: z.string().nullable(),
  retrievedAt: z.string(),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
});

const Validity = {
  validFrom: z.string().nullable().describe("First day the rule applies, YYYY-MM-DD."),
  validUntil: z.string().nullable().describe("Last day it applies; null while in force."),
};

const SearchResult = z.object({
  passageId: z.string().describe("Pass it to `/v1/passages/{id}` to read the whole passage."),
  source: z.string(),
  quote: z.string().describe("The matched text, verbatim as the SAT wrote it."),
  authority: z.string().nullable(),
  kind: z.string().nullable(),
  ...Validity,
  score: z.number(),
  scoring: z.object({
    keywordScore: z.number().nullable(),
    vectorScore: z.number().nullable(),
    rerankingScore: z.number().nullable(),
  }),
  sourceTitle: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourcePublishedAt: z.string().nullable(),
});

const BriefSearchResult = z.object({
  passageId: z.string().describe("Pass it to `/v1/passages/{id}` to read the whole passage."),
  heading: z.string().nullable().describe("The passage's heading path."),
  excerpt: z
    .string()
    .describe(
      "Up to about 300 characters of the matched text around the question's words, an exact substring of it.",
    ),
  truncated: z
    .object({ before: z.boolean(), after: z.boolean() })
    .describe("Whether the matched text continues before or after the excerpt."),
  kind: z.string().nullable(),
  ...Validity,
  score: z.number(),
});

const SearchQuery = {
  query: z.string(),
  asOf: z.string(),
  source: z.array(z.string()).nullable().describe("The sources asked for, sorted; null for all."),
  kind: z.string().nullable(),
};

const Search = z.discriminatedUnion("format", [
  z.object({ ...SearchQuery, format: z.literal("full"), results: z.array(SearchResult) }),
  z.object({ ...SearchQuery, format: z.literal("brief"), results: z.array(BriefSearchResult) }),
]);

const Passage = z.object({
  passageId: z.string(),
  heading: z.string(),
  text: z.string().describe("The whole passage: its heading path, then the verbatim text."),
  authority: z.string().nullable(),
  kind: z.string().nullable(),
  ...Validity,
  source: Source.nullable(),
});

const ErrorCode = z.object({
  code: z.string(),
  sourceId: z.string(),
  node: z.string(),
  attribute: z.string(),
  validation: z.string().describe("The SAT's validation rule, verbatim."),
  message: z.string().describe("The message the SAT returns, verbatim."),
  passageId: z.string(),
  source: Source.nullable(),
});

const CatalogFields = z.record(z.string(), z.string().nullable());

const CatalogEntry = z.object({
  catalog: z.string(),
  key: z.string(),
  entries: z.array(
    z.object({ fields: CatalogFields, validFrom: z.string(), validUntil: z.string().nullable() }),
  ),
  source: Source.nullable(),
});

const Catalog = z.object({
  catalog: z.string(),
  entries: z.array(
    z.object({
      key: z.string(),
      fields: CatalogFields,
      validFrom: z.string(),
      validUntil: z.string().nullable(),
    }),
  ),
  truncated: z.boolean().describe("True when the catalog has more than the 500 entries returned."),
  source: Source.nullable(),
});

const CatalogSearch = z.object({
  catalog: z.string(),
  query: z.string(),
  entries: Catalog.shape.entries.describe(
    "The matching entries, best first; empty when none matches.",
  ),
  source: Source.nullable(),
});

const Change = z.object({
  change: z
    .enum(["added", "changed", "removed"])
    .describe(
      "`changed` with a null `previousPassageId` is a change Códice holds no earlier text of.",
    ),
  date: z.string().describe("The day the change applies from, YYYY-MM-DD."),
  passageId: z
    .string()
    .describe(
      "The text in force from `date`; for `removed`, the dated id of the last text. Read it with `/v1/passages/{id}`.",
    ),
  previousPassageId: z
    .string()
    .nullable()
    .describe("For `changed`, the dated id of the text that applied until the day before."),
  source: z.string(),
  heading: z.string(),
  kind: z.string().nullable(),
  ...Validity,
});

const Changes = z.object({
  since: z.string(),
  until: z.string().nullable(),
  source: z.string().nullable(),
  changes: z.array(Change).describe("By `date`, then `passageId`."),
});

const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z
    .string()
    .describe(
      "Stable, machine-readable: `unauthorized`, `rate_limited`, `invalid_request`, `…_not_found`.",
    ),
  requestId: z.string(),
});

type Schema = Record<string, unknown>;

function jsonSchema(schema: z.ZodType): Schema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Schema;
  return rest;
}

// The `{ data, meta }` envelope every success uses.
function success(data: z.ZodType, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: jsonSchema(z.object({ data, meta: z.object({ requestId: z.string() }) })),
      },
    },
  };
}

function problems(...statuses: number[]) {
  const described: Record<number, string> = {
    400: "The request is malformed.",
    401: "Missing, unknown, revoked or expired API key.",
    404: "Nothing by that id, code or key.",
    429: "Over 60 requests a minute for this key. Retry after `retry-after` seconds.",
    502: "The search service failed.",
  };
  return Object.fromEntries(
    [...statuses, 401, 429].map((status) => [
      String(status),
      {
        description: described[status],
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      },
    ]),
  );
}

// Each field of an object schema as a parameter in `where` (`query` or `path`).
function parametersOf(schema: z.ZodObject, where: "query" | "path", only?: string[]) {
  const { properties, required = [] } = jsonSchema(schema) as {
    properties: Record<string, Schema & { description?: string }>;
    required?: string[];
  };
  return Object.entries(properties)
    .filter(([name]) => !only || only.includes(name))
    .map(([name, { description, ...property }]) => ({
      name,
      in: where,
      required: where === "path" || required.includes(name),
      description,
      schema: property,
    }));
}

/**
 * `/v1/search`'s query parameters: the MCP tool's, with `source` as the repeated parameter the
 * route reads (`?source=a&source=b`) instead of the tool's one id or list.
 */
function searchParameters() {
  return parametersOf(SearchArguments, "query").map((parameter) =>
    parameter.name === "source"
      ? {
          ...parameter,
          description:
            "Only these sources: repeat it for several (`?source=anexo-20-guia-de-llenado&source=matriz-de-errores-cfdi-40`). The ids are the ones `/v1/sources` lists, such as `rmf-2026`.",
          schema: { type: "array", items: { type: "string" }, maxItems: SEARCH_SOURCES_MAX },
          style: "form",
          explode: true,
        }
      : parameter,
  );
}

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Códice API",
      version: MCP_SERVER_VERSION,
      description:
        "Las reglas del SAT, citadas textualmente con su fuente y vigencia. Every response is `{ data, meta }`; errors are `application/problem+json`.",
    },
    servers: [{ url: "https://codice.io" }],
    security: [{ bearer: [] }, { apiKey: [] }],
    tags: [
      { name: "Búsqueda", description: "Find rules by question or code." },
      { name: "Registros", description: "Exact lookups: error codes, catalogs and sources." },
    ],
    paths: {
      "/v1/search": {
        get: {
          operationId: "search",
          tags: ["Búsqueda"],
          summary: "Buscar reglas",
          description:
            "Searches the SAT's rules in force on `asOf` by meaning and by exact code, and returns the matching passages verbatim with their source; `format=brief` returns each one's heading path and an excerpt instead.",
          parameters: searchParameters(),
          responses: {
            200: success(Search, "The matching passages, best first."),
            ...problems(400, 502),
          },
        },
      },
      "/v1/passages/{id}": {
        get: {
          operationId: "readPassage",
          tags: ["Búsqueda"],
          summary: "Leer un pasaje",
          description:
            "The whole passage a search result points to. The id holds a slash; send it plain or encoded (`%2F`).",
          parameters: parametersOf(ReadPassageArguments, "path"),
          responses: { 200: success(Passage, "The passage."), ...problems(400, 404, 502) },
        },
      },
      "/v1/errors/{code}": {
        get: {
          operationId: "lookupError",
          tags: ["Registros"],
          summary: "Consultar un código de error",
          description: "A row of the SAT's CFDI 4.0 validation matrix, verbatim, with its source.",
          parameters: parametersOf(ErrorCodeArgument, "path"),
          responses: { 200: success(ErrorCode, "The matrix row."), ...problems(404) },
        },
      },
      "/v1/catalogs/{name}": {
        get: {
          operationId: "listCatalog",
          tags: ["Registros"],
          summary: "Listar un catálogo",
          description:
            "A SAT catalog in the SAT's order, at most 500 entries. With `q`, a search of the catalog by description instead: the entries whose key or descriptions hold every word of `q` (or, when none does, the most of them), best first, from D1's full-text index.",
          parameters: [
            ...parametersOf(CatalogLookupArgument, "path", ["name"]),
            ...parametersOf(SearchCatalogArguments, "query", ["q", "limit"]).map((parameter) => ({
              ...parameter,
              required: false,
            })),
          ],
          responses: {
            200: success(
              z.union([Catalog, CatalogSearch]),
              "The catalog; with `q`, the matching entries.",
            ),
            ...problems(400, 404),
          },
        },
      },
      "/v1/catalogs/{name}/{key}": {
        get: {
          operationId: "lookupCatalog",
          tags: ["Registros"],
          summary: "Consultar una clave de catálogo",
          description:
            "Every entry of a key in a SAT catalog. Any other query parameter filters by a column, named as in the SAT's catalog (`?c_CodigoPostal=01000`).",
          parameters: parametersOf(CatalogLookupArgument, "path", ["name", "key"]),
          responses: { 200: success(CatalogEntry, "The key's entries."), ...problems(400, 404) },
        },
      },
      "/v1/changes": {
        get: {
          operationId: "listChanges",
          tags: ["Registros"],
          summary: "Listar los cambios",
          description:
            "The passages the SAT added, changed or removed from `since` through `until`, by the day each change applies from. The first version of a source Códice holds is where its history starts, not a change.",
          parameters: parametersOf(ListChangesArguments, "query"),
          responses: { 200: success(Changes, "The changes, oldest first."), ...problems(400) },
        },
      },
      "/v1/sources": {
        get: {
          operationId: "listSources",
          tags: ["Registros"],
          summary: "Listar las fuentes",
          description: "Every document Códice reads, with its provenance.",
          responses: {
            200: success(z.object({ sources: z.array(Source) }), "The sources."),
            ...problems(),
          },
        },
      },
      "/v1/sources/{id}": {
        get: {
          operationId: "readSource",
          tags: ["Registros"],
          summary: "Leer una fuente",
          description: "One source document's provenance.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The source's id, such as `anexo-20-guia-de-llenado`.",
            },
          ],
          responses: { 200: success(Source, "The source."), ...problems(404) },
        },
      },
    },
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: "An API key from the dashboard (`/keys`), `cdc_…`.",
        },
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: { Problem: jsonSchema(Problem) },
    },
  };
}
