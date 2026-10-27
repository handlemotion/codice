import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
        },
        // `codice-app`'s `CodiceAccounts`, stubbed: test/accounts-stub.js.
        serviceBindings: { ACCOUNTS: { name: "codice-app", entrypoint: "CodiceAccounts" } },
        workers: [
          {
            name: "codice-app",
            modules: true,
            scriptPath: "./test/accounts-stub.js",
            compatibilityDate: "2026-08-14",
          },
        ],
      },
    }),
  ],
  test: {
    exclude: ["test/**/*.unit.test.ts"],
    include: ["test/**/*.test.ts"],
  },
});
