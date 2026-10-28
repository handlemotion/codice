import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * What each role in a team may do: Better Auth's organization statements, plus `apiKey`, which
 * the api-key plugin checks for a team's keys. Owners and admins manage the team, its people and
 * every key; members create keys and see the team's, and revoke only the ones they created (the
 * `/api-key/delete` hook in `auth.ts` holds them to that).
 */
const statements = {
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, apiKey: ["create", "read", "update", "delete"] }),
  admin: ac.newRole({ ...adminAc.statements, apiKey: ["create", "read", "update", "delete"] }),
  member: ac.newRole({ ...memberAc.statements, apiKey: ["create", "read", "delete"] }),
};

export type Role = keyof typeof roles;

export const ROLES = Object.keys(roles) as Role[];

/** Better Auth stores several roles comma-separated. */
function rolesOf(role: string) {
  return role.split(",").map((part) => part.trim());
}

/** Owners and admins manage the team: its name, its people and every key. */
export function managesTeam(role: string) {
  return rolesOf(role).some((part) => part === "owner" || part === "admin");
}
