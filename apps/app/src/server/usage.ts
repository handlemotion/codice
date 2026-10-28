import { and, between, eq, inArray, min, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import type { UsageEvent } from "@codice/contracts";

import * as schema from "../db/schema";
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
        },
      });
  });
  await db.batch([first!, ...rest]);
}

/** The periods the Uso page offers, in days. */
export const USAGE_PERIODS = [7, 30] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

/** One key, or one member's MCP clients, in a period's usage. */
export interface UsageSeries {
  /** `api_key:<id>` or `member:<user id>`. */
  id: string;
  label: string;
  /** The key's first characters, or the member's email. */
  hint: string | null;
  image: string | null;
  requests: number;
  /** The same series in the period before. */
  previous: number;
}

export interface UsageOperation {
  operation: string;
  requests: number;
  errors: number;
  previous: number;
}

export interface UsageTotals {
  requests: number;
  errors: number;
  meanMs: number | null;
}

/** One scope of the page: the team's keys, or its members through their MCP clients. */
export interface UsageView {
  /** Each day's calls per series id. */
  days: { date: string; requests: Record<string, number> }[];
  /** Most calls first. */
  series: UsageSeries[];
  /** Most calls first. */
  operations: UsageOperation[];
  totals: UsageTotals;
  /** The period before, for the change. */
  previous: UsageTotals;
}

export interface UsagePeriodData {
  days: UsagePeriod;
  /** The period's first and last day, `YYYY-MM-DD` in Mexico City. */
  start: string;
  end: string;
  today: string;
  /** The first day with any usage, to stop stepping back; `null` before the first call. */
  earliest: string | null;
  keys: UsageView;
  members: UsageView;
}

type UsageRow = typeof apiUsage.$inferSelect;

/** Adds rows up into a view; `seriesOf` names a row's series, `null` to leave it out. */
function viewOf(
  rows: UsageRow[],
  range: { start: string; previousStart: string; length: number },
  seriesOf: (row: UsageRow) => Omit<UsageSeries, "requests" | "previous"> | null,
): UsageView {
  const days = Array.from({ length: range.length }, (_, index) => ({
    date: addDays(range.start, index),
    requests: {} as Record<string, number>,
  }));
  const dayIndex = new Map(days.map((day, index) => [day.date, index]));
  const series = new Map<string, UsageSeries>();
  const operations = new Map<string, UsageOperation>();
  const current = { requests: 0, errors: 0, durationMs: 0 };
  const before = { requests: 0, errors: 0, durationMs: 0 };

  for (const row of rows) {
    const named = seriesOf(row);
    if (!named) continue;
    const inPeriod = row.day >= range.start;
    const entry = series.get(named.id) ?? { ...named, requests: 0, previous: 0 };
    series.set(named.id, entry);
    const operation = operations.get(row.operation) ?? {
      operation: row.operation,
      requests: 0,
      errors: 0,
      previous: 0,
    };
    operations.set(row.operation, operation);
    const sums = inPeriod ? current : before;
    sums.requests += row.requests;
    sums.errors += row.errors;
    sums.durationMs += row.durationMs;
    if (inPeriod) {
      const day = days[dayIndex.get(row.day)!]!;
      day.requests[named.id] = (day.requests[named.id] ?? 0) + row.requests;
      entry.requests += row.requests;
      operation.requests += row.requests;
      operation.errors += row.errors;
    } else {
      entry.previous += row.requests;
      operation.previous += row.requests;
    }
  }

  const totals = (sums: typeof current): UsageTotals => ({
    requests: sums.requests,
    errors: sums.errors,
    meanMs: sums.requests > 0 ? Math.round(sums.durationMs / sums.requests) : null,
  });
  const byCalls = <T extends { requests: number; previous: number }>(list: T[]) =>
    list.filter((item) => item.requests > 0).sort((left, right) => right.requests - left.requests);
  return {
    days,
    series: byCalls([...series.values()]),
    operations: byCalls([...operations.values()]),
    totals: totals(current),
    previous: totals(before),
  };
}

/**
 * A period of the team's usage for the signed-in member, in two views: by the team's keys, and
 * by its members through the MCP clients each connected (an MCP client is the user's, so a member
 * of two teams shows the same calls in both). `end` is the period's last day; by default, today.
 */
export async function readUsage(
  env: AuthBindings,
  headers: Headers,
  input: { organizationId: string; end?: string; days?: number },
): Promise<UsagePeriodData> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("Not signed in");
  const db = drizzle(env.ACCOUNTS_DATABASE, { schema });

  const members = await db
    .select({
      userId: schema.member.userId,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, input.organizationId));
  if (!members.some((member) => member.userId === session.user.id)) {
    throw new Error("Not a member of the team");
  }

  const length: UsagePeriod = input.days === 30 ? 30 : 7;
  const today = mexicoDay(Date.now());
  const end = input.end && input.end < today ? input.end : today;
  const start = addDays(end, -(length - 1));
  const previousStart = addDays(start, -length);
  const teams = or(
    and(eq(apiUsage.credentialKind, "api_key"), eq(apiUsage.ownerId, input.organizationId)),
    and(
      eq(apiUsage.credentialKind, "oauth"),
      inArray(
        apiUsage.ownerId,
        members.map((member) => member.userId),
      ),
    ),
  );

  const [rows, first, keys] = await Promise.all([
    db
      .select()
      .from(apiUsage)
      .where(and(teams, between(apiUsage.day, previousStart, end))),
    db
      .select({ day: min(apiUsage.day) })
      .from(apiUsage)
      .where(teams)
      .get(),
    // Only the team's owner may list its keys; for anyone else, keys go by their id.
    auth.api
      .listApiKeys({ headers, query: { organizationId: input.organizationId } })
      .then(({ apiKeys }) => apiKeys)
      .catch(() => []),
  ]);

  const keyNames = new Map(keys.map((key) => [key.id, key]));
  const people = new Map(members.map((member) => [member.userId, member]));
  const range = { start, previousStart, length };

  return {
    days: length,
    start,
    end,
    today,
    earliest: first?.day ?? null,
    keys: viewOf(rows, range, (row) => {
      if (row.credentialKind !== "api_key") return null;
      const key = keyNames.get(row.credentialId);
      return {
        id: `api_key:${row.credentialId}`,
        label: key ? key.name || "Clave sin nombre" : "Clave revocada",
        hint: key?.start ?? null,
        image: null,
      };
    }),
    members: viewOf(rows, range, (row) => {
      if (row.credentialKind !== "oauth") return null;
      const member = people.get(row.ownerId)!;
      return {
        id: `member:${row.ownerId}`,
        label: member.name.trim() || member.email,
        hint: member.name.trim() ? member.email : null,
        image: member.image,
      };
    }),
  };
}
