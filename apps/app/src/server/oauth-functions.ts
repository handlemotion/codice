import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import {
  describeConsent,
  disconnectClient,
  listConnectedClients,
  type ConnectedClient,
  type ConsentRequest,
} from "./connected-clients";

/**
 * Server functions for MCP clients authorized by OAuth: the consent page's request, and the
 * signed-in user's connected clients for the dashboard. Each acts as the request's user.
 */

/** The consent page's authorization, from its query string; `null` if it is not signed. */
export const getConsentRequest = createServerFn({ method: "GET" })
  .validator((search: string) => search)
  .handler(
    async ({ data: search }): Promise<ConsentRequest | null> =>
      describeConsent(env, getRequestHeaders(), search),
  );

export const getConnectedClients = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConnectedClient[]> => listConnectedClients(env, getRequestHeaders()),
);

export const disconnectConnectedClient = createServerFn({ method: "POST" })
  .validator((clientId: string) => clientId)
  .handler(async ({ data: clientId }) => {
    await disconnectClient(env, getRequestHeaders(), clientId);
  });
