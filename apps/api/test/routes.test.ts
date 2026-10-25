import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

import { catalogEntries, errorCodes, passages, sources } from "../src/db/schema";
import type { CodiceBindings } from "../src/env";
import { app, CodiceKnowledge } from "../src/index";

/**
 * AI Search does not run locally, so these tests stand in a recorded `search()` and check the
 * request Códice sends and how it maps the answer. They are not evidence of retrieval: the
 * retrieval eval (`pnpm eval`) is.
 */
type SearchCall = AiSearchSearchRequest;

function fakeSearch(chunks: AiSearchSearchResponse["chunks"], calls: SearchCall[] = []) {
  return {
    search: async (request: SearchCall) => {
      calls.push(request);
      return { search_query: "", chunks };
    },
  } as unknown as AiSearchInstance;
}

const PASSAGE_ID = "matriz-de-errores-cfdi-40/cfdi40149.md";
const PASSAGE_BODY =
  "# Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149\n\nCódigo: CFDI40149\n";

type ItemsCall = ["list", AiSearchListItemsParams | undefined] | ["download", string];

/** A recorded Items API: `list` by key finds the stored item, `get(id).download()` its body. */
function fakeItems(
  stored: { id: string; key: string; body: string; metadata?: Record<string, unknown> }[],
  calls: ItemsCall[] = [],
  failure?: Error,
) {
  return {
    items: {
      list: async (params?: AiSearchListItemsParams) => {
        calls.push(["list", params]);
        if (failure) throw failure;
        return {
          result: stored
            .filter((item) => item.key === params?.key)
            .map(({ id, key, metadata }) => ({ id, key, status: "completed", metadata })),
        };
      },
      get: (id: string) => ({
        download: async () => {
          calls.push(["download", id]);
          const item = stored.find((candidate) => candidate.id === id);
          if (!item) throw new Error("not found");
          return {
            body: new Response(item.body).body,
            contentType: "text/markdown",
            filename: item.key,
            size: item.body.length,
          };
        },
      }),
    },
  } as unknown as AiSearchInstance;
}

const CHUNK = {
  id: "chunk-1",
  type: "text",
  score: 0.91,
  text: 'Validación: Si el valor del atributo Rfc del receptor es "XAXX010101000" o "XEXX010101000", este atributo debe ser igual al valor del atributo LugarExpedicion.',
  item: {
    key: "matriz-de-errores-cfdi-40/cfdi40149.md",
    metadata: { authority: "SAT", kind: "anexo", valid_from: 20260325, valid_until: 99991231 },
  },
  scoring_details: { keyword_score: 0.6, vector_score: 0.8, reranking_score: 0.95 },
};

const bindings = env as unknown as CodiceBindings;

/** Each request is its own client, so the public rate limit (3 a minute in tests) never trips. */
let client = 0;
function clientAddress() {
  client += 1;
  return `203.0.113.${client}`;
}

function request(path: string, search = fakeSearch([CHUNK]), headers: Record<string, string> = {}) {
  return app.request(
    `https://codice.test${path}`,
    { headers: { "cf-connecting-ip": clientAddress(), ...headers } },
    { ...bindings, CODICE_SEARCH: search },
  );
}

const SOURCE = {
  authority: "SAT" as const,
  sha256: "0".repeat(64),
  retrievedAt: new Date("2026-10-21T00:00:00.000Z"),
};

beforeAll(async () => {
  await applyD1Migrations(bindings.CODICE_DATABASE!, env.TEST_MIGRATIONS);
  const db = drizzle(bindings.CODICE_DATABASE!);
  await db.insert(sources).values([
    {
      ...SOURCE,
      id: "matriz-de-errores-cfdi-40",
      title: "Matriz de códigos de error",
      url: "http://omawww.sat.gob.mx/matriz.xls",
      publishedAt: "2026-03-25",
      validFrom: 20260325,
    },
    {
      ...SOURCE,
      id: "catalogos-cfdi-40",
      title: "Catálogos",
      url: "http://omawww.sat.gob.mx/cat.xls",
      publishedAt: "2026-10-15",
      validFrom: 20261015,
    },
  ]);
  await db.insert(errorCodes).values([
    {
      code: "CFDI40149",
      sourceId: "matriz-de-errores-cfdi-40",
      node: "cfdi:Receptor",
      attribute: "DomicilioFiscalReceptor",
      validation: "Si el valor…",
      message: "El campo DomicilioFiscalReceptor, no es igual al valor del campo LugarExpedicion.",
    },
    {
      code: "CFDI140223",
      sourceId: "matriz-de-errores-cfdi-40",
      node: "cfdi:Impuestos",
      attribute: "Traslado",
      validation: "Validación",
      message: "Mensaje",
    },
  ]);
  await db.insert(passages).values({
    key: PASSAGE_ID,
    sourceId: "matriz-de-errores-cfdi-40",
    heading: "Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149",
    sha256: "1".repeat(64),
  });
  // Inserted in sheet order, as the ingestion does.
  await db.insert(catalogEntries).values([
    {
      catalog: "c_UsoCFDI",
      key: "S01",
      sourceId: "catalogos-cfdi-40",
      fields: { c_UsoCFDI: "S01", Descripción: "Sin efectos fiscales." },
      validFrom: 20220101,
    },
    {
      catalog: "c_TasaOCuota",
      key: "0.160000",
      sourceId: "catalogos-cfdi-40",
      fields: { Impuesto: "IVA", Traslado: "Sí" },
      validFrom: 20220101,
    },
    {
      catalog: "c_TasaOCuota",
      key: "0.160000",
      sourceId: "catalogos-cfdi-40",
      fields: { Impuesto: "IVA", Retención: "Sí" },
      validFrom: 20220101,
      validUntil: 20231231,
    },
    {
      catalog: "c_CodigoPostal",
      key: "01000",
      sourceId: "catalogos-cfdi-40",
      fields: { c_CodigoPostal: "01000", c_Estado: "CMX", c_Municipio: "010" },
      validFrom: 20190107,
    },
    // c_Colonia repeats a key per postal code, c_Municipio per state.
    {
      catalog: "c_Colonia",
      key: "0001",
      sourceId: "catalogos-cfdi-40",
      fields: {
        c_Colonia: "0001",
        c_CodigoPostal: "01000",
        "Nombre del asentamiento": "San Ángel",
      },
      validFrom: 20220101,
    },
    {
      catalog: "c_Colonia",
      key: "0001",
      sourceId: "catalogos-cfdi-40",
      fields: {
        c_Colonia: "0001",
        c_CodigoPostal: "01010",
        "Nombre del asentamiento": "Los Alpes",
      },
      validFrom: 20220101,
    },
    {
      catalog: "c_Municipio",
      key: "001",
      sourceId: "catalogos-cfdi-40",
      fields: { c_Municipio: "001", c_Estado: "AGU", Descripción: "Aguascalientes" },
      validFrom: 20220101,
    },
    {
      catalog: "c_Municipio",
      key: "001",
      sourceId: "catalogos-cfdi-40",
      fields: { c_Municipio: "001", c_Estado: "BCN", Descripción: "Ensenada" },
      validFrom: 20220101,
    },
  ]);
});

describe("GET /v1/search", () => {
  it("filters on validity at asOf and the source's folder", async () => {
    const calls: SearchCall[] = [];
    const response = await request(
      "/v1/search?q=c%C3%B3digo%20postal%20RFC%20gen%C3%A9rico&asOf=2026-06-01&source=matriz-de-errores-cfdi-40&limit=3",
      fakeSearch([CHUNK], calls),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        messages: [{ role: "user", content: "código postal RFC genérico" }],
        ai_search_options: {
          retrieval: {
            filters: {
              valid_from: { $lte: 20260601 },
              valid_until: { $gte: 20260601 },
              folder: "matriz-de-errores-cfdi-40/",
            },
            max_num_results: 3,
            return_on_failure: false,
          },
          reranking: { match_threshold: 0 },
        },
      },
    ]);
  });

  it("filters on a passage kind", async () => {
    const calls: SearchCall[] = [];
    const response = await request(
      "/v1/search?q=ObjetoImp&asOf=2026-06-01&kind=guia",
      fakeSearch([CHUNK], calls),
    );

    expect(response.status).toBe(200);
    expect(calls[0]?.ai_search_options?.retrieval?.filters).toEqual({
      valid_from: { $lte: 20260601 },
      valid_until: { $gte: 20260601 },
      kind: "guia",
    });
    expect(await response.json()).toMatchObject({ data: { source: null, kind: "guia" } });
  });

  it("returns each chunk as a verbatim quote with validity, score and source provenance", async () => {
    const response = await request("/v1/search?q=CFDI40149", undefined, {
      "x-request-id": "ray-1",
    });

    expect(await response.json()).toEqual({
      data: {
        query: "CFDI40149",
        asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
        source: null,
        kind: null,
        results: [
          {
            passageId: "matriz-de-errores-cfdi-40/cfdi40149.md",
            source: "matriz-de-errores-cfdi-40",
            quote: CHUNK.text,
            authority: "SAT",
            kind: "anexo",
            validFrom: "2026-03-25",
            validUntil: null,
            score: 0.91,
            scoring: { keywordScore: 0.6, vectorScore: 0.8, rerankingScore: 0.95 },
            sourceTitle: "Matriz de códigos de error",
            sourceUrl: "http://omawww.sat.gob.mx/matriz.xls",
            sourcePublishedAt: "2026-03-25",
          },
        ],
      },
      meta: { requestId: "ray-1" },
    });
  });

  it.each([
    ["/v1/search", "`q` is required."],
    ["/v1/search?q=x&asOf=2026-02-30", "`asOf` must be a date as YYYY-MM-DD."],
    ["/v1/search?q=x&limit=100", "`limit` must be a whole number from 1 to 50."],
    ["/v1/search?q=x&kind=nota", "`kind` is one of ley, reglamento, regla, anexo, guia, criterio."],
  ])("refuses %s", async (path, detail) => {
    const response = await request(path);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toMatchObject({ code: "invalid_request", detail });
  });

  it("answers 502 when AI Search fails", async () => {
    const failing = {
      search: async () => {
        throw new Error("upstream");
      },
    } as unknown as AiSearchInstance;
    const response = await request("/v1/search?q=x", failing);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "search_unavailable" });
  });
});

describe("GET /v1/passages/:id", () => {
  const stored = [
    {
      id: "item-1",
      key: PASSAGE_ID,
      body: PASSAGE_BODY,
      metadata: { authority: "SAT", kind: "anexo", valid_from: 20260325, valid_until: 99991231 },
    },
  ];

  it("lists the item by key, downloads it by id and returns its full text with provenance", async () => {
    const calls: ItemsCall[] = [];
    const response = await request(`/v1/passages/${PASSAGE_ID}`, fakeItems(stored, calls), {
      "x-request-id": "ray-2",
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      ["list", { key: PASSAGE_ID, per_page: 1 }],
      ["download", "item-1"],
    ]);
    expect(await response.json()).toEqual({
      data: {
        passageId: PASSAGE_ID,
        heading: "Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149",
        text: PASSAGE_BODY,
        authority: "SAT",
        kind: "anexo",
        validFrom: "2026-03-25",
        validUntil: null,
        source: {
          id: "matriz-de-errores-cfdi-40",
          title: "Matriz de códigos de error",
          authority: "SAT",
          url: "http://omawww.sat.gob.mx/matriz.xls",
          sha256: "0".repeat(64),
          publishedAt: "2026-03-25",
          retrievedAt: "2026-10-21T00:00:00.000Z",
          validFrom: "2026-03-25",
          validUntil: null,
        },
      },
      meta: { requestId: "ray-2" },
    });
  });

  it("accepts the id with its slash encoded", async () => {
    const response = await request(
      `/v1/passages/${encodeURIComponent(PASSAGE_ID)}`,
      fakeItems(stored),
    );

    expect(await response.json()).toMatchObject({ data: { passageId: PASSAGE_ID } });
  });

  it("answers 404 without calling AI Search when D1 holds no such passage", async () => {
    const calls: ItemsCall[] = [];
    const response = await request(
      "/v1/passages/matriz-de-errores-cfdi-40/cfdi49999.md",
      fakeItems(stored, calls),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "passage_not_found" });
    expect(calls).toEqual([]);
  });

  it("answers 404 when AI Search holds no item for the key", async () => {
    const response = await request(`/v1/passages/${PASSAGE_ID}`, fakeItems([]));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "passage_not_found" });
  });

  it.each(["/v1/passages/cfdi40149", "/v1/passages/Matriz/CFDI40149.md", "/v1/passages/a/../b.md"])(
    "refuses %s",
    async (path) => {
      const response = await request(path, fakeItems(stored));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_request" });
    },
  );

  it("answers 502 when AI Search fails", async () => {
    const response = await request(
      `/v1/passages/${PASSAGE_ID}`,
      fakeItems(stored, [], new Error("upstream")),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "search_unavailable" });
  });
});

describe("GET /v1/sources", () => {
  it("lists every source by id", async () => {
    const response = await request("/v1/sources");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sources: [
          { id: "catalogos-cfdi-40", publishedAt: "2026-10-15", validFrom: "2026-10-15" },
          { id: "matriz-de-errores-cfdi-40", url: "http://omawww.sat.gob.mx/matriz.xls" },
        ],
      },
    });
  });

  it("returns one source", async () => {
    const response = await request("/v1/sources/catalogos-cfdi-40");

    expect(await response.json()).toMatchObject({
      data: { id: "catalogos-cfdi-40", title: "Catálogos", validUntil: null },
    });
  });

  it("answers 404 for an unknown source", async () => {
    const response = await request("/v1/sources/rmf-2026");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "source_not_found" });
  });
});

describe("GET /v1/errors/:code", () => {
  it("returns the matrix row with its source", async () => {
    const response = await request("/v1/errors/cfdi40149");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        code: "CFDI40149",
        node: "cfdi:Receptor",
        attribute: "DomicilioFiscalReceptor",
        message:
          "El campo DomicilioFiscalReceptor, no es igual al valor del campo LugarExpedicion.",
        source: { id: "matriz-de-errores-cfdi-40", validFrom: "2026-03-25", validUntil: null },
      },
    });
  });

  it("reads CFDI40223 as the SAT's CFDI140223", async () => {
    const response = await request("/v1/errors/CFDI40223");

    expect(await response.json()).toMatchObject({ data: { code: "CFDI140223" } });
  });

  it("answers 404 for an unknown code", async () => {
    const response = await request("/v1/errors/CFDI49999");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "error_code_not_found" });
  });
});

type CatalogBody = { data: { entries: { fields: Record<string, string> }[] } };

describe("GET /v1/catalogs/:name/:key", () => {
  it("finds an entry by catalog name with or without its prefix, in any case", async () => {
    for (const path of ["/v1/catalogs/c_UsoCFDI/S01", "/v1/catalogs/usocfdi/s01"]) {
      const response = await request(path);

      expect(await response.json()).toMatchObject({
        data: {
          catalog: "c_UsoCFDI",
          key: "S01",
          entries: [
            {
              fields: { c_UsoCFDI: "S01", Descripción: "Sin efectos fiscales." },
              validFrom: "2022-01-01",
              validUntil: null,
            },
          ],
          source: { id: "catalogos-cfdi-40" },
        },
      });
    }
  });

  it("returns every entry of a repeated key in the SAT's order", async () => {
    const response = await request("/v1/catalogs/c_TasaOCuota/0.160000");

    expect(await response.json()).toMatchObject({
      data: {
        entries: [
          { fields: { Traslado: "Sí" }, validUntil: null },
          { fields: { Retención: "Sí" }, validUntil: "2023-12-31" },
        ],
      },
    });
  });

  it("answers a large catalog's key in the SAT's format, leading zero kept", async () => {
    const response = await request("/v1/catalogs/c_CodigoPostal/01000");

    expect(await response.json()).toMatchObject({
      data: {
        catalog: "c_CodigoPostal",
        key: "01000",
        entries: [{ fields: { c_Estado: "CMX", c_Municipio: "010" }, validFrom: "2019-01-07" }],
      },
    });
    expect((await request("/v1/catalogs/c_CodigoPostal/1000")).status).toBe(404);
  });

  it("answers 404 for an unknown entry", async () => {
    const response = await request("/v1/catalogs/c_UsoCFDI/Z99");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "catalog_entry_not_found" });
  });

  it("narrows a repeated c_Colonia key to one postal code", async () => {
    const all = (await (await request("/v1/catalogs/c_Colonia/0001")).json()) as CatalogBody;
    expect(all.data.entries).toHaveLength(2);

    const response = await request("/v1/catalogs/c_Colonia/0001?c_CodigoPostal=01000");

    expect(response.status).toBe(200);
    const body = (await response.json()) as CatalogBody;
    expect(body.data.entries).toHaveLength(1);
    expect(body).toMatchObject({
      data: {
        catalog: "c_Colonia",
        key: "0001",
        entries: [
          {
            fields: {
              c_Colonia: "0001",
              c_CodigoPostal: "01000",
              "Nombre del asentamiento": "San Ángel",
            },
          },
        ],
        source: { id: "catalogos-cfdi-40" },
      },
    });
  });

  it("narrows a c_Municipio key by its state, in any case", async () => {
    const response = await request("/v1/catalogs/c_Municipio/001?c_Estado=bcn");

    const body = (await response.json()) as CatalogBody;
    expect(body).toMatchObject({ data: { entries: [{ fields: { Descripción: "Ensenada" } }] } });
    expect(body.data.entries).toHaveLength(1);
  });

  it("answers 404 when no entry of the key matches the filter", async () => {
    const response = await request("/v1/catalogs/c_Colonia/0001?c_CodigoPostal=99999");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "catalog_entry_not_found" });
  });

  it.each([
    [
      "/v1/catalogs/c_Colonia/0001?c_Estado=CMX",
      "`c_Estado` is not a column of this catalog entry; its columns are `Nombre del asentamiento`, `c_CodigoPostal`, `c_Colonia`.",
    ],
    [
      `/v1/catalogs/c_Colonia/0001?${encodeURIComponent('x") OR 1=1 --')}=1`,
      "is not a catalog column.",
    ],
    [
      "/v1/catalogs/c_Colonia/0001?c_CodigoPostal=01000&c_CodigoPostal=01010",
      "`c_CodigoPostal` must be given once.",
    ],
    ["/v1/catalogs/c_Colonia/0001?c_CodigoPostal=", "`c_CodigoPostal` must be a value"],
  ])("refuses %s", async (path, detail) => {
    const response = await request(path);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; detail: string };
    expect(body.code).toBe("invalid_request");
    expect(body.detail).toContain(detail);
  });
});

describe("GET /v1/catalogs/:name", () => {
  it("lists a whole catalog in the SAT's order", async () => {
    const response = await request("/v1/catalogs/tasaocuota");

    expect(await response.json()).toMatchObject({
      data: {
        catalog: "c_TasaOCuota",
        entries: [
          { key: "0.160000", fields: { Traslado: "Sí" }, validUntil: null },
          { key: "0.160000", fields: { Retención: "Sí" }, validUntil: "2023-12-31" },
        ],
        truncated: false,
        source: { id: "catalogos-cfdi-40", url: "http://omawww.sat.gob.mx/cat.xls" },
      },
    });
  });

  it("answers 404 for an unknown catalog", async () => {
    const response = await request("/v1/catalogs/c_Desconocido");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "catalog_not_found" });
  });
});

describe("CodiceKnowledge", () => {
  const knowledge = () =>
    new CodiceKnowledge(
      {} as ExecutionContext,
      { ...bindings, CODICE_SEARCH: fakeSearch([CHUNK]) } as never,
    );

  it("answers the /v1 handlers' data without the public rate limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => knowledge().lookupError("CFDI40149")),
    );

    for (const result of results) {
      expect(result).toMatchObject({
        ok: true,
        data: { code: "CFDI40149", passageId: PASSAGE_ID },
      });
    }
    expect(await knowledge().search({ q: "receptor", limit: 1 })).toMatchObject({
      ok: true,
      data: {
        results: [{ passageId: PASSAGE_ID, sourceUrl: "http://omawww.sat.gob.mx/matriz.xls" }],
      },
    });
  });

  it("returns a refusal as its problem", async () => {
    expect(await knowledge().lookupCatalog("c_UsoCFDI", "Z99")).toEqual({
      ok: false,
      problem: { status: 404, code: "catalog_entry_not_found", title: "Catalog entry not found" },
    });
    expect(await knowledge().readPassage("not a passage")).toMatchObject({
      ok: false,
      problem: { status: 400, code: "invalid_request" },
    });
  });
});

describe("/mcp", () => {
  const rpc = (body: unknown, search = fakeSearch([CHUNK])) =>
    app.request(
      "http://localhost/mcp",
      {
        method: "POST",
        headers: {
          host: "localhost",
          "cf-connecting-ip": clientAddress(),
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify(body),
      },
      { ...bindings, CODICE_SEARCH: search },
    );

  async function json(response: Response) {
    const text = await response.text();
    const data = text.startsWith("{") ? text : /^data: (.+)$/mu.exec(text)?.[1];
    return JSON.parse(data ?? "null") as Record<string, unknown>;
  }

  const call = (name: string, args: Record<string, unknown>, search?: AiSearchInstance) =>
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }, search);

  it("lists the read-only tools", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    };
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "search",
      "read_passage",
      "lookup_error",
      "lookup_catalog",
      "list_sources",
    ]);
    expect(body.result.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
  });

  it("reads a passage with the same handler as /v1/passages/:id", async () => {
    const calls: ItemsCall[] = [];
    const response = await call(
      "read_passage",
      { id: PASSAGE_ID },
      fakeItems([{ id: "item-1", key: PASSAGE_ID, body: PASSAGE_BODY }], calls),
    );

    // The tool answers over the stream, so read the body before the calls.
    expect(await json(response)).toMatchObject({
      result: {
        structuredContent: {
          passageId: PASSAGE_ID,
          text: PASSAGE_BODY,
          source: { id: "matriz-de-errores-cfdi-40" },
        },
      },
    });
    expect(calls[0]).toEqual(["list", { key: PASSAGE_ID, per_page: 1 }]);
  });

  it("looks up an error code and a catalog entry", async () => {
    expect(await json(await call("lookup_error", { code: "cfdi40149" }))).toMatchObject({
      result: { structuredContent: { code: "CFDI40149", node: "cfdi:Receptor" } },
    });
    expect(await json(await call("lookup_catalog", { name: "UsoCFDI", key: "s01" }))).toMatchObject(
      {
        result: { structuredContent: { catalog: "c_UsoCFDI", key: "S01" } },
      },
    );
  });

  it("narrows a catalog key with `where`, through the same handler", async () => {
    const response = await call("lookup_catalog", {
      name: "c_Colonia",
      key: "0001",
      where: { c_CodigoPostal: "01000" },
    });

    const body = (await json(response)) as {
      result: { structuredContent: { entries: { fields: Record<string, string> }[] } };
    };
    expect(
      body.result.structuredContent.entries.map((entry) => entry.fields.c_CodigoPostal),
    ).toEqual(["01000"]);
    expect(
      await json(
        await call("lookup_catalog", {
          name: "c_Colonia",
          key: "0001",
          where: { c_Estado: "CMX" },
        }),
      ),
    ).toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: "invalid_request", status: 400 } },
      },
    });
  });

  it("lists the sources", async () => {
    expect(await json(await call("list_sources", {}))).toMatchObject({
      result: {
        structuredContent: {
          sources: [{ id: "catalogos-cfdi-40" }, { id: "matriz-de-errores-cfdi-40" }],
        },
      },
    });
  });

  it("answers a refusal as a tool error with its code", async () => {
    expect(await json(await call("lookup_error", { code: "CFDI49999" }))).toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: "error_code_not_found", status: 404 } },
      },
    });
  });

  it("searches with the same handler as /v1/search", async () => {
    const calls: SearchCall[] = [];
    const response = await rpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "search", arguments: { q: "CFDI40149", asOf: "2026-06-01", limit: 2 } },
      },
      fakeSearch([CHUNK], calls),
    );

    expect(calls[0]?.ai_search_options?.retrieval).toMatchObject({
      filters: { valid_from: { $lte: 20260601 }, valid_until: { $gte: 20260601 } },
      max_num_results: 2,
      return_on_failure: false,
    });
    expect(await json(response)).toMatchObject({
      result: {
        structuredContent: {
          asOf: "2026-06-01",
          results: [{ passageId: "matriz-de-errores-cfdi-40/cfdi40149.md", quote: CHUNK.text }],
        },
      },
    });
  });
});
