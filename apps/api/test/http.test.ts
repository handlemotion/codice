import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { CodiceEnv } from "../src/env";
import { apiJson } from "../src/http";

describe("apiJson", () => {
  it("wraps data in the repo success envelope with the request id", async () => {
    const app = new Hono<CodiceEnv>()
      .use("*", async (context, next) => {
        context.set("requestId", "envelope-request");
        await next();
      })
      .get("/", (context) => apiJson(context, { code: "CFDI40149" }));

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { code: "CFDI40149" },
      meta: { requestId: "envelope-request" },
    });
  });
});
