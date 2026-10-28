#!/usr/bin/env node
// Turn a scheduled workflow's result into a GitHub issue, so a failure reaches someone
// (docs/operations/monitoring.md).
//
//   node scripts/ops/alert-issue.mjs --title "Códice corpus failed" --results "success failure" \
//     [--details-file details.md] [--repeat-after 60]
//
// `--results` is the space-separated result of each job the alert covers
// (`join(needs.*.result, ' ')`). A failure opens one issue labelled `ops-alert` with that title, or
// comments on the open one; a run where every job succeeded comments on it and closes it; anything
// else (a cancelled run) leaves it as it is. The issue names the failing jobs and steps, and
// `--details-file` adds what the workflow extracted from its logs (the stuck item keys).
// `--repeat-after <minutes>` skips the comment while the open issue changed more recently than
// that, so a check that runs every few minutes does not comment on every run.
//
// Needs `gh` with GH_TOKEN (`issues: write`, `actions: read`), and GITHUB_REPOSITORY,
// GITHUB_RUN_ID and GITHUB_SERVER_URL, which Actions sets. ALERT_ASSIGNEE (a login) is assigned
// on a new issue, so later comments notify them too. Never pass secret values in the details:
// the repository is public.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

export const LABEL = "ops-alert";

/** `failure` when a job failed, `recovered` when every job that ran succeeded, else `none`. */
export function outcome(results) {
  const list = results.split(/\s+/u).filter(Boolean);
  if (list.includes("failure")) return "failure";
  if (list.includes("success") && list.every((r) => r === "success" || r === "skipped")) {
    return "recovered";
  }
  return "none";
}

/** `Job › Step` for each failed step of the run's failed jobs (from `gh run view --json jobs`). */
export function failedSteps(jobs) {
  return jobs
    .filter((job) => job.conclusion === "failure")
    .flatMap((job) => {
      const steps = (job.steps ?? []).filter(
        (step) => step.conclusion === "failure" || step.conclusion === "cancelled",
      );
      if (steps.length === 0) return [`${job.name} (no step failed: timed out or cancelled)`];
      return steps.map((step) => `${job.name} › ${step.name}`);
    });
}

/** The issue body or the comment for one failed run. */
export function failureText({ workflow, runUrl, event, failed, details }) {
  const lines = [
    `**${workflow}** failed: ${runUrl} (${event}).`,
    "",
    "Failed:",
    ...(failed.length > 0
      ? failed.map((step) => `- ${step}`)
      : ["- (the run listed no failed job)"]),
  ];
  if (details?.trim()) lines.push("", details.trim());
  return `${lines.join("\n")}\n`;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/** Whether a failure should comment on an open issue last updated at `updatedAt`. */
export function shouldComment(updatedAt, repeatAfterMinutes, now = new Date()) {
  return now.getTime() - new Date(updatedAt).getTime() >= repeatAfterMinutes * 60_000;
}

function openIssue(title) {
  const issues = JSON.parse(
    gh(["issue", "list", "--state", "open", "--label", LABEL, "--json", "number,title,updatedAt"]),
  );
  return issues.find((issue) => issue.title === title);
}

function withBodyFile(text, run) {
  const file = join(tmpdir(), `alert-issue-${process.pid}.md`);
  writeFileSync(file, text);
  return run(file);
}

function main() {
  const { values } = parseArgs({
    options: {
      title: { type: "string" },
      results: { type: "string" },
      "details-file": { type: "string" },
      "repeat-after": { type: "string", default: "0" },
    },
  });
  if (!values.title || values.results === undefined) {
    throw new Error("--title and --results are required");
  }
  const result = outcome(values.results);
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const issue = openIssue(values.title);
  const existing = issue?.number;
  console.log(`results: ${values.results} → ${result}; open alert: ${existing ?? "none"}`);

  if (result === "recovered" && existing) {
    gh(["issue", "close", String(existing), "--comment", `Recovered: ${runUrl} succeeded.`]);
    console.log(`closed #${existing}`);
    return;
  }
  if (result !== "failure") return;
  if (issue && !shouldComment(issue.updatedAt, Number(values["repeat-after"]))) {
    console.log(`#${existing} changed less than ${values["repeat-after"]} minutes ago; no comment`);
    return;
  }

  const run = JSON.parse(
    gh(["run", "view", process.env.GITHUB_RUN_ID, "--json", "jobs,event,workflowName"]),
  );
  const details = values["details-file"] ? readFileSync(values["details-file"], "utf8") : "";
  const text = failureText({
    workflow: run.workflowName,
    runUrl,
    event: run.event,
    failed: failedSteps(run.jobs),
    details,
  });
  if (existing) {
    withBodyFile(text, (file) => gh(["issue", "comment", String(existing), "--body-file", file]));
    console.log(`commented on #${existing}`);
    return;
  }
  gh([
    "label",
    "create",
    LABEL,
    "--color",
    "B60205",
    "--force",
    "--description",
    "A scheduled Códice job failed (docs/operations/monitoring.md)",
  ]);
  const url = withBodyFile(text, (file) =>
    gh(["issue", "create", "--title", values.title, "--label", LABEL, "--body-file", file]),
  ).trim();
  console.log(`opened ${url}`);
  const assignee = process.env.ALERT_ASSIGNEE;
  if (assignee) {
    // The issue already exists; a login that cannot be assigned must not lose the alert.
    try {
      gh(["issue", "edit", url, "--add-assignee", assignee]);
    } catch {
      console.log(`could not assign ${assignee}`);
    }
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
