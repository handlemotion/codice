import {
  chat,
  chatParamsFromRequestBody,
  maxIterations,
  toServerSentEventsResponse,
  toolDefinition,
} from "@tanstack/ai";
import { createAnthropicChat, type AnthropicChatModel } from "@tanstack/ai-anthropic";
import { z } from "zod";

import type { CodiceBindings } from "./env";
import {
  CodiceProblem,
  listSources,
  lookupCatalog,
  lookupError,
  readPassage,
  search,
} from "./handlers";
import {
  LookupCatalogArguments,
  LookupErrorArguments,
  ReadPassageArguments,
  SearchArguments,
} from "./mcp";

/**
 * The public demo assistant behind `POST /v1/chat` (SPEC.md, "Chat"): a cheap model answering over
 * the same read-only handlers as `/v1` and `/mcp`. Stateless: the browser sends the conversation
 * each turn, so nothing is stored.
 */
export const CHAT_MODEL = "claude-haiku-5-5";
export const CHAT_MAX_OUTPUT_TOKENS = 1024;
/** Model turns per request: enough for a search, a read or two, and the answer. */
export const CHAT_MAX_ITERATIONS = 6;
export const CHAT_MAX_BODY_BYTES = 64 * 1024;
export const CHAT_MAX_MESSAGES = 24;

const SYSTEM_PROMPT = `You are Códice's demo assistant on its public website. Códice is a searchable index of the Mexican tax authority's (SAT) own rules: the CFDI 4.0 filling guide (Anexo 20), the payment complement (Pagos 2.0) guide, the CFDI40xxx validation matrix, the SAT catalogs and the Resolución Miscelánea Fiscal (RMF). Developers reach it over an HTTP API (\`/v1\`) and MCP (\`/mcp\`).

Answer questions about CFDI and SAT rules with your tools, never from memory: search first, read a passage in full when the snippet is not enough, and use lookup_error or lookup_catalog for an exact code or key. Quote the SAT's text verbatim where it matters and name the source and passage id. If the tools do not hold the answer, say so plainly. These are the SAT's rules, not tax advice; say so when someone asks what they should do.

Reply in the user's language (Spanish or English), briefly, in Markdown. Questions about Códice itself (what it covers, the API, MCP) you may answer from this prompt. Politely decline anything unrelated to Mexican tax rules or Códice.`;

function toolError(cause: unknown) {
  if (cause instanceof CodiceProblem) {
    return { error: { code: cause.code, message: cause.detail ?? cause.title } };
  }
  throw cause;
}

/** Each tool calls the `/v1` handler; a refusal goes back to the model as data, not a failure. */
function chatTools(env: CodiceBindings) {
  const run =
    <T>(handler: (args: T) => Promise<unknown>) =>
    async (args: T) => {
      try {
        return await handler(args);
      } catch (cause) {
        return toolError(cause);
      }
    };
  return [
    toolDefinition({
      name: "search",
      description:
        "Search the SAT's CFDI 4.0 rules in force on a date. Returns passages quoted verbatim, each with its passage id, source, validity dates and relevance score.",
      inputSchema: SearchArguments,
    }).server(run((args: z.output<typeof SearchArguments>) => search(env, args))),
    toolDefinition({
      name: "read_passage",
      description: "Read one passage in full, verbatim, by the passage id a search result gives.",
      inputSchema: ReadPassageArguments,
    }).server(run((args: z.output<typeof ReadPassageArguments>) => readPassage(env, args.id))),
    toolDefinition({
      name: "lookup_error",
      description:
        "Look up a CFDI40xxx validation code in the SAT's error matrix: the node and attribute it checks, the validation and the message.",
      inputSchema: LookupErrorArguments,
    }).server(run((args: z.output<typeof LookupErrorArguments>) => lookupError(env, args.code))),
    toolDefinition({
      name: "lookup_catalog",
      description:
        "Look up one key of a SAT CFDI catalog (c_UsoCFDI, c_RegimenFiscal, c_FormaPago…), or only the rows `where` matches.",
      inputSchema: LookupCatalogArguments,
    }).server(
      run((args: z.output<typeof LookupCatalogArguments>) =>
        lookupCatalog(env, args.name, args.key, args.where),
      ),
    ),
    toolDefinition({
      name: "list_sources",
      description: "List the documents Códice holds, with their ids, titles and validity dates.",
      inputSchema: z.object({}),
    }).server(run(() => listSources(env))),
  ];
}

function invalid(detail: string) {
  return new CodiceProblem(400, "invalid_chat_request", "Invalid chat request", detail);
}

/** The AG-UI run the browser's `useChat` posts, within the demo's size limits. */
async function chatInput(request: Request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > CHAT_MAX_BODY_BYTES) {
    throw invalid(`The conversation is longer than ${CHAT_MAX_BODY_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw invalid("The body is not JSON.");
  }
  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
  try {
    params = await chatParamsFromRequestBody(parsed);
  } catch {
    throw invalid("The body is not an AG-UI run.");
  }
  if (params.messages.length === 0) throw invalid("The conversation has no messages.");
  if (params.messages.length > CHAT_MAX_MESSAGES) {
    throw invalid(`The conversation has more than ${CHAT_MAX_MESSAGES} messages.`);
  }
  return { messages: params.messages, threadId: params.threadId, runId: params.runId };
}

/** Streams the assistant's answer as server-sent events. */
export async function chatResponse(env: CodiceBindings, request: Request): Promise<Response> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new CodiceProblem(503, "chat_unavailable", "The chat is not available");
  }
  const { messages, threadId, runId } = await chatInput(request);
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  const stream = chat({
    // The pinned adapter's model list predates Claude Haiku 5.5; it only passes the id through.
    adapter: createAnthropicChat(CHAT_MODEL as AnthropicChatModel, apiKey, { maxRetries: 0 }),
    messages,
    systemPrompts: [SYSTEM_PROMPT],
    tools: chatTools(env),
    agentLoopStrategy: maxIterations(CHAT_MAX_ITERATIONS),
    // Haiku thinks by default at medium effort; a chat answer over a few lookups needs little.
    modelOptions: { max_tokens: CHAT_MAX_OUTPUT_TOKENS, output_config: { effort: "low" } },
    threadId,
    runId,
    abortController,
  });
  return toServerSentEventsResponse(stream, { abortController });
}
