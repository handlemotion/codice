import { describe, expect, it } from "vitest";

import { searchFormat, searchInput } from "../src/handlers";
import {
  aboveRerankingFloor,
  briefResult,
  excerpt,
  EXCERPT_LENGTH,
  excerptTerms,
  parseAsOf,
  RERANKING_RELATIVE_FLOOR,
  type SearchResult,
  searchRequest,
  searchResults,
  todayInMexicoCity,
  validityFilter,
} from "../src/search";
import { searchCacheKey } from "../src/search-cache";

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

describe("aboveRerankingFloor", () => {
  function result(passageId: string, rerankingScore: number | null): SearchResult {
    return {
      passageId,
      source: passageId.split("/")[0] ?? "",
      quote: "…",
      authority: "SAT",
      kind: null,
      validFrom: "2026-01-01",
      validUntil: null,
      score: 0.5,
      scoring: { keywordScore: null, vectorScore: 0.5, rerankingScore },
    };
  }
  const ids = (results: readonly SearchResult[]) => results.map((r) => r.passageId);

  it("drops the results scored under the floor's fraction of the first", () => {
    // "¿Cómo hago una nota de crédito que aplique a varias facturas?", 2026-10-28.
    const results = [
      result("complemento-pagos-guia-de-llenado/apendice-6-pregunta-2.md", 0.4027),
      result("rmf-2026/regla-9.1.19.md", 0.0054),
      result("rmf-2026/regla-9.2.9.md", 0.0033),
    ];
    expect(ids(aboveRerankingFloor(results))).toEqual([
      "complemento-pagos-guia-de-llenado/apendice-6-pregunta-2.md",
    ]);
  });

  it("keeps a correct answer the reranker doubts, at 3% of the first", () => {
    // "¿Qué tipo de factura hago para una nota de crédito?": pregunta 21 is an expected answer.
    const results = [
      result("anexo-20-guia-de-llenado/apendice-2.md", 0.2468),
      result("anexo-20-guia-de-llenado/apendice-7-pregunta-21.md", 0.0075),
      result("anexo-20-guia-de-llenado/nodo-traslado-tipofactor.md", 0.0038),
    ];
    expect(ids(aboveRerankingFloor(results))).toEqual([
      "anexo-20-guia-de-llenado/apendice-2.md",
      "anexo-20-guia-de-llenado/apendice-7-pregunta-21.md",
    ]);
  });

  it("keeps a result exactly at the floor", () => {
    const results = [result("a/top.md", 0.5), result("a/edge.md", 0.5 * RERANKING_RELATIVE_FLOOR)];
    expect(ids(aboveRerankingFloor(results))).toEqual(["a/top.md", "a/edge.md"]);
  });

  it("never drops the first result, however low it scores", () => {
    expect(ids(aboveRerankingFloor([result("a/only.md", 0.0001)]))).toEqual(["a/only.md"]);
    expect(aboveRerankingFloor([])).toEqual([]);
  });

  it("keeps every result when the first has no positive reranking score", () => {
    const unranked = [result("a/one.md", null), result("a/two.md", 0.001)];
    expect(ids(aboveRerankingFloor(unranked))).toEqual(["a/one.md", "a/two.md"]);
    const zero = [result("a/one.md", 0), result("a/two.md", 0)];
    expect(ids(aboveRerankingFloor(zero))).toEqual(["a/one.md", "a/two.md"]);
  });

  it("keeps a later result without a reranking score", () => {
    const results = [result("a/top.md", 0.9), result("a/unscored.md", null)];
    expect(ids(aboveRerankingFloor(results))).toEqual(["a/top.md", "a/unscored.md"]);
  });
});

describe("searchFormat", () => {
  it("defaults to full and accepts brief", () => {
    expect(searchFormat(undefined)).toBe("full");
    expect(searchFormat("")).toBe("full");
    expect(searchFormat("brief")).toBe("brief");
  });

  it("refuses another format", () => {
    expect(() => searchFormat("short")).toThrow(
      expect.objectContaining({ status: 400, detail: "`format` is one of full, brief." }),
    );
  });
});

describe("excerptTerms", () => {
  it("folds case and accents and drops short and common words", () => {
    expect(excerptTerms("¿Qué UsoCFDI lleva el comprobante de gastos médicos?")).toEqual([
      "usocfdi",
      "lleva",
      "comprobante",
      "gastos",
      "medicos",
    ]);
  });
});

describe("excerpt", () => {
  // A long passage whose match sits far from its start, as an RMF regla's often does.
  const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(12);
  const rule =
    "Para los efectos del artículo 29-A, el contribuyente que reciba un CFDI con el atributo RFC genérico XAXX010101000 deberá registrar el código postal del lugar de expedición.";
  const text = `${filler}${rule} ${filler}`;

  it("cuts an exact substring around the question's words, at whole words", () => {
    const { excerpt: cut, truncated } = excerpt(
      text,
      "código postal del receptor con RFC genérico",
    );

    expect(text).toContain(cut);
    expect(cut.length).toBeLessThanOrEqual(EXCERPT_LENGTH);
    // From the start of the rule's sentence, the nearest before its first matching word.
    expect(cut.startsWith("Para los efectos del artículo 29-A")).toBe(true);
    expect(cut).toContain("RFC genérico XAXX010101000");
    expect(cut).toContain("código postal");
    expect(truncated).toEqual({ before: true, after: true });
    // Whole words: the characters beside the cut are whitespace.
    const start = text.indexOf(cut);
    expect(text[start - 1]).toMatch(/\s/u);
    expect(text[start + cut.length]).toMatch(/\s/u);
  });

  it("starts a little before the match, at a whole word, when no sentence starts near it", () => {
    const run = `${"palabra ".repeat(60)}CFDI40149 ${"palabra ".repeat(60)}`;
    const { excerpt: cut, truncated } = excerpt(run, "CFDI40149");
    const start = run.indexOf(cut);

    expect(run[start - 1]).toBe(" ");
    expect(cut.startsWith("palabra")).toBe(true);
    expect(cut.indexOf("CFDI40149")).toBeGreaterThan(40);
    expect(cut.indexOf("CFDI40149")).toBeLessThanOrEqual(60);
    expect(truncated).toEqual({ before: true, after: true });
  });

  it("matches a code without regard to case", () => {
    const { excerpt: cut } = excerpt(text, "xaxx010101000");

    expect(cut).toContain("XAXX010101000");
  });

  it("keeps the start when no word of the question appears (a match by meaning)", () => {
    const { excerpt: cut, truncated } = excerpt(text, "¿cuándo se cancela una factura?");

    expect(text.startsWith(cut)).toBe(true);
    expect(truncated).toEqual({ before: false, after: true });
  });

  it("returns a short text whole, untruncated", () => {
    expect(excerpt("Código: CFDI40149\n", "CFDI40149")).toEqual({
      excerpt: "Código: CFDI40149",
      truncated: { before: false, after: false },
    });
  });

  it("prefers the window holding the most distinct words", () => {
    const scattered = `UsoCFDI aparece sola. ${filler}El atributo UsoCFDI del receptor con régimen 616. ${filler}`;
    const { excerpt: cut } = excerpt(scattered, "UsoCFDI receptor régimen");

    expect(cut).toContain("UsoCFDI del receptor con régimen 616.");
  });
});

describe("briefResult", () => {
  it("drops the heading line from the excerpt and gives the heading path apart", () => {
    const [result] = searchResults([
      {
        id: "chunk-1",
        type: "text",
        score: 0.8,
        text: "# Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149\n\nCódigo: CFDI40149\n",
        item: {
          key: "matriz-de-errores-cfdi-40/cfdi40149.md",
          metadata: {
            authority: "SAT",
            kind: "anexo",
            valid_from: 20260325,
            valid_until: 99991231,
          },
        },
      },
    ]);

    expect(
      briefResult(
        result!,
        "CFDI40149",
        "Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149",
      ),
    ).toEqual({
      passageId: "matriz-de-errores-cfdi-40/cfdi40149.md",
      heading: "Matriz › cfdi:Receptor › DomicilioFiscalReceptor › CFDI40149",
      excerpt: "Código: CFDI40149",
      truncated: { before: false, after: false },
      kind: "anexo",
      validFrom: "2026-03-25",
      validUntil: null,
      score: 0.8,
    });
  });
});

describe("searchCacheKey", () => {
  it("keeps an unreranked search apart from a reranked one", () => {
    const input = { q: "uso cfdi", asOf: 20261028, limit: 5 };
    const reranked = searchCacheKey(input, "v1");

    expect(searchCacheKey({ ...input, reranking: true }, "v1")).toBe(reranked);
    expect(searchCacheKey({ ...input, reranking: false }, "v1")).not.toBe(reranked);
  });
});
