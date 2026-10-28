# Performance

Latency of the Worker `codice-api` (`codice` before the 2026-10-27 move to Handle): its `/v1` routes and the `CodiceKnowledge` entrypoint that the
Agent binds as `CODICE`.

## Measurement, 2026-10-25

Window: 2026-10-18 08:10 UTC to 2026-10-25 08:10 UTC (7 days). Sources:

- Sentry, org `handlemotion` (`jaantonio` before 2026-10-27), project `codice-api`, spans dataset.
- Cloudflare Workers observability (`cf observability telemetry query`) for script `codice`.
- Cloudflare GraphQL Analytics: `workersInvocationsAdaptive` (script `codice`) and
  `d1AnalyticsAdaptiveGroups` (database `c4df9b36-…`). These are not sampled per event, so they
  count every invocation.
- Sentry, project `transitive-agent`, `gen_ai.execute_tool` spans, for the calls the Agent makes.

### Result: no production traffic to measure

p50 and p95 per `/v1` route and per `CodiceKnowledge` method cannot be measured yet. The Worker had
no successful invocation in the window:

| Source                               | What it holds for `codice` in the window                        |
| ------------------------------------ | --------------------------------------------------------------- |
| Sentry `codice-api`                  | 0 spans and 0 transactions (also 0 over 90 days)                |
| Workers observability                | 0 events (`$workers.scriptName` = `codice` is absent)           |
| `workersInvocationsAdaptive`         | 20 invocations, all 2026-10-24 23:00 to 2026-10-25 01:59 UTC    |
| Sentry `transitive-agent` tool spans | 52 tool calls; 0 of `search_knowledge` or of the knowledge read |

The 20 invocations, none of them a success:

| Status                 | Count | Wall time p50 | Wall time p99 | CPU time p50 |
| ---------------------- | ----: | ------------: | ------------: | -----------: |
| `loadShed`             |    16 |         ~72 s |        ~335 s |       5–6 ms |
| `scriptThrewException` |     2 |         6.8 s |         159 s |       7.5 ms |
| `clientDisconnected`   |     2 |    12 s, 30 s |             – |  5 ms, 12 ms |

They fall during and just before the cutover (`cutover.md`, steps 3 and 4), which deployed
`codice` at least ten times between 00:35 and 02:13 UTC. Each used 5–12 ms of CPU but held on for
seconds to minutes, so the wall time is time spent connected, not work; the data does not say
which client held the connections. They are not a latency baseline.

The Agent switched its knowledge tools to the `CODICE` binding in `trstv/transitive#2762`
(Agent deployed 2026-10-25 01:13 UTC). Since then `codice` has had no invocation at all, so no
Agent run has used `search_knowledge` or read a knowledge passage, and the entrypoint has no
traffic either.

### D1 (the only measured dependency)

`d1AnalyticsAdaptiveGroups` for database `codice`, per hour with activity:

| Hour (UTC)       | Read queries | Write queries | Rows read | Batch time p50 | Batch time p90 |
| ---------------- | -----------: | ------------: | --------: | -------------: | -------------: |
| 2026-10-24 20:00 |            6 |             9 |       517 |        0.55 ms |        63.0 ms |
| 2026-10-24 21:00 |            1 |             1 |       501 |        2.18 ms |        44.7 ms |
| 2026-10-24 23:00 |           19 |            17 |     8,231 |        1.05 ms |        5.96 ms |
| 2026-10-25 00:00 |           35 |            14 | 2,985,600 |        2.78 ms |     1,024.0 ms |
| 2026-10-25 01:00 |           39 |             3 | 2,972,628 |        0.91 ms |        5.04 ms |
| 2026-10-25 02:00 |            4 |             0 |         6 |        0.13 ms |        0.40 ms |
| 2026-10-25 04:00 |          129 |             0 |    22,747 |        0.32 ms |        1.54 ms |
| 2026-10-25 05:00 |          150 |             2 | 1,480,048 |        0.32 ms |        1.42 ms |

Most of these queries do not come from the Worker: from 02:00 UTC the Worker had no invocations,
so they come from the ingestion (`wrangler d1 execute`) and the cutover checks. They still bound
D1's own cost: an indexed point read (the shape of every Worker query, `records.ts`) takes well
under 1 ms inside D1 (p50 0.13–0.55 ms in the read-only hours). The time a Worker waits on D1 is
therefore almost all network round trip to the database's primary, which this data does not
show.

### Split: AI Search, D1, our code

Not measurable from production yet, for two reasons beyond the missing traffic:

1. **No spans for the dependencies or the entrypoint.** `Sentry.withSentry` (`src/index.ts`)
   wraps only the default export's `fetch`, so a `CodiceKnowledge` RPC call makes no
   transaction, and neither the `CODICE_SEARCH` calls nor the D1 queries make child spans.
   A trace would show one `http.server` span with no split inside it.
2. **Workers traces sample 1 %.** `observability.traces.head_sampling_rate` is `0.01`
   (`wrangler.jsonc`). At tens of calls a day, that keeps almost no traces.

What the code fixes is the number of serial round trips each call waits on, which is the shape
the split will take:

| Route / method                                 | Serial round trips (in order)                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /v1/search`, `search`                     | AI Search `search` → D1 `sourcesById`                                                          |
| `GET /v1/passages/:id`, `readPassage`          | D1 `passageRow` → AI Search `items.list` → AI Search `items.get().download` → D1 `sourcesById` |
| `GET /v1/errors/:code`, `lookupError`          | D1 `errorCode` → D1 `sourcesById`                                                              |
| `GET /v1/catalogs/:name`, `listCatalog`        | D1 `catalogListing` → D1 `sourcesById`                                                         |
| `GET /v1/catalogs/:name/:key`, `lookupCatalog` | D1 `catalogEntry` → D1 `sourcesById` (+ D1 `catalogColumns` on an empty filtered answer)       |
| `GET /v1/sources`, `GET /v1/sources/:id`       | D1 (one query)                                                                                 |

Our own code is CPU only: validation, mapping rows and JSON. The 20 invocations above used
5–12 ms of CPU each, including isolate start-up (`startup_time_ms` 55 for version `a6945917`),
so a warm request's own code is a few milliseconds at most.

## Local measurement, 2026-10-28

`pnpm dev:up` on a cloud session: local D1, the real AI Search instance `codice` through Wrangler's
remote binding, the dashboard's `CodiceAccounts` for keys. Each route was called 6 to 20 times after
one warm-up call; times are curl's total, in ms.

| Route                                | Before p50 | Before p95 | After p50 | After p95 |
| ------------------------------------ | ---------: | ---------: | --------: | --------: |
| `GET /v1/passages/:id` (a 2 KB body) |      3,442 |      4,180 |        21 |        23 |
| `GET /v1/passages/:id` (66 KB body)  |          – |          – |        22 |        27 |
| `GET /v1/search`                     |      1,099 |      3,821 |     1,473 |     2,500 |
| `GET /v1/errors/:code`               |         22 |         24 |        21 |        26 |
| `GET /v1/catalogs/:name/:key`        |         22 |         26 |        20 |        22 |
| `GET /v1/sources`                    |         22 |         25 |        24 |        32 |

- A passage read made two serial AI Search Items API calls (`items.list`, then the download);
  it now reads the body D1 holds (`passages.body`, migration `0006`). The stored bodies matched AI
  Search's downloads byte for byte (SHA-256) for the three passages compared, the largest
  (`rmf-2026/regla-2.1.12.md`, 66 KB) among them.
- A search is AI Search's time: its `server-timing` read `total;dur=3959.0, search;dur=3943.0`.
  Its spread is the instance's (reranking on), not the Worker's.
- The D1 routes do not show the sources cache or the replica session: the local D1 has no network
  round trip. Production's split shows in Sentry once traffic arrives.

## Before optimizing: make the split visible

Do this first, so each change below has a before and after:

- Done 2026-10-28: `Sentry.instrumentD1WithSentry` on `CODICE_DATABASE`, a `Sentry.startSpan`
  around each `CODICE_SEARCH` call (`op` `ai_search.search`, `ai_search.items.list`,
  `ai_search.items.download`), and the `server-timing` header (`src/timing.ts`). Left: a
  transaction per `CodiceKnowledge` method (no caller binds `codice-api`'s entrypoint yet; for example
  `Sentry.startSpan({ name: "CodiceKnowledge.search", op: "rpc.server" }, …)` in `internalCall`,
  with the Sentry client set up for the entrypoint as for `fetch`).
- Raise `observability.traces.head_sampling_rate` to `1` while traffic stays low; lower it once
  `codice` serves enough calls a day that 1 % still gives a p95.

Then repeat the queries in "Reproduce" after a week of Agent traffic and fill the table below.

| Route / method | Calls | p50 | p95 | AI Search |  D1 | Own code |
| -------------- | ----: | --: | --: | --------: | --: | -------: |
| (pending)      |       |     |     |           |     |          |

## Optimizations

Each gain is in serial round trips removed, from the code; its value in milliseconds needs the
spans above. None changes an answer.

1. **`readPassage`** (done 2026-10-28, further than planned: one D1 query, no AI Search call;
   see "Local measurement"). The plan was **four serial round trips down to two.** `passageRow` (D1) and `items.list`
   (AI Search) both take only the id, so run them together; then run `items.get().download` and
   `sourcesById` together, since `row.sourceId` is known. Expected gain: one AI Search round trip
   and one D1 round trip per passage read, about half of the call's waiting time. The Agent calls
   it for every knowledge passage it reads (`read_file` on `knowledge/…`) and the workspace for
   every passage a member opens.
2. **Hold the sources in the isolate** (done 2026-10-28, `SOURCES_CACHE_MS`, `src/records.ts`). `sourcesById` is the second serial D1 query of `search`,
   `lookupError`, `listCatalog` and `lookupCatalog`. The `sources` table is a few rows that only
   the ingestion writes, so read it once per isolate (`allSources`) and keep it for a short time
   (for example 5 minutes, so an ingestion shows within that time). Expected gain: one D1 round
   trip on each of those calls, which halves the D1 wait of every lookup and leaves `search` with
   AI Search plus our code only. The Agent's `search_knowledge` runs `search`, `lookupError` and
   `listCatalog` in parallel, so its wait drops by one D1 round trip.
3. **Read D1 from the nearest replica** (code done 2026-10-28: every query goes through a
   `first-unconstrained` session. Read replication was enabled on `codice` the same day,
   `read_replication.mode: auto`; its primary runs in `WNAM`). Every Worker query is a read of data that changes only at
   ingestion, so enable D1 read replication and query through a session
   (`env.CODICE_DATABASE.withSession("first-unconstrained")`). Expected gain: each remaining D1
   round trip goes to a replica near the calling colo instead of the primary; it is largest when
   the Agent runs far from the primary (the gain is that round-trip difference times the D1 calls
   left after 1 and 2). Check the primary's region first. Drizzle's `drizzle()` (installed
   version) types its client as `D1Database`, so passing a session needs a cast and a test that
   `recordsDatabase` still runs every query through it.

## Reproduce

Cloudflare GraphQL Analytics (`https://api.cloudflare.com/client/v4/graphql`, a token with
Account Analytics Read):

```graphql
query ($a: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $a }) {
      workersInvocationsAdaptive(
        limit: 200
        filter: { scriptName: "codice", datetime_geq: $from, datetime_leq: $to }
      ) {
        sum {
          requests
          errors
          subrequests
        }
        dimensions {
          datetimeHour
          status
        }
        quantiles {
          wallTimeP50
          wallTimeP99
          cpuTimeP50
        }
      }
      d1AnalyticsAdaptiveGroups(
        limit: 200
        filter: {
          databaseId: "c4df9b36-a98a-4963-b43f-83b2697e195b"
          datetime_geq: $from
          datetime_leq: $to
        }
      ) {
        sum {
          readQueries
          writeQueries
          rowsRead
        }
        dimensions {
          datetimeHour
        }
        quantiles {
          queryBatchTimeMsP50
          queryBatchTimeMsP90
        }
      }
    }
  }
}
```

Workers observability, events of `codice` by type and outcome:

```sh
cf observability telemetry query --body '{"queryId":"adhoc","view":"calculations",
  "timeframe":{"from":<ms>,"to":<ms>},"parameters":{
  "filters":[{"key":"$workers.scriptName","operation":"eq","type":"string","value":"codice"}],
  "calculations":[{"operator":"count","alias":"n"}],
  "groupBys":[{"type":"string","value":"$workers.eventType"},
              {"type":"string","value":"$workers.outcome"}]}}'
```

Sentry (Explore → Traces, project `codice-api`, last 7 days): group by `transaction` and by
`span.op`, with `count()`, `p50(span.duration)` and `p95(span.duration)`.
