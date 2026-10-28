import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "../db/schema";
import { displayName } from "../people";
import { lastUsed } from "./api-key-store";
import { createAuth, type ApiKeyMetadata, type AuthBindings } from "./auth";
import { managesTeam } from "./permissions";

/**
 * Teams as the dashboard shows them: the user's teams with their role in each, a team's members
 * and open invitations, and its keys with who created them. Each call acts as the request's user
 * through Better Auth's server API, so the organization plugin's own checks apply; D1 is read
 * directly only for what the plugin does not answer (roles across teams, key creators' names).
 */

export interface Team {
  id: string;
  name: string;
  /** The user's role in it: `owner`, `admin` or `member`. */
  role: string;
  /** Owners and admins manage its name, people and every key. */
  manages: boolean;
  /** The team every user gets on sign-up. */
  personal: boolean;
}

export interface Dashboard {
  user: { id: string; name: string; email: string; image: string | null };
  team: Team | null;
  teams: Team[];
  /** Invitations to other teams waiting for the user. */
  invitations: number;
}

/** A personal team's slug (`auth.ts`, the user `create` hook). */
export const PERSONAL_SLUG_PREFIX = "personal-";

/** The signed-in user, their teams and the active one; `null` without a valid session. */
export async function readDashboard(
  env: AuthBindings,
  headers: Headers,
): Promise<Dashboard | null> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const db = drizzle(env.ACCOUNTS_DATABASE, { schema });
  const [memberships, invitations] = await Promise.all([
    db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, session.user.id))
      .orderBy(asc(schema.member.createdAt)),
    readReceivedInvitations(env, headers).catch(() => []),
  ]);
  const teams = memberships.map(({ id, name, slug, role }) => ({
    id,
    name,
    role,
    manages: managesTeam(role),
    personal: slug.startsWith(PERSONAL_SLUG_PREFIX),
  }));
  const activeId = session.session.activeOrganizationId;
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    team: teams.find((team) => team.id === activeId) ?? teams[0] ?? null,
    teams,
    invitations: invitations.length,
  };
}

export interface MemberRow {
  /** The membership's id, which role changes and removals take. */
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

export interface TeamPeople {
  members: MemberRow[];
  /** Open invitations, newest first. */
  invitations: InvitationRow[];
}

/** A team's members, owners first, and its open invitations. */
export async function readTeamPeople(
  env: AuthBindings,
  headers: Headers,
  organizationId: string,
): Promise<TeamPeople> {
  const { api } = createAuth(env);
  const [{ members }, invitations] = await Promise.all([
    api.listMembers({ headers, query: { organizationId, limit: 500 } }),
    api.listInvitations({ headers, query: { organizationId } }),
  ]);
  const rank = (role: string) => (role.includes("owner") ? 0 : role.includes("admin") ? 1 : 2);
  return {
    members: members
      .map((member) => ({
        id: member.id,
        userId: member.userId,
        name: displayName(member.user),
        email: member.user.email,
        image: member.user.image ?? null,
        role: member.role,
      }))
      .sort((left, right) => rank(left.role) - rank(right.role)),
    invitations: invitations
      .filter(
        (invitation) =>
          invitation.status === "pending" && new Date(invitation.expiresAt) > new Date(),
      )
      .map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role ?? "member",
        expiresAt: new Date(invitation.expiresAt).toISOString(),
      }))
      .sort((left, right) => right.expiresAt.localeCompare(left.expiresAt)),
  };
}

export interface KeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** The member who created it; `null` for a key from before keys named their creator. */
  createdBy: { id: string; name: string } | null;
}

/** A team's keys, newest first, with who created each. Every member reads them. */
export async function readTeamKeys(
  env: AuthBindings,
  headers: Headers,
  organizationId: string,
): Promise<KeyRow[]> {
  const { api } = createAuth(env);
  const { apiKeys } = await api.listApiKeys({
    headers,
    query: { organizationId, sortBy: "createdAt", sortDirection: "desc" },
  });
  const creatorOf = (metadata: unknown) =>
    (metadata as Partial<ApiKeyMetadata> | null)?.createdBy ?? null;
  const creatorIds = [...new Set(apiKeys.flatMap((key) => creatorOf(key.metadata) ?? []))];
  const db = drizzle(env.ACCOUNTS_DATABASE, { schema });
  const [used, creators] = await Promise.all([
    lastUsed(
      env.API_KEYS,
      apiKeys.map((key) => key.id),
    ),
    creatorIds.length > 0
      ? db
          .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
          .from(schema.user)
          .where(inArray(schema.user.id, creatorIds))
      : [],
  ]);
  const names = new Map(creators.map((user) => [user.id, displayName(user)]));
  return apiKeys.map((key) => {
    const creator = creatorOf(key.metadata);
    return {
      id: key.id,
      name: key.name,
      start: key.start,
      createdAt: new Date(key.createdAt).toISOString(),
      lastUsedAt: used[key.id] ?? null,
      createdBy: creator ? { id: creator, name: names.get(creator) ?? "Persona eliminada" } : null,
    };
  });
}

/** A new team's slug: never shown, only unique. */
export function teamSlug() {
  return `team-${crypto.randomUUID()}`;
}

export interface ReceivedInvitation {
  id: string;
  team: string;
  role: string;
}

/** The open invitations to the signed-in user's email. */
export async function readReceivedInvitations(
  env: AuthBindings,
  headers: Headers,
): Promise<ReceivedInvitation[]> {
  const invitations = await createAuth(env).api.listUserInvitations({ headers });
  return invitations
    .filter(
      (invitation) =>
        invitation.status === "pending" && new Date(invitation.expiresAt) > new Date(),
    )
    .map((invitation) => ({
      id: invitation.id,
      team: invitation.organizationName,
      role: invitation.role ?? "member",
    }));
}
