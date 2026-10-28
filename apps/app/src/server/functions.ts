import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import { forgetLastUse } from "./api-key-store";
import { createAuth, socialProviders, type SocialProvider } from "./auth";
import { ROLES, type Role } from "./permissions";
import {
  readDashboard,
  readReceivedInvitations,
  readTeamKeys,
  readTeamPeople,
  teamSlug,
  type Dashboard,
  type KeyRow,
  type ReceivedInvitation,
  type TeamPeople,
} from "./teams";
import { readUsage, type UsageWeek } from "./usage";

/**
 * The dashboard's server functions. Each one acts as the signed-in user through Better Auth's
 * server API, with the request's cookies, so its own checks (session, team membership, each
 * role's permissions in `permissions.ts`) still apply.
 */
function auth() {
  return createAuth(env);
}

const role = (value: unknown): Role => {
  if (!ROLES.includes(value as Role)) throw new Error("Unknown role");
  return value as Role;
};

const teamName = (value: unknown) => {
  const name = String(value ?? "")
    .trim()
    .slice(0, 64);
  if (!name) throw new Error("A team needs a name");
  return name;
};

/** The signed-in user and their teams, or `null` without a valid session. */
export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<Dashboard | null> => readDashboard(env, getRequestHeaders()),
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

/** A new team, owned by the user and active at once. */
export const createTeam = createServerFn({ method: "POST" })
  .validator(teamName)
  .handler(async ({ data: name }) => {
    await auth().api.createOrganization({
      headers: getRequestHeaders(),
      body: { name, slug: teamSlug() },
    });
  });

export const renameTeam = createServerFn({ method: "POST" })
  .validator((input: { organizationId: string; name: string }) => ({
    organizationId: input.organizationId,
    name: teamName(input.name),
  }))
  .handler(async ({ data }) => {
    await auth().api.updateOrganization({
      headers: getRequestHeaders(),
      body: { organizationId: data.organizationId, data: { name: data.name } },
    });
  });

/** A team's members and its open invitations. */
export const getTeamPeople = createServerFn({ method: "GET" })
  .validator((organizationId: string) => organizationId)
  .handler(
    async ({ data: organizationId }): Promise<TeamPeople> =>
      readTeamPeople(env, getRequestHeaders(), organizationId),
  );

/** Emails the invitation (`sendInvitationEmail` in `auth.ts`). */
export const inviteMember = createServerFn({ method: "POST" })
  .validator((input: { organizationId: string; email: string; role: string }) => ({
    organizationId: input.organizationId,
    email: input.email.trim().toLowerCase(),
    role: role(input.role),
  }))
  .handler(async ({ data }) => {
    await auth().api.createInvitation({
      headers: getRequestHeaders(),
      body: { organizationId: data.organizationId, email: data.email, role: data.role },
    });
  });

export const cancelInvitation = createServerFn({ method: "POST" })
  .validator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    await auth().api.cancelInvitation({ headers: getRequestHeaders(), body: { invitationId } });
  });

export const changeMemberRole = createServerFn({ method: "POST" })
  .validator((input: { organizationId: string; memberId: string; role: string }) => ({
    organizationId: input.organizationId,
    memberId: input.memberId,
    role: role(input.role),
  }))
  .handler(async ({ data }) => {
    await auth().api.updateMemberRole({ headers: getRequestHeaders(), body: data });
  });

/** Their keys stay the team's, still attributed to them. */
export const removeMember = createServerFn({ method: "POST" })
  .validator((input: { organizationId: string; memberId: string }) => input)
  .handler(async ({ data }) => {
    await auth().api.removeMember({
      headers: getRequestHeaders(),
      body: { organizationId: data.organizationId, memberIdOrEmail: data.memberId },
    });
  });

export const leaveTeam = createServerFn({ method: "POST" })
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await auth().api.leaveOrganization({ headers: getRequestHeaders(), body: { organizationId } });
  });

/** The open invitations to the user's email. */
export const getReceivedInvitations = createServerFn({ method: "GET" }).handler(
  async (): Promise<ReceivedInvitation[]> => readReceivedInvitations(env, getRequestHeaders()),
);

/** An invitation to the user, or `null` if it is not theirs, not open or gone. */
export const getInvitation = createServerFn({ method: "GET" })
  .validator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    try {
      const invitation = await auth().api.getInvitation({
        headers: getRequestHeaders(),
        query: { id: invitationId },
      });
      return {
        id: invitation.id,
        team: invitation.organizationName,
        role: invitation.role,
        inviter: invitation.inviterEmail,
      };
    } catch {
      return null;
    }
  });

/** Joins the team and makes it the active one. */
export const acceptInvitation = createServerFn({ method: "POST" })
  .validator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    await auth().api.acceptInvitation({ headers: getRequestHeaders(), body: { invitationId } });
  });

export const rejectInvitation = createServerFn({ method: "POST" })
  .validator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    await auth().api.rejectInvitation({ headers: getRequestHeaders(), body: { invitationId } });
  });

/** The team's keys with who created each. */
export const listKeys = createServerFn({ method: "GET" })
  .validator((organizationId: string) => organizationId)
  .handler(
    async ({ data: organizationId }): Promise<KeyRow[]> =>
      readTeamKeys(env, getRequestHeaders(), organizationId),
  );

/** The full key is in this answer only; KV keeps its hash. It records its creator (`auth.ts`). */
export const createKey = createServerFn({ method: "POST" })
  .validator((input: { organizationId: string; name: string }) => input)
  .handler(async ({ data }) => {
    const created = await auth().api.createApiKey({
      headers: getRequestHeaders(),
      body: { organizationId: data.organizationId, name: data.name.trim() },
    });
    return { id: created.id, key: created.key };
  });

/** Owners and admins revoke any key; members, the ones they created. */
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
