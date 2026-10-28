import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  catalogEntries,
  errorCodes,
  passageLinks,
  passages,
  sources,
  sourceVersions,
} from "../src/db/schema";
import type { CodiceBindings } from "../src/env";
import { app, CodiceKnowledge } from "../src/index";
import { SOURCES_CACHE_MS } from "../src/records";

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

const STORED_PASSAGE_ID = "matriz-de-errores-cfdi-40/cfdi40158.md";
const STORED_PASSAGE_BODY = "# Matriz › cfdi:Receptor › UsoCFDI › CFDI40158\n\nCódigo: CFDI40158\n";

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

/**
 * Each request has its own key (test/accounts-stub.js), so the per-key rate limit (3 a minute in
 * tests) never trips.
 */
let keys = 0;
function apiKey() {
  keys += 1;
  return `Bearer cdc_test_routes${keys}`;
}

function request(path: string, search = fakeSearch([CHUNK]), headers: Record<string, string> = {}) {
  return app.request(
    `https://codice.test${path}`,
    { headers: { authorization: apiKey(), ...headers } },
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
  await db.insert(passages).values([
    // Written before D1 kept bodies: its text is only in AI Search.
    {
      key: PASSAGE_ID,
      sourceId: "matriz-de-errores-cfdi-40",
      heading: "Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149",
      sha256: "1".repeat(64),
      validFrom: 20260325,
    },
    {
      key: STORED_PASSAGE_ID,
      sourceId: "matriz-de-errores-cfdi-40",
      heading: "Matriz › cfdi:Receptor › UsoCFDI › CFDI40158",
      sha256: "5".repeat(64),
      body: STORED_PASSAGE_BODY,
      kind: "anexo",
      validFrom: 20260325,
    },
  ]);
  // Inserted in sheet order, as the ingestion does.
  await db.insert(catalogEntries).values([
    {
      catalog: "c_UsoCFDI",
      key: "S01",
      sourceId: "catalogos-cfdi-40",
      fields: { c_UsoCFDI: "S01", Descripción: "Sin efectos fiscales." },
      searchText: "s01\nsin efectos fiscales",
      validFrom: 20220101,
    },
    {
      catalog: "c_UsoCFDI",
      key: "D01",
      sourceId: "catalogos-cfdi-40",
      fields: {
        c_UsoCFDI: "D01",
        Descripción: "Honorarios médicos, dentales y gastos hospitalarios.",
      },
      searchText: "d01\nhonorarios medicos dentales y gastos hospitalarios",
      validFrom: 20220101,
    },
    {
      catalog: "c_UsoCFDI",
      key: "D10",
      sourceId: "catalogos-cfdi-40",
      fields: { c_UsoCFDI: "D10", Descripción: "Pagos por servicios educativos (colegiaturas)." },
      searchText: "d10\npagos por servicios educativos colegiaturas",
      validFrom: 20220101,
    },
    // A name the query is all of ranks before a shorter entry that repeats the word.
    {
      catalog: "c_ClaveUnidad",
      key: "M29",
      sourceId: "catalogos-cfdi-40",
      fields: { c_ClaveUnidad: "M29", Nombre: "Kilogramo por kilogramo" },
      searchText: "m29\nkilogramo por kilogramo",
      validFrom: 20220101,
    },
    {
      catalog: "c_ClaveUnidad",
      key: "KGM",
      sourceId: "catalogos-cfdi-40",
      fields: {
        c_ClaveUnidad: "KGM",
        Nombre: "Kilogramo",
        Descripción: "Una unidad de masa igual a mil gramos.",
      },
      searchText: "kgm\nkilogramo\nuna unidad de masa igual a mil gramos",
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
      searchText: "0001\nsan angel",
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
      searchText: "0001\nlos alpes",
      validFrom: 20220101,
    },
    {
      catalog: "c_Municipio",
      key: "001",
      sourceId: "catalogos-cfdi-40",
      fields: { c_Municipio: "001", c_Estado: "AGU", Descripción: "Aguascalientes" },
      searchText: "001\naguascalientes",
      validFrom: 20220101,
    },
    {
      catalog: "c_Municipio",
      key: "001",
      sourceId: "catalogos-cfdi-40",
      fields: { c_Municipio: "001", c_Estado: "BCN", Descripción: "Ensenada" },
      searchText: "001\nensenada",
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
    expect(response.headers.get("server-timing")).toMatch(
      /^total;dur=[\d.]+, cache;dur=[\d.]+, search;dur=[\d.]+$/u,
    );
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

  it("filters on several sources' folders with `$in`, in any order", async () => {
    const calls: SearchCall[] = [];
    const response = await request(
      "/v1/search?q=RFC%20gen%C3%A9rico&asOf=2026-06-01&source=matriz-de-errores-cfdi-40&source=anexo-20-guia-de-llenado&source=matriz-de-errores-cfdi-40",
      fakeSearch([CHUNK], calls),
    );

    expect(response.status).toBe(200);
    expect(calls[0]?.ai_search_options?.retrieval?.filters).toEqual({
      valid_from: { $lte: 20260601 },
      valid_until: { $gte: 20260601 },
      folder: { $in: ["anexo-20-guia-de-llenado/", "matriz-de-errores-cfdi-40/"] },
    });
    expect(await response.json()).toMatchObject({
      data: { source: ["anexo-20-guia-de-llenado", "matriz-de-errores-cfdi-40"] },
    });
  });

  it("echoes one source as a list", async () => {
    const response = await request(
      "/v1/search?q=uno&asOf=2026-06-01&source=rmf-2026",
      fakeSearch([CHUNK]),
    );

    expect(await response.json()).toMatchObject({ data: { source: ["rmf-2026"] } });
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
        format: "full",
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

  it("returns each result brief: its heading path and an excerpt cut from the quote", async () => {
    const response = await request("/v1/search?q=Rfc%20receptor&format=brief", undefined, {
      "x-request-id": "ray-brief",
    });

    const body = (await response.json()) as {
      data: { format: string; results: { excerpt: string }[] };
    };
    expect(body).toEqual({
      data: {
        query: "Rfc receptor",
        asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
        source: null,
        kind: null,
        format: "brief",
        results: [
          {
            passageId: PASSAGE_ID,
            heading: "Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149",
            excerpt: CHUNK.text,
            truncated: { before: false, after: false },
            kind: "anexo",
            validFrom: "2026-03-25",
            validUntil: null,
            score: 0.91,
          },
        ],
      },
      meta: { requestId: "ray-brief" },
    });
  });

  it.each([
    ["/v1/search", "`q` is required."],
    ["/v1/search?q=x&asOf=2026-02-30", "`asOf` must be a date as YYYY-MM-DD."],
    ["/v1/search?q=x&limit=100", "`limit` must be a whole number from 1 to 50."],
    ["/v1/search?q=x&kind=nota", "`kind` is one of ley, reglamento, regla, anexo, guia, criterio."],
    ["/v1/search?q=x&source=rmf-2026&source=RMF%202026", "`RMF 2026` is not a source id."],
    [
      `/v1/search?q=x&${Array.from({ length: 11 }, (_, index) => `source=s${index}`).join("&")}`,
      "`source` takes at most 10 source ids.",
    ],
    ["/v1/search?q=x&format=short", "`format` is one of full, brief."],
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

describe("search cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The same request id, so two answers compare byte for byte. */
  const cachedRequest = (path: string, search: AiSearchInstance) =>
    request(path, search, { "x-request-id": "cache-check" });

  it("answers a repeated search from the cache with exactly the same body", async () => {
    const calls: SearchCall[] = [];
    const path = "/v1/search?q=receptor%20cache&asOf=2026-06-01&limit=2";
    const first = await cachedRequest(path, fakeSearch([CHUNK], calls));
    // Another AI Search answer: a hit never reaches it.
    const second = await cachedRequest(
      "/v1/search?q=%20receptor%20cache%20&asOf=2026-06-01&limit=2",
      fakeSearch([{ ...CHUNK, text: "otro" }], calls),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(await first.text());
    expect(calls).toHaveLength(1);
    expect(second.headers.get("server-timing")).toMatch(/^total;dur=[\d.]+, cache;dur=[\d.]+$/u);
  });

  it("answers both formats from one entry: brief is cut after the cache", async () => {
    const calls: SearchCall[] = [];
    const path = "/v1/search?q=format%20cache&asOf=2026-06-01";
    const full = await cachedRequest(path, fakeSearch([CHUNK], calls));
    const brief = await cachedRequest(`${path}&format=brief`, fakeSearch([], calls));

    expect(await full.json()).toMatchObject({ data: { format: "full" } });
    expect(await brief.json()).toMatchObject({
      data: { format: "brief", results: [{ passageId: PASSAGE_ID, excerpt: CHUNK.text }] },
    });
    expect(calls).toHaveLength(1);
  });

  it("serves the same entry to the CodiceKnowledge entrypoint", async () => {
    const calls: SearchCall[] = [];
    await cachedRequest("/v1/search?q=rpc%20cache&asOf=2026-06-01", fakeSearch([CHUNK], calls));
    const knowledge = new CodiceKnowledge(
      {} as ExecutionContext,
      {
        ...bindings,
        CODICE_SEARCH: fakeSearch([], calls),
      } as never,
    );

    expect(await knowledge.search({ q: "rpc cache", asOf: "2026-06-01" })).toMatchObject({
      ok: true,
      data: { format: "full", results: [{ passageId: PASSAGE_ID, quote: CHUNK.text }] },
    });
    expect(
      await knowledge.search({ q: "rpc cache", asOf: "2026-06-01", format: "brief" }),
    ).toMatchObject({
      ok: true,
      data: { format: "brief", results: [{ passageId: PASSAGE_ID, excerpt: CHUNK.text }] },
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["asOf", "/v1/search?q=key%20cache&asOf=2026-06-02"],
    ["limit", "/v1/search?q=key%20cache&asOf=2026-06-01&limit=3"],
    ["source", "/v1/search?q=key%20cache&asOf=2026-06-01&source=matriz-de-errores-cfdi-40"],
    [
      "set of sources",
      "/v1/search?q=key%20cache&asOf=2026-06-01&source=matriz-de-errores-cfdi-40&source=rmf-2026",
    ],
    ["kind", "/v1/search?q=key%20cache&asOf=2026-06-01&kind=anexo"],
    ["question", "/v1/search?q=Key%20cache&asOf=2026-06-01"],
  ])("misses for another %s", async (_, path) => {
    await cachedRequest("/v1/search?q=key%20cache&asOf=2026-06-01", fakeSearch([CHUNK]));
    const calls: SearchCall[] = [];
    await cachedRequest(path, fakeSearch([CHUNK], calls));

    expect(calls).toHaveLength(1);
  });

  it("hits for the same sources asked in another order", async () => {
    const calls: SearchCall[] = [];
    await cachedRequest(
      "/v1/search?q=order%20cache&asOf=2026-06-01&source=rmf-2026&source=anexo-20-guia-de-llenado",
      fakeSearch([CHUNK], calls),
    );
    await cachedRequest(
      "/v1/search?q=order%20cache&asOf=2026-06-01&source=anexo-20-guia-de-llenado&source=rmf-2026",
      fakeSearch([CHUNK], calls),
    );

    expect(calls).toHaveLength(1);
  });

  it("does not keep a failed search", async () => {
    const failing = {
      search: async () => {
        throw new Error("upstream");
      },
    } as unknown as AiSearchInstance;
    const path = "/v1/search?q=failure%20cache&asOf=2026-06-01";

    expect((await cachedRequest(path, failing)).status).toBe(502);
    expect((await cachedRequest(path, fakeSearch([CHUNK]))).status).toBe(200);
  });

  it("misses once an ingestion changes the corpus and the isolate reads it again", async () => {
    const calls: SearchCall[] = [];
    const path = "/v1/search?q=corpus%20cache&asOf=2026-06-01";
    const before = await cachedRequest(path, fakeSearch([CHUNK], calls));
    await drizzle(bindings.CODICE_DATABASE!)
      .update(passages)
      .set({ sha256: "6".repeat(64) })
      .where(eq(passages.key, PASSAGE_ID));

    // Within SOURCES_CACHE_MS the isolate still holds the old version.
    await cachedRequest(path, fakeSearch([CHUNK], calls));
    expect(calls).toHaveLength(1);

    vi.useFakeTimers({ now: Date.now() + SOURCES_CACHE_MS, toFake: ["Date"] });
    const changed = { ...CHUNK, text: "Validación: texto nuevo." };
    const after = await cachedRequest(path, fakeSearch([changed], calls));

    expect(calls).toHaveLength(2);
    expect(await after.json()).toMatchObject({ data: { results: [{ quote: changed.text }] } });
    expect(await before.json()).toMatchObject({ data: { results: [{ quote: CHUNK.text }] } });
  });
});

describe("versions", () => {
  // The Anexo 20 guide changed on 2026-03-01: `nodo-receptor-usocfdi` was rewritten, and its old
  // text stays under its dated key until 2026-02-28 (SPEC.md, "Versions").
  const GUIDE = "anexo-20-guia-de-llenado";
  const CURRENT_ID = `${GUIDE}/nodo-receptor-usocfdi.md`;
  const OLD_ID = `${GUIDE}/nodo-receptor-usocfdi.20220101.md`;
  const OLD_URL = "http://omawww.sat.gob.mx/anexo20-2022.pdf";
  const NEW_URL = "http://omawww.sat.gob.mx/anexo20-2026.pdf";
  const metadata = (validFrom: number, validUntil: number) => ({
    authority: "SAT",
    kind: "guia",
    valid_from: validFrom,
    valid_until: validUntil,
  });
  const indexed = [
    { key: OLD_ID, text: "UsoCFDI: texto de 2022.", metadata: metadata(20220101, 20260228) },
    { key: CURRENT_ID, text: "UsoCFDI: texto de 2026.", metadata: metadata(20260301, 99991231) },
  ];

  /** Stands in AI Search's validity filter over the two indexed versions. */
  function filteringSearch() {
    return {
      search: async (search: SearchCall) => {
        const filters = search.ai_search_options?.retrieval?.filters as {
          valid_from: { $lte: number };
          valid_until: { $gte: number };
        };
        const chunks = indexed
          .filter(
            ({ metadata }) =>
              metadata.valid_from <= filters.valid_from.$lte &&
              metadata.valid_until >= filters.valid_until.$gte,
          )
          .map(({ key, text, metadata }) => ({
            ...CHUNK,
            text,
            item: { key, metadata },
          }));
        return { search_query: "", chunks };
      },
    } as unknown as AiSearchInstance;
  }

  beforeAll(async () => {
    const db = drizzle(bindings.CODICE_DATABASE!);
    await db.insert(sources).values({
      ...SOURCE,
      id: GUIDE,
      title: "Guía de llenado del Anexo 20 (2026)",
      url: NEW_URL,
      publishedAt: "2026-03-01",
      validFrom: 20260301,
    });
    await db.insert(sourceVersions).values({
      sourceId: GUIDE,
      title: "Guía de llenado del Anexo 20 (2022)",
      url: OLD_URL,
      sha256: "2".repeat(64),
      publishedAt: "2022-01-01",
      retrievedAt: new Date("2025-06-01T00:00:00.000Z"),
      validFrom: 20220101,
      validUntil: 20260228,
    });
    await db.insert(passages).values([
      {
        key: CURRENT_ID,
        sourceId: GUIDE,
        heading: "Anexo 20 › Nodo: Receptor › UsoCFDI",
        sha256: "3".repeat(64),
        validFrom: 20260301,
      },
      {
        key: OLD_ID,
        sourceId: GUIDE,
        heading: "Anexo 20 › Nodo: Receptor › UsoCFDI",
        sha256: "4".repeat(64),
        validFrom: 20220101,
        validUntil: 20260228,
      },
    ]);
  });

  it.each([
    ["2025-06-01", OLD_ID, "UsoCFDI: texto de 2022.", "2022-01-01", "2026-02-28", OLD_URL],
    ["2026-02-28", OLD_ID, "UsoCFDI: texto de 2022.", "2022-01-01", "2026-02-28", OLD_URL],
    ["2026-03-01", CURRENT_ID, "UsoCFDI: texto de 2026.", "2026-03-01", null, NEW_URL],
  ])(
    "on %s answers %s and cites the source version in force",
    async (asOf, passageId, quote, validFrom, validUntil, sourceUrl) => {
      const response = await request(`/v1/search?q=UsoCFDI&asOf=${asOf}`, filteringSearch());

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as { data: { results: unknown[] } };
      expect(data.results).toEqual([
        expect.objectContaining({
          passageId,
          source: GUIDE,
          quote,
          validFrom,
          validUntil,
          sourceUrl,
        }),
      ]);
    },
  );

  it("reads a superseded passage by its dated id with the version it came from", async () => {
    const response = await request(
      `/v1/passages/${OLD_ID}`,
      fakeItems([
        {
          id: "item-old",
          key: OLD_ID,
          body: "UsoCFDI: texto de 2022.",
          metadata: indexed[0]!.metadata,
        },
      ]),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        passageId: OLD_ID,
        text: "UsoCFDI: texto de 2022.",
        validFrom: "2022-01-01",
        validUntil: "2026-02-28",
        source: {
          id: GUIDE,
          title: "Guía de llenado del Anexo 20 (2022)",
          url: OLD_URL,
          sha256: "2".repeat(64),
          validFrom: "2022-01-01",
          validUntil: "2026-02-28",
        },
      },
    });
  });

  it("reads the current passage with the current version", async () => {
    const response = await request(
      `/v1/passages/${CURRENT_ID}`,
      fakeItems([
        {
          id: "item-new",
          key: CURRENT_ID,
          body: "UsoCFDI: texto de 2026.",
          metadata: indexed[1]!.metadata,
        },
      ]),
    );

    expect(await response.json()).toMatchObject({
      data: {
        validUntil: null,
        source: { url: NEW_URL, validFrom: "2026-03-01", validUntil: null },
      },
    });
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

  it("returns a passage D1 holds whole with its provenance, without calling AI Search", async () => {
    const calls: ItemsCall[] = [];
    const response = await request(`/v1/passages/${STORED_PASSAGE_ID}`, fakeItems([], calls), {
      "x-request-id": "ray-1",
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
    expect(await response.json()).toEqual({
      data: {
        passageId: STORED_PASSAGE_ID,
        heading: "Matriz › cfdi:Receptor › UsoCFDI › CFDI40158",
        text: STORED_PASSAGE_BODY,
        authority: "SAT",
        kind: "anexo",
        validFrom: "2026-03-25",
        validUntil: null,
        related: [],
        source: expect.objectContaining({
          id: "matriz-de-errores-cfdi-40",
          url: "http://omawww.sat.gob.mx/matriz.xls",
        }),
      },
      meta: { requestId: "ray-1" },
    });
  });

  it("reads a row recorded without its body from AI Search: lists the item by key, downloads it by id", async () => {
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
        related: [],
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
          { id: "anexo-20-guia-de-llenado", validFrom: "2026-03-01" },
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

describe("GET /v1/catalogs/:name?q=", () => {
  type SearchBody = { data: { entries: { key: string }[] } };
  const keys = async (path: string) =>
    ((await (await request(path)).json()) as SearchBody).data.entries.map((entry) => entry.key);

  it("finds entries by the words of their description, accents and case aside", async () => {
    const response = await request("/v1/catalogs/UsoCFDI?q=GASTOS%20MEDICOS");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        catalog: "c_UsoCFDI",
        query: "GASTOS MEDICOS",
        entries: [
          {
            key: "D01",
            fields: { Descripción: "Honorarios médicos, dentales y gastos hospitalarios." },
            validFrom: "2022-01-01",
            validUntil: null,
          },
        ],
        source: { id: "catalogos-cfdi-40", url: "http://omawww.sat.gob.mx/cat.xls" },
      },
    });
  });

  it("matches word prefixes and the key, and searches only the catalog asked for", async () => {
    expect(await keys("/v1/catalogs/c_UsoCFDI?q=colegiatura")).toEqual(["D10"]);
    expect(await keys("/v1/catalogs/c_UsoCFDI?q=d01")).toEqual(["D01"]);
    expect(await keys("/v1/catalogs/c_Municipio?q=san%20angel")).toEqual([]);
    expect(await keys("/v1/catalogs/c_Colonia?q=san%20angel")).toEqual(["0001"]);
  });

  it("ranks an entry whose name is the whole query first", async () => {
    expect(await keys("/v1/catalogs/c_ClaveUnidad?q=kilogramo")).toEqual(["KGM", "M29"]);
    expect(await keys("/v1/catalogs/c_ClaveUnidad?q=kilogramo&limit=1")).toEqual(["KGM"]);
  });

  it("falls back to any word when no entry holds them all", async () => {
    expect(await keys("/v1/catalogs/c_UsoCFDI?q=gastos%20funerarios")).toEqual(["D01"]);
  });

  it("answers an empty list when nothing matches, and FTS5 syntax as plain words", async () => {
    expect(await keys("/v1/catalogs/c_UsoCFDI?q=zzzz")).toEqual([]);
    expect(await keys(`/v1/catalogs/c_UsoCFDI?q=${encodeURIComponent('"sin" OR NEAR(*')}`)).toEqual(
      ["S01"],
    );
    // c_TasaOCuota has no description column, so nothing of it is indexed.
    expect(await keys("/v1/catalogs/c_TasaOCuota?q=iva")).toEqual([]);
  });

  it.each([
    ["/v1/catalogs/c_UsoCFDI?q=", "`q` is required."],
    ["/v1/catalogs/c_UsoCFDI?q=%3F%21", "`q` has no word to search for."],
    [`/v1/catalogs/c_UsoCFDI?q=${"a".repeat(201)}`, "longer than 200"],
    ["/v1/catalogs/c_UsoCFDI?q=gastos&limit=51", "`limit` must be a whole number from 1 to 50."],
  ])("refuses %s", async (path, detail) => {
    const response = await request(path);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { detail: string }).detail).toContain(detail);
  });

  it("answers 404 for an unknown catalog", async () => {
    const response = await request("/v1/catalogs/c_Desconocido?q=gastos");

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

  it("takes one source id or several", async () => {
    const calls: SearchCall[] = [];
    const service = new CodiceKnowledge(
      {} as ExecutionContext,
      { ...bindings, CODICE_SEARCH: fakeSearch([CHUNK], calls) } as never,
    );

    expect(
      await service.search({
        q: "rpc sources",
        asOf: "2026-06-01",
        source: ["rmf-2026", "matriz-de-errores-cfdi-40"],
      }),
    ).toMatchObject({ ok: true, data: { source: ["matriz-de-errores-cfdi-40", "rmf-2026"] } });
    expect(
      await service.search({ q: "rpc sources", asOf: "2026-06-01", source: "rmf-2026" }),
    ).toMatchObject({ ok: true, data: { source: ["rmf-2026"] } });
    expect(calls.map((call) => call.ai_search_options?.retrieval?.filters?.["folder"])).toEqual([
      { $in: ["matriz-de-errores-cfdi-40/", "rmf-2026/"] },
      "rmf-2026/",
    ]);
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
          authorization: apiKey(),
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
      "search_catalog",
      "list_sources",
      "list_changes",
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

  it("looks up several error codes in one call, in the order asked", async () => {
    expect(
      await json(await call("lookup_error", { codes: ["cfdi40149", "CFDI49999", "CFDI40149"] })),
    ).toMatchObject({
      result: {
        structuredContent: {
          results: [
            { code: "cfdi40149", data: { code: "CFDI40149", node: "cfdi:Receptor" } },
            {
              code: "CFDI49999",
              error: { code: "error_code_not_found", message: "Error code not found", status: 404 },
            },
            { code: "CFDI40149", data: { code: "CFDI40149", passageId: PASSAGE_ID } },
          ],
        },
      },
    });
  });

  it("searches a catalog by description through the same handler", async () => {
    expect(
      await json(await call("search_catalog", { name: "ClaveUnidad", q: "kilogramo", limit: 1 })),
    ).toMatchObject({
      result: {
        structuredContent: {
          catalog: "c_ClaveUnidad",
          query: "kilogramo",
          entries: [{ key: "KGM", fields: { Nombre: "Kilogramo" } }],
          source: { id: "catalogos-cfdi-40" },
        },
      },
    });
    expect(await json(await call("search_catalog", { name: "c_Nada", q: "x" }))).toMatchObject({
      result: { isError: true, structuredContent: { error: { code: "catalog_not_found" } } },
    });
  });

  it("looks up several catalog keys in one call, each with its own `where`", async () => {
    const response = await call("lookup_catalog", {
      lookups: [
        { name: "UsoCFDI", key: "s01" },
        { name: "c_Colonia", key: "0001", where: { c_CodigoPostal: "01000" } },
        { name: "c_UsoCFDI", key: "Z99" },
        { name: "c_Colonia", key: "0001", where: { c_Estado: "CMX" } },
      ],
    });

    const body = (await json(response)) as {
      result: {
        isError?: boolean;
        structuredContent: {
          results: (Record<string, unknown> & {
            data?: { entries: { fields: Record<string, string> }[] };
          })[];
        };
      };
    };
    expect(body.result.isError).toBeUndefined();
    const [usoCfdi, colonia, unknown, badColumn] = body.result.structuredContent.results;
    expect(usoCfdi).toMatchObject({ name: "UsoCFDI", key: "s01", data: { catalog: "c_UsoCFDI" } });
    expect(colonia?.["where"]).toEqual({ c_CodigoPostal: "01000" });
    expect(colonia?.data?.entries.map((entry) => entry.fields["c_CodigoPostal"])).toEqual([
      "01000",
    ]);
    expect(unknown).toMatchObject({
      key: "Z99",
      error: { code: "catalog_entry_not_found", status: 404 },
    });
    expect(badColumn).toMatchObject({ error: { code: "invalid_request", status: 400 } });
  });

  it.each([
    ["lookup_error", { codes: [] }],
    ["lookup_error", { codes: Array.from({ length: 26 }, () => "CFDI40149") }],
    ["lookup_error", { code: "CFDI40149" }],
    ["lookup_catalog", { lookups: [] }],
    ["lookup_catalog", { name: "c_UsoCFDI", key: "S01" }],
  ])("refuses %s with %j", async (name, args) => {
    expect(await json(await call(name, args))).toMatchObject({ result: { isError: true } });
  });

  it("lists the sources", async () => {
    expect(await json(await call("list_sources", {}))).toMatchObject({
      result: {
        structuredContent: {
          sources: [
            { id: "anexo-20-guia-de-llenado" },
            { id: "catalogos-cfdi-40" },
            { id: "matriz-de-errores-cfdi-40" },
          ],
        },
      },
    });
  });

  it("answers a refusal as a tool error with its code", async () => {
    expect(await json(await call("read_passage", { id: "not a passage" }))).toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: "invalid_request", status: 400 } },
      },
    });
  });

  it("searches with the same handler as /v1/search, brief by default", async () => {
    const calls: SearchCall[] = [];
    const response = await rpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "search",
          arguments: {
            q: "CFDI40149",
            asOf: "2026-06-01",
            limit: 2,
            source: ["matriz-de-errores-cfdi-40", "anexo-20-guia-de-llenado"],
          },
        },
      },
      fakeSearch([CHUNK], calls),
    );

    // The tool answers over the stream, so read the body before the calls.
    const body = (await json(response)) as {
      result: { structuredContent: { results: Record<string, unknown>[] } };
    };
    expect(body).toMatchObject({
      result: {
        structuredContent: {
          asOf: "2026-06-01",
          format: "brief",
          results: [
            {
              passageId: PASSAGE_ID,
              heading: "Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149",
              excerpt: CHUNK.text,
            },
          ],
        },
      },
    });
    expect(body.result.structuredContent.results[0]).not.toHaveProperty("quote");
    expect(calls[0]?.ai_search_options?.retrieval).toMatchObject({
      filters: {
        valid_from: { $lte: 20260601 },
        valid_until: { $gte: 20260601 },
        folder: { $in: ["anexo-20-guia-de-llenado/", "matriz-de-errores-cfdi-40/"] },
      },
      max_num_results: 2,
      return_on_failure: false,
    });
  });

  it("quotes the whole matched text with `format: full`", async () => {
    expect(
      await json(await call("search", { q: "CFDI40149", asOf: "2026-06-01", format: "full" })),
    ).toMatchObject({
      result: {
        structuredContent: {
          format: "full",
          results: [{ passageId: PASSAGE_ID, quote: CHUNK.text }],
        },
      },
    });
  });
});

describe("GET /v1/changes", () => {
  // A guide replaced on 2026-06-01: one node rewritten, one added, one dropped, one the same; and an
  // RMF that one amendment changed with no earlier text kept (the Primera RMRMF before Códice loaded
  // the RMF) and another changed after Códice had its text (SPEC.md, "Changes").
  const GUIDE = "pagos-prueba";
  const RMF = "rmf-prueba";
  const passage = (key: string, validFrom: number, validUntil?: number) => ({
    key,
    sourceId: key.split("/")[0]!,
    heading: `Encabezado de ${key}`,
    sha256: "6".repeat(64),
    body: `Texto de ${key}`,
    kind: key.startsWith(RMF) ? "regla" : "guia",
    validFrom,
    ...(validUntil === undefined ? {} : { validUntil }),
  });

  beforeAll(async () => {
    const db = drizzle(bindings.CODICE_DATABASE!);
    await db.insert(sources).values([
      {
        ...SOURCE,
        id: GUIDE,
        title: "Guía de llenado de Pagos (2026)",
        url: "http://omawww.sat.gob.mx/pagos-2026.pdf",
        publishedAt: "2026-06-01",
        validFrom: 20260601,
      },
      {
        ...SOURCE,
        id: RMF,
        title: "Resolución Miscelánea Fiscal (compilada)",
        url: "http://omawww.sat.gob.mx/rmf.pdf",
        // A compilation published after the reglas it holds start, as the real one is.
        publishedAt: "2026-07-16",
        validFrom: 20260716,
      },
    ]);
    await db.insert(sourceVersions).values({
      sourceId: GUIDE,
      title: "Guía de llenado de Pagos (2022)",
      url: "http://omawww.sat.gob.mx/pagos-2022.pdf",
      sha256: "7".repeat(64),
      publishedAt: "2022-01-01",
      retrievedAt: new Date("2025-06-01T00:00:00.000Z"),
      validFrom: 20220101,
      validUntil: 20260531,
    });
    await db
      .insert(passages)
      .values([
        passage(`${GUIDE}/nodo-pago.md`, 20220101),
        passage(`${GUIDE}/nodo-pago-monto.md`, 20260601),
        passage(`${GUIDE}/nodo-pago-monto.20220101.md`, 20220101, 20260531),
        passage(`${GUIDE}/nodo-pago-nuevo.md`, 20260601),
        passage(`${GUIDE}/nodo-pago-retirado.20220101.md`, 20220101, 20260531),
        passage(`${RMF}/regla-2.1.1.md`, 20251228),
        passage(`${RMF}/regla-2.7.1.50.md`, 20260709),
        passage(`${RMF}/regla-3.1.1.md`, 20261001),
        passage(`${RMF}/regla-3.1.1.20251228.md`, 20251228, 20260930),
      ]);
  });

  const GUIDE_CHANGES = [
    {
      change: "added",
      date: "2026-06-01",
      passageId: `${GUIDE}/nodo-pago-nuevo.md`,
      previousPassageId: null,
      source: GUIDE,
      heading: `Encabezado de ${GUIDE}/nodo-pago-nuevo.md`,
      kind: "guia",
      validFrom: "2026-06-01",
      validUntil: null,
    },
    {
      change: "changed",
      date: "2026-06-01",
      passageId: `${GUIDE}/nodo-pago-monto.md`,
      previousPassageId: `${GUIDE}/nodo-pago-monto.20220101.md`,
      source: GUIDE,
      heading: `Encabezado de ${GUIDE}/nodo-pago-monto.md`,
      kind: "guia",
      validFrom: "2026-06-01",
      validUntil: null,
    },
    {
      change: "removed",
      date: "2026-06-01",
      passageId: `${GUIDE}/nodo-pago-retirado.20220101.md`,
      previousPassageId: null,
      source: GUIDE,
      heading: `Encabezado de ${GUIDE}/nodo-pago-retirado.20220101.md`,
      kind: "guia",
      validFrom: "2022-01-01",
      validUntil: "2026-05-31",
    },
  ].sort((a, b) => a.passageId.localeCompare(b.passageId));

  async function changes(query: string) {
    const response = await request(`/v1/changes?${query}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: { changes: unknown[] } }).data;
  }

  it("lists a new version's added, changed and removed passages, from validity alone", async () => {
    expect(await changes(`since=2026-01-01&source=${GUIDE}`)).toEqual({
      since: "2026-01-01",
      until: null,
      source: GUIDE,
      changes: GUIDE_CHANGES,
    });
  });

  it("does not report the first version Códice holds of a source as a change", async () => {
    const data = await changes(`since=2020-01-01&until=2026-06-01&source=${GUIDE}`);
    expect(data.changes).toEqual(GUIDE_CHANGES);
  });

  it("includes both ends of the window", async () => {
    expect((await changes(`since=2026-06-01&until=2026-06-01&source=${GUIDE}`)).changes).toEqual(
      GUIDE_CHANGES,
    );
    expect((await changes(`since=2026-06-02&source=${GUIDE}`)).changes).toEqual([]);
    expect((await changes(`since=2026-01-01&until=2026-05-31&source=${GUIDE}`)).changes).toEqual(
      [],
    );
  });

  it("reports an amendment Códice holds no earlier text of as a change with no previous version", async () => {
    expect((await changes(`since=2026-07-01&source=${RMF}`)).changes).toEqual([
      expect.objectContaining({
        change: "changed",
        date: "2026-07-09",
        passageId: `${RMF}/regla-2.7.1.50.md`,
        previousPassageId: null,
        kind: "regla",
        validFrom: "2026-07-09",
        validUntil: null,
      }),
      expect.objectContaining({
        change: "changed",
        date: "2026-10-01",
        passageId: `${RMF}/regla-3.1.1.md`,
        previousPassageId: `${RMF}/regla-3.1.1.20251228.md`,
      }),
    ]);
    expect((await changes(`since=2026-07-01&until=2026-09-30&source=${RMF}`)).changes).toHaveLength(
      1,
    );
  });

  it("reads the previous version of a change by its dated id", async () => {
    const [change] = (await changes(`since=2026-10-01&source=${RMF}`)).changes as {
      previousPassageId: string;
    }[];
    const response = await request(`/v1/passages/${change!.previousPassageId}`);

    expect(await response.json()).toMatchObject({
      data: {
        text: `Texto de ${RMF}/regla-3.1.1.20251228.md`,
        validFrom: "2025-12-28",
        validUntil: "2026-09-30",
      },
    });
  });

  it.each([
    ["", "`since` is required"],
    ["since=2026-02-30", "`since` is required"],
    ["since=2026-07-01&until=2026-13-01", "`until` must be a date"],
    ["since=2026-07-01&until=2026-06-30", "`until` must not precede `since`"],
    ["since=2026-07-01&source=RMF%202026", "`source` is not a source id"],
  ])("refuses `%s` as 400 invalid_request", async (query, detail) => {
    const response = await request(`/v1/changes?${query}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "invalid_request",
      detail: expect.stringContaining(detail),
    });
  });

  it("answers the MCP tool `list_changes` with the same handler", async () => {
    const response = await app.request(
      "http://localhost/mcp",
      {
        method: "POST",
        headers: {
          host: "localhost",
          authorization: apiKey(),
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_changes", arguments: { since: "2026-01-01", source: GUIDE } },
        }),
      },
      bindings,
    );
    const text = await response.text();

    expect(JSON.parse(/^data: (.+)$/mu.exec(text)?.[1] ?? text)).toMatchObject({
      result: { structuredContent: { since: "2026-01-01", changes: GUIDE_CHANGES } },
    });
  });
});

describe("related passages", () => {
  const RMF = "rmf-2026";
  const regla = (number: string) => `${RMF}/regla-${number}.md`;
  const GUIDE_ID = "anexo-20-guia-de-llenado/nodo-receptor-usocfdi.md";

  beforeAll(async () => {
    const db = drizzle(bindings.CODICE_DATABASE!);
    await db.insert(sources).values({
      ...SOURCE,
      id: RMF,
      title: "Resolución Miscelánea Fiscal para 2026",
      url: "http://omawww.sat.gob.mx/rmf.pdf",
      publishedAt: "2025-12-28",
      validFrom: 20251228,
    });
    await db.insert(passages).values(
      ["2.7.2.11", "2.7.2.1", "2.7.2.10"].map((number) => ({
        key: regla(number),
        sourceId: RMF,
        heading: `RMF › Regla ${number}.`,
        sha256: "6".repeat(64),
        body: `# RMF › Regla ${number}.\n\nCFF 29, RMF 2.7.2.10., 2.7.2.1.\n`,
        kind: "regla",
        validFrom: 20251228,
      })),
    );
    // Numbered in the references line's order, which is not the keys' order.
    await db.insert(passageLinks).values([
      { passageKey: regla("2.7.2.11"), relatedKey: regla("2.7.2.1"), position: 1 },
      { passageKey: regla("2.7.2.11"), relatedKey: regla("2.7.2.10"), position: 0 },
      { passageKey: PASSAGE_ID, relatedKey: GUIDE_ID, position: 0 },
      { passageKey: GUIDE_ID, relatedKey: PASSAGE_ID, position: 0 },
    ]);
  });

  it("answers a passage's related passage ids in its text's order, from D1", async () => {
    const calls: ItemsCall[] = [];
    const response = await request(`/v1/passages/${regla("2.7.2.11")}`, fakeItems([], calls));

    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
    expect(await response.json()).toMatchObject({
      data: {
        passageId: regla("2.7.2.11"),
        kind: "regla",
        related: [regla("2.7.2.10"), regla("2.7.2.1")],
        source: { id: RMF },
      },
    });
  });

  it("answers an empty list for a passage without links", async () => {
    const response = await request(`/v1/passages/${regla("2.7.2.1")}`);

    expect(await response.json()).toMatchObject({ data: { related: [] } });
  });

  it("links an error code to its guide passage, and the guide passage back", async () => {
    expect(await (await request("/v1/errors/CFDI40149")).json()).toMatchObject({
      data: { code: "CFDI40149", passageId: PASSAGE_ID, related: [GUIDE_ID] },
    });
    // Recorded before D1 kept bodies (see "versions"): its text comes from AI Search.
    const guide = fakeItems([{ id: "item-guide", key: GUIDE_ID, body: "# UsoCFDI\n" }]);
    expect(await (await request(`/v1/passages/${GUIDE_ID}`, guide)).json()).toMatchObject({
      data: { passageId: GUIDE_ID, related: [PASSAGE_ID] },
    });
    expect(await (await request("/v1/errors/CFDI140223")).json()).toMatchObject({
      data: { code: "CFDI140223", related: [] },
    });
  });

  it("answers the same field through the CodiceKnowledge entrypoint", async () => {
    const knowledge = new CodiceKnowledge({} as ExecutionContext, bindings as never);

    expect(await knowledge.readPassage(regla("2.7.2.11"))).toMatchObject({
      ok: true,
      data: { related: [regla("2.7.2.10"), regla("2.7.2.1")] },
    });
    expect(await knowledge.lookupError("CFDI40149")).toMatchObject({
      ok: true,
      data: { related: [GUIDE_ID] },
    });
  });
});
