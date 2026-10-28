import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Calls to `/v1` and MCP tool calls, counted per Mexico City day, credential, surface and
 * operation (apps/api/SPEC.md, "Usage"). `codice-api` reports them through
 * `CodiceAccounts.recordUsage`; the Uso page reads them. Not one of Better Auth's tables.
 */
export const apiUsage = sqliteTable(
  "api_usage",
  {
    /** `YYYY-MM-DD` in Mexico City. */
    day: text("day").notNull(),
    /** `api_key`: a team's key, owned by the team. `oauth`: an MCP client, owned by its user. */
    credentialKind: text("credential_kind", { enum: ["api_key", "oauth"] }).notNull(),
    /** The key's team, or the user who connected the client. */
    ownerId: text("owner_id").notNull(),
    /** The key's id, or the MCP client's id. */
    credentialId: text("credential_id").notNull(),
    surface: text("surface", { enum: ["http", "mcp"] }).notNull(),
    operation: text("operation").notNull(),
    requests: integer("requests").notNull().default(0),
    /** Answers with a 4xx or 5xx status. */
    errors: integer("errors").notNull().default(0),
    /** The sum of the calls' durations, for their mean. */
    durationMs: integer("duration_ms").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.day,
        table.credentialKind,
        table.ownerId,
        table.credentialId,
        table.surface,
        table.operation,
      ],
    }),
    index("api_usage_owner_day_idx").on(table.credentialKind, table.ownerId, table.day),
  ],
);
