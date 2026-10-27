import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { CHAT_MAX_BODY_BYTES, CHAT_MAX_MESSAGES } from "../src/chat";
import type { CodiceBindings } from "../src/env";
import { app } from "../src/index";

/**
 * `POST /v1/chat` refusals: every case here is answered before the model is called, so no test
 * spends tokens. The streamed answer itself is proved with real HTTP calls (SPEC.md, "Chat").
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
