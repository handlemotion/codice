/** The retrieval eval's questions (`eval-questions.json`), read by `eval.ts`. */

/** `kind` narrows the search to one passage kind, as a caller would for a definition question. */
export type Question = {
  readonly q: string;
  readonly expect: readonly string[];
  readonly kind?: string;
};

/**
 * The questions to ask: every one, or with `source` only those that expect a passage of a source
 * whose id starts with it (`complemento-carta-porte` for the four Carta Porte instructivos).
 */
export function questionsFor(questions: readonly Question[], source: string | undefined) {
  if (source === undefined) return questions;
  return questions.filter((question) =>
    question.expect.some((key) => key.split("/")[0]!.startsWith(source)),
  );
}
