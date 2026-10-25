import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const picomatch = require("picomatch");

const root = path.dirname(fileURLToPath(import.meta.url));
const oxlintConfig = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
const ignoreMatchers = (oxlintConfig.ignorePatterns ?? []).map((pattern) => picomatch(pattern));

function isIgnoredByOxlint(file) {
  const relative = path.relative(root, file);
  return ignoreMatchers.some((matcher) => matcher(relative));
}

/** @type {import('lint-staged').Configuration} */
export default {
  "*.{js,jsx,ts,tsx,mjs,cjs,json,jsonc,css,scss,md,mdx}": "oxfmt --no-error-on-unmatched-pattern",
  // Oxlint applies ignorePatterns even when files are passed explicitly on the CLI
  // ("No files found to lint"). Mirror .oxlintrc.json ignores here — see lint-staged
  // docs: filter staged paths with picomatch before invoking the linter.
  "*.{js,jsx,ts,tsx,mjs,cjs}": (files) => {
    const lintable = files.filter((file) => !isIgnoredByOxlint(file));
    return lintable.length > 0 ? `oxlint --fix ${lintable.join(" ")}` : [];
  },
};
