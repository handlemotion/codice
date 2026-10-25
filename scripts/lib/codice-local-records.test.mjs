import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import {
  describeCodiceSeedResult,
  errorCodeCount,
  seedLocalCodiceRecords,
} from "./codice-local-records.mjs";

const countOutput = (count) => JSON.stringify([{ results: [{ count }], success: true }]);

function recordingRun(responses) {
  const calls = [];
  return {
    calls,
    run: async (args, cwd) => {
      calls.push({ args, cwd });
      return responses.shift();
    },
  };
}

test("reads the error-code count from Wrangler's JSON output", () => {
  assert.equal(errorCodeCount(countOutput(129)), 129);
  assert.throws(() => errorCodeCount(JSON.stringify([{ results: [] }])), /no error-code count/u);
});

test("runs the local ingest when the local D1 holds no error codes", async () => {
  const { calls, run } = recordingRun([
    { code: 0, stdout: countOutput(0), stderr: "" },
    { code: 0, stdout: "Corpus: 501 passages\nD1 (local): 129 error codes\n", stderr: "" },
  ]);
  const result = await seedLocalCodiceRecords({ root: "/repo", run });

  assert.deepEqual(result, { seeded: true, summary: "D1 (local): 129 error codes" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ cwd }) => cwd === path.join("/repo", "apps", "api")));
  assert.ok(calls[0].args.includes("--local") && calls[0].args.includes("CODICE_DATABASE"));
  assert.deepEqual(calls[1].args, ["exec", "tsx", "scripts/ingest.ts", "--local"]);
});

test("leaves present records alone", async () => {
  const { calls, run } = recordingRun([{ code: 0, stdout: countOutput(129), stderr: "" }]);
  assert.deepEqual(await seedLocalCodiceRecords({ run }), { seeded: false });
  assert.equal(calls.length, 1);
});

test("reports a failed count or ingest instead of throwing", async () => {
  const failedCount = recordingRun([{ code: 1, stdout: "", stderr: "no such table" }]);
  assert.deepEqual(await seedLocalCodiceRecords({ run: failedCount.run }), {
    seeded: false,
    error: "no such table",
  });

  const failedIngest = recordingRun([
    { code: 0, stdout: countOutput(0), stderr: "" },
    { code: 1, stdout: "", stderr: "wrangler failed" },
  ]);
  const result = await seedLocalCodiceRecords({ run: failedIngest.run });
  assert.deepEqual(result, { seeded: false, error: "wrangler failed" });
  assert.match(describeCodiceSeedResult(result), /seed failed\nwrangler failed/u);
});
