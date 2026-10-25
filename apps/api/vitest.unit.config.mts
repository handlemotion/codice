import { defineConfig } from "vitest/config";

import { nodeTestOptions } from "../../vitest.node.config.mts";

export default defineConfig({
  test: {
    ...nodeTestOptions,
    include: ["test/**/*.unit.test.ts"],
  },
});
