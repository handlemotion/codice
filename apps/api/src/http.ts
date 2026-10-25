import type { Context } from "hono";

import { problemResponse, successEnvelope } from "@codice/contracts";

import type { CodiceEnv } from "./env";

const MAX_REQUEST_ID_LENGTH = 128;

/** The caller's `x-request-id` when it is usable, else a new one. */
export function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length <= MAX_REQUEST_ID_LENGTH ? supplied : crypto.randomUUID();
}

/** A success body in the repo envelope: `{ data, meta: { requestId } }`. */
export function apiJson<T>(context: Context<CodiceEnv>, data: T): Response {
  return context.json(successEnvelope(data, context.get("requestId")));
}

export function problem(
  requestId: string,
  status: number,
  code: string,
  title: string,
  detail?: string,
): Response {
  const response = problemResponse({
    type: "about:blank",
    title,
    status,
    code,
    requestId,
    ...(detail ? { detail } : {}),
  });
  response.headers.set("x-request-id", requestId);
  return response;
}
