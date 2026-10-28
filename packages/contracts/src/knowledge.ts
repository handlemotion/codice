/**
 * Códice's internal service (`CodiceKnowledge` in `apps/api`), which Transitive's own Workers
 * call over a service binding. Each method answers what its `/v1` route's `data` holds
 * (`apps/api/SPEC.md`, "HTTP API"), or the problem the route would have sent.
 */

export type CodiceProblem = {
  readonly status: number;
  readonly code: string;
  readonly title: string;
};

export type CodiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly problem: CodiceProblem };

/** Where a passage or record comes from. Dates are ISO; `validUntil` is null while in force. */
export type CodiceSource = {
  readonly id: string;
  readonly title: string;
  readonly authority: string;
  readonly url: string;
  readonly sha256: string;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
};

export type CodiceSearchParameters = {
  readonly q?: string | undefined;
  /** `YYYY-MM-DD`; today in Mexico City when absent. */
  readonly asOf?: string | undefined;
  /** A source id, such as `anexo-20-guia-de-llenado`. */
  readonly source?: string | undefined;
  /** A passage kind, such as `guia` for the filling guides' definitions. */
  readonly kind?: string | undefined;
  readonly limit?: string | number | undefined;
};

export type CodiceSearchResult = {
  /** The passage's id, `<source>/<anchor>.md`, for `readPassage`. */
  readonly passageId: string;
  readonly source: string;
  /** The matched text, verbatim as indexed. */
  readonly quote: string;
  readonly authority: string | null;
  readonly kind: string | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly score: number;
  readonly scoring: {
    readonly keywordScore: number | null;
    readonly vectorScore: number | null;
    readonly rerankingScore: number | null;
  };
  readonly sourceTitle: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
};

export type CodiceSearch = {
  readonly query: string;
  readonly asOf: string;
  readonly source: string | null;
  readonly kind: string | null;
  readonly results: readonly CodiceSearchResult[];
};

export type CodicePassage = {
  readonly passageId: string;
  /** Its heading path, such as `Anexo 20 › Nodo: Receptor › UsoCFDI`. */
  readonly heading: string;
  /** The whole passage: its heading path, then the regulator's Markdown verbatim. */
  readonly text: string;
  readonly authority: string | null;
  readonly kind: string | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  /**
   * The passage ids its text links to, for `readPassage`: an RMF regla's referenced reglas, a
   * matrix row's guide passage, a guide passage's matrix rows.
   */
  readonly related: readonly string[];
  readonly source: CodiceSource | null;
};

/** A `CFDI40xxx` row of the SAT's error matrix. */
export type CodiceErrorCode = {
  readonly code: string;
  readonly sourceId: string;
  readonly node: string;
  readonly attribute: string;
  readonly validation: string;
  readonly message: string;
  /** The row's own search passage, for `readPassage`. */
  readonly passageId: string;
  /** The Anexo 20 passage that defines the row's attribute, when the guide has one. */
  readonly related: readonly string[];
  readonly source: CodiceSource | null;
};

export type CodiceCatalogFields = Readonly<Record<string, string | null>>;

export type CodiceCatalogEntry = {
  readonly catalog: string;
  readonly key: string;
  /** Usually one; c_TasaOCuota holds a key in several rows. */
  readonly entries: readonly {
    readonly fields: CodiceCatalogFields;
    readonly validFrom: string;
    readonly validUntil: string | null;
  }[];
  readonly source: CodiceSource | null;
};

/** A whole catalog in the SAT's order. */
export type CodiceCatalog = {
  readonly catalog: string;
  readonly entries: readonly {
    readonly key: string;
    readonly fields: CodiceCatalogFields;
    readonly validFrom: string;
    readonly validUntil: string | null;
  }[];
  /** True when the catalog holds more entries than one listing returns. */
  readonly truncated: boolean;
  readonly source: CodiceSource | null;
};

export interface CodiceKnowledgeService {
  search(parameters: CodiceSearchParameters): Promise<CodiceResult<CodiceSearch>>;
  readPassage(id: string): Promise<CodiceResult<CodicePassage>>;
  lookupError(code: string): Promise<CodiceResult<CodiceErrorCode>>;
  lookupCatalog(name: string, key: string): Promise<CodiceResult<CodiceCatalogEntry>>;
  listCatalog(name: string): Promise<CodiceResult<CodiceCatalog>>;
}
