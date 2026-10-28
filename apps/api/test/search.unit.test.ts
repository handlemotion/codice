import { describe, expect, it } from "vitest";

import { searchInput } from "../src/handlers";
import {
  parseAsOf,
  searchRequest,
  searchResults,
  todayInMexicoCity,
  validityFilter,
} from "../src/search";

describe("todayInMexicoCity", () => {
  it("reads the date in Mexico City, not UTC", () => {
    // 03:00 UTC on 25 October is still 24 October in Mexico City (UTC-6).
    expect(todayInMexicoCity(new Date("2026-10-25T03:00:00Z"))).toBe(20261024);
    expect(todayInMexicoCity(new Date("2026-10-25T07:00:00Z"))).toBe(20261025);
  });
});

describe("parseAsOf", () => {
  it("accepts a real calendar date only", () => {
    expect(parseAsOf("2026-02-28")).toBe(20260228);
    expect(parseAsOf("2026-02-30")).toBeNull();
    expect(parseAsOf("20260228")).toBeNull();
    expect(parseAsOf("2026-2-28")).toBeNull();
  });
});

describe("searchInput", () => {
  const now = new Date("2026-10-24T18:00:00Z");

  it("defaults asOf to today in Mexico City and limit to 5", () => {
    expect(searchInput({ q: "  CFDI40149 " }, now)).toEqual({
      q: "CFDI40149",
      asOf: 20261024,
      source: undefined,
      limit: 5,
    });
  });

  it.each([
    [{ q: "" }, "`q` is required."],
    [{ q: "x", asOf: "2026-13-01" }, "`asOf` must be a date as YYYY-MM-DD."],
    [{ q: "x", limit: "0" }, "`limit` must be a whole number from 1 to 50."],
    [{ q: "x", limit: "51" }, "`limit` must be a whole number from 1 to 50."],
    [{ q: "x", limit: "2.5" }, "`limit` must be a whole number from 1 to 50."],
    [{ q: "x", source: "../etc" }, "`../etc` is not a source id."],
  ])("refuses %j", (parameters, detail) => {
    expect(() => searchInput(parameters, now)).toThrow(expect.objectContaining({ detail }));
  });
});

describe("validityFilter", () => {
  /** AI Search's `$lte` and `$gte` on numeric metadata, applied to one item. */
  function matches(
    filter: ReturnType<typeof validityFilter>,
    metadata: { valid_from: number; valid_until: number },
  ) {
    return (
      metadata.valid_from <= filter.valid_from.$lte &&
      metadata.valid_until >= filter.valid_until.$gte
    );
  }

  // A rule replaced by a version in force from 2026-03-01: the old text ends the day before.
  const superseded = { key: "a/regla.20250101.md", valid_from: 20250101, valid_until: 20260228 };
  const current = { key: "a/regla.md", valid_from: 20260301, valid_until: 99991231 };
  const inForce = (asOf: number) =>
    [superseded, current].filter((item) => matches(validityFilter(asOf), item)).map((i) => i.key);

  it("answers the superseded text before the change and the new text from it", () => {
    expect(inForce(20250101)).toEqual(["a/regla.20250101.md"]);
    expect(inForce(20260228)).toEqual(["a/regla.20250101.md"]);
    expect(inForce(20260301)).toEqual(["a/regla.md"]);
    expect(inForce(20261024)).toEqual(["a/regla.md"]);
  });

  it("answers neither before the first version", () => {
    expect(inForce(20241231)).toEqual([]);
  });
});

describe("searchRequest", () => {
  it("filters on validity at asOf and keeps every reranked result", () => {
    expect(searchRequest({ q: "uso cfdi", asOf: 20261024, limit: 5 })).toEqual({
      messages: [{ role: "user", content: "uso cfdi" }],
      ai_search_options: {
        retrieval: {
          filters: { valid_from: { $lte: 20261024 }, valid_until: { $gte: 20261024 } },
          max_num_results: 5,
          return_on_failure: false,
        },
        reranking: { match_threshold: 0 },
      },
    });
  });

  it("can override the reranking threshold", () => {
    const request = searchRequest({ q: "x", asOf: 20261024, limit: 3, rerankingThreshold: 0.4 });
    expect(request.ai_search_options.reranking).toEqual({ match_threshold: 0.4 });
  });

  it("turns reranking and query rewriting on or off only when the eval asks", () => {
    const request = searchRequest({
      q: "x",
      asOf: 20261024,
      limit: 3,
      reranking: false,
      queryRewrite: false,
    });
    expect(request.ai_search_options.reranking).toEqual({ match_threshold: 0, enabled: false });
    expect(request.ai_search_options).toMatchObject({ query_rewrite: { enabled: false } });

    const worker = searchRequest({ q: "x", asOf: 20261024, limit: 3 });
    expect(worker.ai_search_options.reranking).toEqual({ match_threshold: 0 });
    expect(worker.ai_search_options).not.toHaveProperty("query_rewrite");
  });

  it("narrows to a source's folder and can override the keyword match mode", () => {
    const request = searchRequest({
      q: "x",
      asOf: 20261024,
      limit: 3,
      sources: ["matriz-de-errores-cfdi-40"],
      keywordMatchMode: "or",
    });
    expect(request.ai_search_options.retrieval).toEqual({
      filters: {
        valid_from: { $lte: 20261024 },
        valid_until: { $gte: 20261024 },
        folder: "matriz-de-errores-cfdi-40/",
      },
      max_num_results: 3,
      return_on_failure: false,
      keyword_match_mode: "or",
    });
  });

  it("narrows to several sources' folders with `$in`", () => {
    const request = searchRequest({
      q: "x",
      asOf: 20261024,
      limit: 3,
      sources: ["anexo-20-guia-de-llenado", "matriz-de-errores-cfdi-40"],
    });
    expect(request.ai_search_options.retrieval.filters).toEqual({
      valid_from: { $lte: 20261024 },
      valid_until: { $gte: 20261024 },
      folder: { $in: ["anexo-20-guia-de-llenado/", "matriz-de-errores-cfdi-40/"] },
    });
  });

  it("narrows to a passage kind", () => {
    const request = searchRequest({ q: "x", asOf: 20261024, limit: 3, kind: "guia" });
    expect(request.ai_search_options.retrieval.filters).toEqual({
      valid_from: { $lte: 20261024 },
      valid_until: { $gte: 20261024 },
      kind: "guia",
    });
  });
});

describe("searchResults", () => {
  it("maps a chunk to a quote with its passage id, validity and scores", () => {
    expect(
      searchResults([
        {
          id: "chunk-1",
          type: "text",
          score: 0.82,
          text: 'Validación: Si el valor del atributo Rfc del receptor es "XAXX010101000"…',
          item: {
            key: "matriz-de-errores-cfdi-40/cfdi40149.md",
            metadata: {
              authority: "SAT",
              kind: "anexo",
              valid_from: 20260325,
              valid_until: 99991231,
            },
          },
          scoring_details: { keyword_score: 0.5, vector_score: 0.7, reranking_score: 0.9 },
        },
        {
          id: "chunk-2",
          type: "text",
          score: 0.4,
          text: "Texto",
          item: {
            key: "rmf-2024/regla-1.md",
            metadata: { valid_from: 20240101, valid_until: 20241231 },
          },
        },
      ]),
    ).toEqual([
      {
        passageId: "matriz-de-errores-cfdi-40/cfdi40149.md",
        source: "matriz-de-errores-cfdi-40",
        quote: 'Validación: Si el valor del atributo Rfc del receptor es "XAXX010101000"…',
        authority: "SAT",
        kind: "anexo",
        validFrom: "2026-03-25",
        validUntil: null,
        score: 0.82,
        scoring: { keywordScore: 0.5, vectorScore: 0.7, rerankingScore: 0.9 },
      },
      {
        passageId: "rmf-2024/regla-1.md",
        source: "rmf-2024",
        quote: "Texto",
        authority: null,
        kind: null,
        validFrom: "2024-01-01",
        validUntil: "2024-12-31",
        score: 0.4,
        scoring: { keywordScore: null, vectorScore: null, rerankingScore: null },
      },
    ]);
  });
});
