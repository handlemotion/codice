import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CHAT_MAX_BODY_BYTES, CHAT_MAX_MESSAGES, CHAT_MAX_SEARCHES, CHAT_MODEL } from "../src/chat";
import type { CodiceBindings } from "../src/env";
import { app } from "../src/index";

/**
 * `POST /v1/chat`: the refusals are answered before the model is called, and the answering cases
 * stub the Anthropic API, so no test spends tokens. What the model answers is proved only
 * with real HTTP calls (SPEC.md, "Chat").
 */
const bindings = env as unknown as CodiceBindings;

let keys = 0;

function postChat(body: string, overrides: Partial<CodiceBindings> = {}, client = "203.0.113.1") {
  keys += 1;
  return app.fetch(
    new Request("https://codice.test/v1/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": client,
        // Its own key each time, so only the chat's per-client limit can trip.
        authorization: `Bearer cdc_test_chat${keys}`,
      },
      body,
    }),
    { ...bindings, ANTHROPIC_API_KEY: "test-key", ...overrides },
    createExecutionContext(),
  );
}

function run(messages: unknown[]) {
  return JSON.stringify({
    threadId: "thread",
    runId: "run",
    messages,
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  });
}

const question = (content: string, index = 0) => ({ id: `m${index}`, role: "user", content });

const messageStart = {
  type: "message_start",
  message: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: CHAT_MODEL,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
};

function eventStream(events: unknown[]) {
  return new Response(
    events
      .map(
        (event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

/** A Messages API stream whose one turn calls `search` once for each query, in parallel. */
function anthropicSearches(queries: string[]) {
  return eventStream([
    messageStart,
    ...queries.flatMap((q, index) => [
      {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: `toolu_${index}`, name: "search", input: {} },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify({ q }) },
      },
      { type: "content_block_stop", index },
    ]),
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ]);
}

/** A Messages API stream that answers `text` in one turn, without tools. */
function anthropicAnswer(text: string) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: CHAT_MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

beforeAll(async () => {
  await applyD1Migrations(bindings.CODICE_DATABASE!, env.TEST_MIGRATIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /v1/chat", () => {
  it("answers 503 when the model key is not configured", async () => {
    const response = await postChat(
      run([question("¿Qué es S01?")]),
      {
        ANTHROPIC_API_KEY: undefined,
      },
      "203.0.113.10",
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toMatchObject({ status: 503, code: "chat_unavailable" });
  });

  it("asks the model with Códice's prompt and tools, and streams its answer", async () => {
    const answer = "El uso S01 es «Sin efectos fiscales».";
    const requests: Request[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push(new Request(input, init));
      return anthropicAnswer(answer);
    });

    const response = await postChat(run([question("¿Qué es el uso S01?")]), {}, "203.0.113.2");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain(JSON.stringify(answer).slice(1, -1));
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/messages");
    expect(requests[0]!.headers.get("x-api-key")).toBe("test-key");
    const body = (await requests[0]!.json()) as {
      model: string;
      max_tokens: number;
      system: { text: string }[];
      tools: { name: string }[];
      output_config: unknown;
      cache_control: unknown;
    };
    expect(body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 2048,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
    });
    expect(body.tools.map((tool) => tool.name).sort()).toEqual([
      "list_sources",
      "lookup_catalog",
      "lookup_error",
      "read_passage",
      "search",
    ]);
    const system = body.system.map((block) => block.text).join("");
    expect(system).toContain("nunca de memoria");
    expect(system).toContain("No des asesoría fiscal");
    expect(system).toContain("Fuera de tema");
  });

  it("searches without reranking, at most CHAT_MAX_SEARCHES times a request", async () => {
    const calls: AiSearchSearchRequest[] = [];
    const searchBinding = {
      search: async (request: AiSearchSearchRequest) => {
        calls.push(request);
        return { search_query: "", chunks: [] };
      },
    } as unknown as AiSearchInstance;
    const requests: Request[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push(new Request(input, init));
      return requests.length === 1
        ? anthropicSearches(
            Array.from({ length: CHAT_MAX_SEARCHES + 1 }, (_, i) => `límite de búsquedas ${i}`),
          )
        : anthropicAnswer("Las reglas de Códice no cubren esto.");
    });

    const response = await postChat(
      run([question("¿Cuántas búsquedas?")]),
      { CODICE_SEARCH: searchBinding },
      "203.0.113.3",
    );
    await response.text();

    expect(calls).toHaveLength(CHAT_MAX_SEARCHES);
    expect(calls.every((call) => call.ai_search_options?.reranking?.enabled === false)).toBe(true);
    expect(requests).toHaveLength(2);
    const second = JSON.stringify(await requests[1]!.json());
    expect(second.match(/search_limit/g)).toHaveLength(1);
  });

  it.each([
    ["a body that is not JSON", "{", "203.0.113.11"],
    ["a body that is not an AG-UI run", JSON.stringify({ question: "hola" }), "203.0.113.12"],
    ["a run with no messages", run([]), "203.0.113.13"],
    [
      "a run with too many messages",
      run(Array.from({ length: CHAT_MAX_MESSAGES + 1 }, (_, index) => question("hola", index))),
      "203.0.113.14",
    ],
    [
      "a conversation over the size limit",
      run([question("x".repeat(CHAT_MAX_BODY_BYTES))]),
      "203.0.113.15",
    ],
  ])("refuses %s with 400", async (_, body, client) => {
    const response = await postChat(body, {}, client);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, code: "invalid_chat_request" });
  });

  it("limits each client to the chat's own rate", async () => {
    // wrangler.test.jsonc allows 2 chat requests per client per minute; these stop at the body.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push((await postChat("{", {}, "203.0.113.20")).status);
    }

    expect(statuses).toEqual([400, 400, 429]);
  });

  it("is POST only", async () => {
    const response = await app.fetch(
      new Request("https://codice.test/v1/chat", {
        headers: { "cf-connecting-ip": "203.0.113.30", authorization: "Bearer cdc_test_chatget" },
      }),
      bindings,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
  });
});
