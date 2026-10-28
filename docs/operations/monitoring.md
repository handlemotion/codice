# Monitoring

How a production failure of Códice reaches someone, within minutes rather than days. Written
2026-10-28, after `codice-corpus.yml` failed on 2026-10-26 and 2026-10-27 (AI Search items stuck
while indexing) and nobody noticed for two days.

| Signal                         | What watches it                          | Alerts through                               | State on 2026-10-28                      |
| ------------------------------ | ---------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| Corpus run fails               | `alert` job of `codice-corpus.yml`       | GitHub issue "Códice corpus failed"          | Live once merged                         |
| Worker secret sync fails       | `alert` job of `sync-worker-secrets.yml` | GitHub issue "Worker secret sync failed"     | Live once merged                         |
| API down, wrong or slow        | `codice-synthetic.yml`, every 10 minutes | GitHub issue "Códice synthetic check failed" | Live once merged, on `https://codice.io` |
| Errors and 5xx in `codice-api` | Sentry alert and monitor (below)         | Sentry email                                 | Live since 2026-10-28                    |
| AI Search latency              | Sentry monitor on `ai_search.search`     | Sentry email                                 | Live since 2026-10-28                    |

## Workflow failure issues

`scripts/ops/alert-issue.mjs` runs in a last job (`alert`, `needs` every other job,
`if: always()`, `main` only) of each scheduled workflow. It needs no secret: the job's
`GITHUB_TOKEN` with `issues: write` and `actions: read`.

- A run with a failed job opens one issue labelled `ops-alert`, titled after the workflow, and
  assigns it to the repository owner (`github.repository_owner`), so later comments notify them
  too. While that issue is open, each further failure comments on it instead of opening another.
- The issue names the run, its trigger and every failed `job › step` (`gh run view --json jobs`).
  The corpus run adds what it extracted from its logs: the items AI Search did not finish indexing
  (the lines `failUnfinished` in `apps/api/scripts/ingest.ts` prints, `key (status)`), and the
  eval's summary line when the eval fell below its floor. The ingest step now tees stderr too, so
  the log holds the thrown error.
- The next run in which every job succeeds comments "Recovered" and closes the issue. A cancelled
  run changes nothing.
- The repository is public, so the issue is too: it carries item keys, step names and run links,
  never a secret or a log dump.

A new issue notifies everyone watching the repository and its assignee (by email or the GitHub app,
per their notification settings). To route it elsewhere (Slack, incident.io), subscribe that tool
to issues labelled `ops-alert`.

## Synthetic check

`scripts/ops/synthetic-check.mjs`, from `.github/workflows/codice-synthetic.yml` every 10 minutes
(GitHub runs schedules late under load; expect 10–20 minutes between runs). It calls, in order:

| Call                         | Key | Passes when                     | Limit    | Why this limit                                                                                                                                        |
| ---------------------------- | --- | ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ready`                 | no  | 200, `status: "ready"`          | 1,000 ms | No I/O in the Worker; what is left is the runner's network, TLS and the edge → API service binding hop.                                               |
| `GET /v1/search?q=CFDI40149` | yes | 200, at least one result        | 8,000 ms | AI Search's time (`performance.md`, "Local measurement"): p95 2,500 ms, the slowest single search seen 3,959 ms (`server-timing`). Twice the slowest. |
| `GET /v1/errors/CFDI40149`   | yes | 200, `data.code` is `CFDI40149` | 1,500 ms | Key check (KV) and one or two D1 reads: local p95 26 ms with no network to D1. The rest is network and D1 round trips, with room for a cold isolate.  |

Each call gets a second attempt when the first fails, so a single slow request is not an alert;
the job fails when both fail. The limits are tripwires for an outage or a gross regression seen
from outside; the p95 trend is the Sentry rules' job. Once production has a week of traffic,
revisit them against the measured table in `performance.md`.

The report (status, time, `server-timing`, `x-request-id` of every attempt) goes to the run's
summary and, on a failure, into the issue "Códice synthetic check failed", which takes at most one
comment an hour while the check keeps failing (`--repeat-after 60`) and closes on the next pass.

**Key.** The site's key, `CODICE_SITE_API_KEY` in Doppler `codice` `prd`, read with
`doppler secrets get` (that one name only, masked) through the corpus job's OIDC identity
`handlemotion-codice-main`, whose subject admits any workflow on `main`. Two requests a run sit far
under the key's 60 a minute. A dedicated key (a team `Códice monitor`, its key as
`CODICE_SYNTHETIC_API_KEY` in `prd`) would keep this traffic out of the site's usage; it is a new
production secret, so it waits on the owner's approval.

**Cost.** One AI Search query a run: about 4,300 a month, $3.25 a month at $0.75 per 1,000 once
billing starts on 2026-11-01, and it uses up the free 1,000 the weekly eval would otherwise fit
in (SPEC.md, "Cost"). Actions minutes are free: the repository is public. GitHub disables a
public repository's schedules after 60 days without activity.

### Host

The check calls `https://codice.io`, the custom domain of the edge Worker `codice-edge` (zone on the
Handle account, active 2026-10-28 03:50 UTC; `/workers/domains` lists `codice.io` → `codice-edge`,
`production`), which forwards `/ready`, `/v1` and `/mcp` to `codice-api`. A manual run can name
another base URL (input `base_url`). Before the domain, nothing reached the API from outside:
`workers.dev` is off on both Workers.

Evidence 2026-10-28, against the local Worker (`pnpm dev:up`, real AI Search instance, a local
dashboard key):

```
| Check | Status | Time | Limit | Result | server-timing |
| `/ready` | 200 | 106 ms | 1000 ms | ✅ | `total;dur=0.0` |
| `/v1/search?q=CFDI40149` | 200 | 2080 ms | 8000 ms | ✅ | `total;dur=2025.0, search;dur=1940.0` |
| `/v1/errors/CFDI40149` | 200 | 67 ms | 1500 ms | ✅ | `total;dur=16.0` |
```

With a wrong key both keyed checks failed twice with `HTTP 401` and the script exited 1.

## Sentry rules for `codice-api`

Org `handlemotion`, project `codice-api`. Approved by the owner and created on 2026-10-28 through
the Sentry connection. Each notifies by email the issue's owners, else every active member
(`issue_owners`, fallthrough `ActiveMembers`), as the org's default "high priority issues" alert
(`6239850`) does; that one stays and covers only issues Sentry rates high priority.

1. **Alert "codice-api: new or regressed issue"** (`6242204`,
   <https://handlemotion.sentry.io/monitors/alerts/6242204/>): sources the project's issue stream
   and the two monitors below; triggers a new issue (`first_seen_event`), a regression
   (`regression_event`) and a reappeared issue (`reappeared_event`); email as above, at most once
   every 30 minutes per issue. Every 5xx is a Sentry error (`src/index.ts`), so a new failure mode alerts on its first
   event.
2. **Metric monitor "codice-api: error events"** (`10780018`): dataset errors (`events`), query empty
   (every error event), `count()` over 5 minutes, static: critical above 10, warning above 2,
   resolved at 2 or fewer. Connected to the alert above. A count, not a rate: the Worker has had
   almost no traffic (`performance.md`), so a rate over a handful of requests swings between 0 and
   100 %; Sentry's `failure_rate()` also counts 401 and 404 spans as failures, which a client with
   a bad key causes. Switch to `failure_rate()` on `http.server` 5xx once traffic is steady.
3. **Metric monitor "codice-api: AI Search p95"** (`10780020`): dataset spans (`events_analytics_platform`,
   `trace_item_span`), query `span.op:ai_search.search`, `p95(span.duration)` over 1 hour, static:
   critical above 8,000 ms, warning above 5,000 ms, resolved at 4,000 ms or less. 5,000 ms is above
   every search measured so far (3,959 ms the slowest); 8,000 ms matches the synthetic limit.
   Traces are sampled at 20 % (`@codice/monitoring`), so the synthetic searches alone give about
   one sampled span an hour; the window is an hour for that reason, and can shrink with traffic.
