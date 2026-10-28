import { and, between, eq, inArray, min, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import type { UsageEvent } from "@codice/contracts";

import * as schema from "../db/schema";
import { displayName } from "../people";
import { apiUsage } from "../db/usage";
import { createAuth, type AuthBindings } from "./auth";

/**
 * Usage (apps/api/SPEC.md, "Usage"): `codice-api` reports each `/v1` call and MCP tool call after
 * answering it, and the Uso page reads a week of them: the team's keys and the user's MCP clients.
 */

/** Days are Mexico City's, where Códice's users are. */
const MEXICO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` in Mexico City for an instant. */
export function mexicoDay(at: number) {
  return MEXICO_DAY.format(new Date(at));
}

/** A `YYYY-MM-DD` day moved by whole days. */
export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Adds the reported calls to their day's counters. */
export async function recordUsage(database: D1Database, events: UsageEvent[]) {
  if (events.length === 0) return;
  const db = drizzle(database);
  const [first, ...rest] = events.map((event) => {
    const { caller } = event;
    const failed = event.status >= 400 ? 1 : 0;
    const durationMs = Math.max(0, Math.round(event.durationMs));
    return db
      .insert(apiUsage)
      .values({
        day: mexicoDay(event.at),
        credentialKind: caller.kind,
        ownerId: caller.kind === "api_key" ? caller.organizationId : caller.userId,
        credentialId: caller.kind === "api_key" ? caller.keyId : caller.clientId,
        userId: caller.userId ?? null,
        surface: event.surface,
        operation: event.operation.slice(0, 64),
        requests: 1,
        errors: failed,
        durationMs,
      })
      .onConflictDoUpdate({
        target: [
          apiUsage.day,
          apiUsage.credentialKind,
          apiUsage.ownerId,
          apiUsage.credentialId,
          apiUsage.surface,
          apiUsage.operation,
        ],
        set: {
          requests: sql`${apiUsage.requests} + 1`,
          errors: sql`${apiUsage.errors} + ${failed}`,
          durationMs: sql`${apiUsage.durationMs} + ${durationMs}`,
          // A day's first call may have come before `codice-api` sent the key's creator.
          userId: sql`coalesce(${apiUsage.userId}, excluded.user_id)`,
        },
      });
  });
  await db.batch([first!, ...rest]);
}

/** One key, MCP client or person in a week's usage. */
export interface UsageSeries {
  /** `api_key:<id>`, `oauth:<client id>`, or `user:<user id>` (`user:` for keys without one). */
  id: string;
  kind: "api_key" | "oauth" | "user";
  label: string;
  /** The key's first characters, the client's host, or the person's email. */
  hint: string | null;
  /** For a key or client, the person it is attributed to. */
  person: string | null;
  /** For a person, their photo. */
  image?: string | null;
  requests: number;
}

export interface UsageWeek {
  /** The week's first and last day, `YYYY-MM-DD` in Mexico City. */
  start: string;
  end: string;
  today: string;
  /** The first day with any usage, to stop stepping back; `null` before the first call. */
  earliest: string | null;
  /** Each day's calls per series id, of `series` and of `people`. */
  days: { date: string; requests: Record<string, number> }[];
  /** The keys and MCP clients, most calls first. */
  series: UsageSeries[];
  /** The same calls by person: who created each key, and the user for their clients. */
  people: UsageSeries[];
  /** Most calls first. */
  operations: { operation: string; requests: number; errors: number }[];
  totals: { requests: number; errors: number; meanMs: number | null };
}

function hostOf(uri: string | null) {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

/** A key without a recorded creator: one made before keys named theirs. */
const UNATTRIBUTED = "user:";

/**
 * A week of usage for the signed-in user: the calls of the team's keys and of the MCP clients
 * the user connected, by credential and by person. Every member sees the whole team's keys.
 * MCP clients belong to their user, not to a team, so only the user's own count here. `end` is
 * the week's last day; by default, today.
 */
export async function readUsage(
  env: AuthBindings,
  headers: Headers,
  input: { organizationId: string; end?: string },
): Promise<UsageWeek> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const db = drizzle(env.ACCOUNTS_DATABASE, { schema });

  const membership = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(eq(schema.member.organizationId, input.organizationId), eq(schema.member.userId, userId)),
    )
    .get();
  if (!membership) throw new Error("Not a member of the team");

  const today = mexicoDay(Date.now());
  const end = input.end && input.end < today ? input.end : today;
  const start = addDays(end, -6);
  const mine = or(
    and(eq(apiUsage.credentialKind, "api_key"), eq(apiUsage.ownerId, input.organizationId)),
    and(eq(apiUsage.credentialKind, "oauth"), eq(apiUsage.ownerId, userId)),
  );

  const [rows, first, keys, clients] = await Promise.all([
    db
      .select()
      .from(apiUsage)
      .where(and(mine, between(apiUsage.day, start, end))),
    db
      .select({ day: min(apiUsage.day) })
      .from(apiUsage)
      .where(mine)
      .get(),
    // Every member reads the team's keys (`permissions.ts`); a revoked key is gone from the list.
    auth.api
      .listApiKeys({ headers, query: { organizationId: input.organizationId } })
      .then(({ apiKeys }) => apiKeys)
      .catch(() => []),
    db
      .select({
        clientId: schema.oauthClient.clientId,
        name: schema.oauthClient.name,
        uri: schema.oauthClient.uri,
      })
      .from(schema.oauthClient)
      .innerJoin(schema.oauthConsent, eq(schema.oauthConsent.clientId, schema.oauthClient.clientId))
      .where(eq(schema.oauthConsent.userId, userId)),
  ]);

  // A client's rows from before `user_id` was recorded name their user as the owner.
  const personOf = (row: (typeof rows)[number]) =>
    row.userId ?? (row.credentialKind === "oauth" ? row.ownerId : null);
  const userIds = [...new Set(rows.flatMap((row) => personOf(row) ?? []))];
  const users =
    userIds.length > 0
      ? await db
          .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            image: schema.user.image,
          })
          .from(schema.user)
          .where(inArray(schema.user.id, userIds))
      : [];

  const keyNames = new Map(keys.map((key) => [key.id, key]));
  const clientNames = new Map(clients.map((client) => [client.clientId, client]));
  const people = new Map(users.map((user) => [user.id, user]));
  const personName = (id: string | null) => {
    const person = id ? people.get(id) : undefined;
    return person ? displayName(person) : null;
  };
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: addDays(start, index),
    requests: {} as Record<string, number>,
  }));
  const series = new Map<string, UsageSeries>();
  const byPerson = new Map<string, UsageSeries>();
  const operations = new Map<string, { operation: string; requests: number; errors: number }>();
  const totals = { requests: 0, errors: 0, durationMs: 0 };

  for (const row of rows) {
    const id = `${row.credentialKind}:${row.credentialId}`;
    const userOfRow = personOf(row);
    const personId = userOfRow ? `user:${userOfRow}` : UNATTRIBUTED;
    const day = days.find((candidate) => candidate.date === row.day);
    if (day) {
      day.requests[id] = (day.requests[id] ?? 0) + row.requests;
      day.requests[personId] = (day.requests[personId] ?? 0) + row.requests;
    }

    let entry = series.get(id);
    if (!entry) {
      if (row.credentialKind === "api_key") {
        const key = keyNames.get(row.credentialId);
        entry = {
          id,
          kind: "api_key",
          label: key ? key.name || "Clave sin nombre" : "Clave revocada",
          hint: key?.start ?? null,
          person: personName(userOfRow),
          requests: 0,
        };
      } else {
        const client = clientNames.get(row.credentialId);
        entry = {
          id,
          kind: "oauth",
          label: client?.name || "Asistente desconectado",
          hint: hostOf(client?.uri ?? null) ?? hostOf(row.credentialId),
          person: personName(userOfRow),
          requests: 0,
        };
      }
      series.set(id, entry);
    }
    entry.requests += row.requests;

    let person = byPerson.get(personId);
    if (!person) {
      const user = userOfRow ? people.get(userOfRow) : undefined;
      person = {
        id: personId,
        kind: "user",
        label: user ? displayName(user) : userOfRow ? "Persona eliminada" : "Claves sin autor",
        hint: user?.email ?? null,
        person: null,
        image: user?.image ?? null,
        requests: 0,
      };
      byPerson.set(personId, person);
    }
    person.requests += row.requests;

    const operation = operations.get(row.operation) ?? {
      operation: row.operation,
      requests: 0,
      errors: 0,
    };
    operation.requests += row.requests;
    operation.errors += row.errors;
    operations.set(row.operation, operation);

    totals.requests += row.requests;
    totals.errors += row.errors;
    totals.durationMs += row.durationMs;
  }

  const byRequests = (left: UsageSeries, right: UsageSeries) => right.requests - left.requests;
  return {
    start,
    end,
    today,
    earliest: first?.day ?? null,
    days,
    series: [...series.values()].sort(byRequests),
    people: [...byPerson.values()].sort(byRequests),
    operations: [...operations.values()].sort((left, right) => right.requests - left.requests),
    totals: {
      requests: totals.requests,
      errors: totals.errors,
      meanMs: totals.requests > 0 ? Math.round(totals.durationMs / totals.requests) : null,
    },
  };
}
