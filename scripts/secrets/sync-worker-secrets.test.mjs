import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { versionEnvPatch, workers } from "./sync-worker-secrets.mjs";

describe("workers", () => {
  it("lists each app that declares required secrets, with its Worker name", () => {
    const apps = mkdtempSync(join(tmpdir(), "codice-apps-"));
    const app = (dir, text) => {
      mkdirSync(join(apps, dir));
      if (text !== undefined) writeFileSync(join(apps, dir, "wrangler.jsonc"), text);
    };
    app("api", '{ "name": "codice-api", // comment\n "secrets": { "required": ["B", "A"] } }');
    app("edge", '{ "name": "codice-edge" }');
    app("site", '{ "name": "codice-site", "secrets": { "required": [] } }');
    app("docs");

    expect(workers(apps)).toEqual([{ script: "codice-api", keys: ["A", "B"] }]);
  });

  it("reads this repository's Workers", () => {
    expect(workers()).toEqual([
      { script: "codice-api", keys: ["ANTHROPIC_API_KEY", "SENTRY_DSN"] },
      { script: "codice-app", keys: ["BETTER_AUTH_SECRET"] },
      { script: "codice-site", keys: ["CODICE_SITE_API_KEY"] },
    ]);
  });
});

describe("versionEnvPatch", () => {
  it("turns a secrets-bulk patch into a versions env patch, keeping removals", () => {
    expect(
      versionEnvPatch({
        A: { name: "A", text: "one", type: "secret_text" },
        B: null,
      }),
    ).toEqual({ A: { type: "secret_text", text: "one" }, B: null });
  });
});
