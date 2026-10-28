import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { CodiceBindings } from "./env";
import {
  CodiceProblem,
  listChanges,
  listSources,
  lookupCatalog,
  lookupError,
  readPassage,
  search,
} from "./handlers";
import {
  EXCERPT_LENGTH,
  PASSAGE_KINDS,
  SEARCH_FORMATS,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
} from "./search";

export const MCP_SERVER_NAME = "codice";
export const MCP_SERVER_VERSION = "0.1.0";

const INSTRUCTIONS =
  "Códice searches the Mexican tax authority's (SAT) own rules: the CFDI 4.0 filling guide (Anexo 20), the payment complement (Pagos 2.0) guide, the CFDI40xxx validation matrix and the Resolución Miscelánea Fiscal (RMF), one passage a regla, and the law they rest on: the Código Fiscal de la Federación (CFF), one passage an article, as the Cámara de Diputados publishes it; and it looks up the CFDI catalogs (c_UsoCFDI, c_RegimenFiscal, c_CodigoPostal…) by key. Results quote the text verbatim with its source and validity dates; quote them rather than paraphrasing, and treat them as rules, not tax advice. `search` finds passages, each as its heading path and a verbatim excerpt (whole when `truncated` is false on both sides); `read_passage` returns one in full, with its source, by its passage id; `lookup_error` and `lookup_catalog` answer an exact CFDI40xxx code or catalog key; `list_sources` names the documents Códice holds; `list_changes` lists the passages added, changed or removed between two dates.";

export const SearchArguments = z.object({
  q: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      "The question or code, in Spanish or English, such as `CFDI40149` or `código postal del receptor con RFC genérico`.",
    ),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional()
    .describe("Only rules in force on this date, YYYY-MM-DD. Defaults to today in Mexico City."),
  source: z
    .string()
    .optional()
    .describe(
      "Only one source: `anexo-20-guia-de-llenado`, `complemento-pagos-guia-de-llenado`, `matriz-de-errores-cfdi-40`, `rmf-2026` or `cff`.",
    ),
  kind: z
    .enum(PASSAGE_KINDS)
    .optional()
    .describe(
      "Only one kind of passage: `guia` for the filling guides, which define each field (ask what a field means with `guia`); `anexo` for the validation matrix; `regla` for the RMF reglas; `ley` for the CFF's articles.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMIT_MAX)
    .optional()
    .describe(`How many passages to return; ${SEARCH_LIMIT_DEFAULT} by default.`),
  format: z
    .enum(SEARCH_FORMATS)
    .optional()
    .describe(
      `\`full\` (the default) quotes each passage's matched text; \`brief\` gives its heading path and an excerpt of at most ${EXCERPT_LENGTH} characters around the question's words, cut from the text verbatim, for \`/v1/passages/{id}\` to read the one that answers.`,
    ),
});

/**
 * MCP's `search` is brief by default: an agent reads the headings and excerpts, then `read_passage`
 * for a cut one it quotes, instead of holding every full passage in its context (SPEC.md, "MCP
 * surface").
 */
export const McpSearchArguments = SearchArguments.extend({
  format: SearchArguments.shape.format.describe(
    `\`brief\` (the default) gives each passage's heading path and an excerpt of at most ${EXCERPT_LENGTH} characters around the question's words, cut from the text verbatim. \`full\` quotes each passage's whole matched text, with its source.`,
  ),
});

export const ReadPassageArguments = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .describe(
      "The passage id a search result gives, `<source>/<anchor>.md`, such as `matriz-de-errores-cfdi-40/cfdi40149.md`.",
    ),
});

export const LookupErrorArguments = z.object({
  code: z
    .string()
    .min(1)
    .max(32)
    .describe("A CFDI 4.0 validation code from the SAT's error matrix, such as `CFDI40149`."),
});

export const LookupCatalogArguments = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "The SAT catalog, such as `c_UsoCFDI` or `RegimenFiscal`; the `c_` prefix is optional.",
    ),
  key: z.string().min(1).max(64).describe("The entry's key, such as `S01` or `601`."),
  where: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Keep only the entries whose column equals the value, by the catalog's own column names, for a key that repeats: `{ c_CodigoPostal: '01000' }` for a `c_Colonia` key, `{ c_Estado: 'JAL' }` for a `c_Municipio` or `c_Localidad` key.",
    ),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export const ListChangesArguments = z.object({
  since: z
    .string()
    .regex(ISO_DATE)
    .describe("The first day of the window, YYYY-MM-DD: changes that apply from this day on."),
  until: z
    .string()
    .regex(ISO_DATE)
    .optional()
    .describe(
      "The last day of the window, YYYY-MM-DD. Without it, every change from `since` on, including any Códice already holds for a later date.",
    ),
  source: z
    .string()
    .optional()
    .describe("Only one source, by the id `list_sources` gives, such as `rmf-2026`."),
});

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function toolResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function toolError(cause: unknown) {
  const error =
    cause instanceof CodiceProblem
      ? { code: cause.code, message: cause.detail ?? cause.title, status: cause.status }
      : { code: "internal_error", message: "The request failed", status: 500 };
  return { ...toolResult({ error }), isError: true };
}

function registerTool<Schema extends z.ZodObject>(
  server: McpServer,
  name: string,
  config: { title: string; description: string; inputSchema: Schema },
  run: (args: z.output<Schema>) => Promise<Record<string, unknown>>,
) {
  server.registerTool(
    name,
    {
      ...config,
      inputSchema: config.inputSchema as z.ZodType<Record<string, unknown>>,
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return toolResult(await run(args as z.output<Schema>));
      } catch (cause) {
        return toolError(cause);
      }
    },
  );
}

/** The public, read-only MCP server; each tool calls the same handler as `/v1`. */
export function createCodiceMcpServer(env: CodiceBindings) {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTool(
    server,
    "search",
    {
      title: "Search SAT rules",
      description:
        "Search the SAT's rules in force on a date: the CFDI 4.0 and Pagos 2.0 guides, the CFDI40xxx error matrix, the RMF and the CFF. Catalog keys are not searched; use `lookup_catalog`. Returns the best passages, each with its passage id, heading path, an excerpt cut verbatim from its text, validity dates and relevance score. An excerpt with `truncated.before` and `truncated.after` false is the whole passage; otherwise read the one that answers with `read_passage` before quoting it, or quote the excerpt with an ellipsis (…) where it is cut. `format: full` returns each passage's whole matched text and source instead.",
      inputSchema: McpSearchArguments,
    },
    (args) => search(env, { ...args, format: args.format ?? "brief" }),
  );
  registerTool(
    server,
    "read_passage",
    {
      title: "Read a passage",
      description:
        "Read one passage in full, verbatim, by the passage id a search result gives, with its heading, validity dates and source.",
      inputSchema: ReadPassageArguments,
    },
    (args) => readPassage(env, args.id),
  );
  registerTool(
    server,
    "lookup_error",
    {
      title: "Look up a CFDI error code",
      description:
        "Look up a CFDI40xxx validation code in the SAT's error matrix: the node and attribute it checks, the validation, the message, and its source.",
      inputSchema: LookupErrorArguments,
    },
    (args) => lookupError(env, args.code),
  );
  registerTool(
    server,
    "lookup_catalog",
    {
      title: "Look up a SAT catalog entry",
      description:
        "Look up one key of a SAT CFDI catalog (c_UsoCFDI, c_RegimenFiscal, c_Colonia…): every row the catalog holds for it, or only the rows `where` matches, with validity dates and source.",
      inputSchema: LookupCatalogArguments,
    },
    (args) => lookupCatalog(env, args.name, args.key, args.where),
  );
  registerTool(
    server,
    "list_sources",
    {
      title: "List sources",
      description:
        "List the documents Códice holds: each source's id (the `source` filter of `search`), title, authority, URL, publication and validity dates.",
      inputSchema: z.object({}),
    },
    () => listSources(env),
  );
  registerTool(
    server,
    "list_changes",
    {
      title: "List changes",
      description:
        "List the passages the SAT added, changed or removed between two dates, by the day each change applies from. Each change gives the passage id of the text in force from that day and, for a change, the dated id of the text before it, which `read_passage` reads; a change with no previous id is one Códice holds no earlier text of.",
      inputSchema: ListChangesArguments,
    },
    (args) => listChanges(env, args),
  );
  return server;
}
