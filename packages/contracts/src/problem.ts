/**
 * The HTTP envelopes Códice shares with Transitive's API contracts: an RFC 9457 problem body and
 * the `{ data, meta }` success body. Kept identical to `@transitive/api-contracts` so a client
 * reads both the same way.
 */

export const PROBLEM_JSON = "application/problem+json";

export type ApiProblem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string | undefined;
  readonly instance?: string | undefined;
  readonly code: string;
  readonly requestId: string;
};

export type ApiSuccessEnvelope<T = unknown> = {
  readonly data: T;
  readonly meta: { readonly requestId: string };
};

export function successEnvelope<T>(data: T, requestId: string): ApiSuccessEnvelope<T> {
  return { data, meta: { requestId } };
}

export function problemResponse(problem: ApiProblem): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "content-type": PROBLEM_JSON,
      "cache-control": "no-store",
    },
  });
}
