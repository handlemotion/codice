import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import { forgetLastUse, lastUsed } from "./api-key-store";
import { createAuth } from "./auth";

/**
 * The dashboard's server functions. Each one acts as the signed-in user through Better Auth's
 * server API, with the request's cookies, so its own checks (session, team membership, the
 * owner's key permissions) still apply.
 */
function auth() {
  return createAuth(env);
}

export interface Team {
  id: string;
  name: string;
}

export interface Dashboard {
  user: { name: string; email: string };
  team: Team | null;
  teams: Team[];
}

/** The signed-in user and their teams, or `null` without a valid session. */
export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<Dashboard | null> => {
    const headers = getRequestHeaders();
    const { api } = auth();
    const session = await api.getSession({ headers });
    if (!session) return null;
    const organizations = await api.listOrganizations({ headers });
    const teams = organizations.map(({ id, name }) => ({ id, name }));
    const activeId = session.session.activeOrganizationId;
    return {
      user: { name: session.user.name, email: session.user.email },
      team: teams.find((team) => team.id === activeId) ?? teams[0] ?? null,
      teams,
    };
  },
);

export const setActiveTeam = createServerFn({ method: "POST" })
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await auth().api.setActiveOrganization({
      headers: getRequestHeaders(),
      body: { organizationId },
    });
  });

export interface KeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export const listKeys = createServerFn({ method: "GET" })
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }): Promise<KeyRow[]> => {
    const { apiKeys } = await auth().api.listApiKeys({
      headers: getRequestHeaders(),
      query: { organizationId, sortBy: "createdAt", sortDirection: "desc" },
    });
    const used = await lastUsed(
      env.API_KEYS,
      apiKeys.map((key) => key.id),
    );
    return apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      start: key.start,
      createdAt: new Date(key.createdAt).toISOString(),
      lastUsedAt: used[key.id] ?? null,
    }));
  });

/** The full key is in this answer only; KV keeps its hash. */
export const createKey = createServerFn({ method: "POST" })
  .validator((input: { organizationId: string; name: string }) => input)
  .handler(async ({ data }) => {
    const created = await auth().api.createApiKey({
      headers: getRequestHeaders(),
      body: { organizationId: data.organizationId, name: data.name.trim() },
    });
    return { id: created.id, key: created.key };
  });

export const revokeKey = createServerFn({ method: "POST" })
  .validator((keyId: string) => keyId)
  .handler(async ({ data: keyId }) => {
    await auth().api.deleteApiKey({ headers: getRequestHeaders(), body: { keyId } });
    await forgetLastUse(env.API_KEYS, keyId);
  });
