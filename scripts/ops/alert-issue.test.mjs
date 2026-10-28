import { describe, expect, it } from "vitest";

import { failedSteps, failureText, outcome, shouldComment } from "./alert-issue.mjs";

describe("outcome", () => {
  it("is a failure when any job failed", () => {
    expect(outcome("success failure")).toBe("failure");
    expect(outcome("cancelled failure")).toBe("failure");
  });

  it("recovers only when every job that ran succeeded", () => {
    expect(outcome("success success")).toBe("recovered");
    expect(outcome("success skipped")).toBe("recovered");
    expect(outcome("skipped skipped")).toBe("none");
  });

  it("leaves a cancelled run alone", () => {
    expect(outcome("success cancelled")).toBe("none");
    expect(outcome("")).toBe("none");
  });
});

describe("failedSteps", () => {
  it("names each failed step of each failed job", () => {
    const jobs = [
      {
        name: "SAT sources",
        conclusion: "success",
        steps: [{ name: "Check", conclusion: "success" }],
      },
      {
        name: "Ingest and eval",
        conclusion: "failure",
        steps: [
          { name: "Install dependencies", conclusion: "success" },
          { name: "Ingest", conclusion: "failure" },
          { name: "Retrieval eval", conclusion: "skipped" },
        ],
      },
    ];
    expect(failedSteps(jobs)).toEqual(["Ingest and eval › Ingest"]);
  });

  it("says when a failed job has no failed step, as after a timeout", () => {
    expect(failedSteps([{ name: "Ingest and eval", conclusion: "failure", steps: [] }])).toEqual([
      "Ingest and eval (no step failed: timed out or cancelled)",
    ]);
  });
});

describe("failureText", () => {
  it("links the run, lists the failures and appends the details", () => {
    const text = failureText({
      workflow: "Códice corpus",
      runUrl: "https://github.com/handlemotion/codice/actions/runs/1",
      event: "schedule",
      failed: ["Ingest and eval › Ingest"],
      details: "Unfinished items:\n\n```\nrmf-2026/regla-12.3.16.md (running)\n```\n",
    });
    expect(text).toBe(
      [
        "**Códice corpus** failed: https://github.com/handlemotion/codice/actions/runs/1 (schedule).",
        "",
        "Failed:",
        "- Ingest and eval › Ingest",
        "",
        "Unfinished items:",
        "",
        "```",
        "rmf-2026/regla-12.3.16.md (running)",
        "```",
        "",
      ].join("\n"),
    );
  });
});

describe("shouldComment", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("always comments without a repeat interval", () => {
    expect(shouldComment("2026-10-28T11:59:59Z", 0, now)).toBe(true);
  });

  it("waits until the issue is older than the interval", () => {
    expect(shouldComment("2026-10-28T11:10:00Z", 60, now)).toBe(false);
    expect(shouldComment("2026-10-28T11:00:00Z", 60, now)).toBe(true);
  });
});
