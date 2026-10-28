import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import { forgetLastUse, lastUsed } from "./api-key-store";
import { createAuth, socialProviders, type SocialProvider } from "./auth";
import { readUsage, type UsageWeek } from "./usage";

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
  user: { name: string; email: string; image: string | null };
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
      user: {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
      team: teams.find((team) => team.id === activeId) ?? teams[0] ?? null,
      teams,
    };
  },
);

/** The social sign-ins the login page offers: those whose OAuth app is configured. */
export const getSignInProviders = createServerFn({ method: "GET" }).handler(
  async (): Promise<SocialProvider[]> => Object.keys(socialProviders(env)) as SocialProvider[],
);

export const setActiveTeam = createServerFn({ method: "POST" })
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await auth().api.setActiveOrganization({
      headers: getRequestHeaders(),
      body: { organizationId },
    });
  });

export const renameUser = createServerFn({ method: "POST" })
  .validator((name: string) => name.trim().slice(0, 64))
  .handler(async ({ data: name }) => {
    await auth().api.updateUser({ headers: getRequestHeaders(), body: { name } });
  });

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** The members of a team the user belongs to. */
export const listMembers = createServerFn({ method: "GET" })
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }): Promise<MemberRow[]> => {
    const { members } = await auth().api.listMembers({
      headers: getRequestHeaders(),
      query: { organizationId },
    });
    return members.map((member) => ({
      id: member.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
    }));
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

/** A week of the team's and the user's usage, ending on `end` (by default, today). */
export const getUsage = createServerFn({ method: "GET" })
  .validator((input: { organizationId: string; end?: string }) => ({
    organizationId: input.organizationId,
    end: input.end && /^\d{4}-\d{2}-\d{2}$/u.test(input.end) ? input.end : undefined,
  }))
  .handler(async ({ data }): Promise<UsageWeek> => readUsage(env, getRequestHeaders(), data));
