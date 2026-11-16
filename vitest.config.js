// Vitest configuration: which tests run and what coverage measures.
//
// `test.include` names each test file by path, not by a glob, and the check
// below refuses to start if one is missing, so a renamed test file fails the
// run instead of being skipped. `coverage.include` names the three source
// files by exact path. The bar (>= 90 per file on lines, statements,
// functions and branches) is the one in modelcontextprotocol/inspector
// (commit d330df9617e44ec893bc1a53618662239342d433). After this run,
// `npm test` runs scripts/check-coverage-scope.mjs, which fails if coverage
// measured zero files or any set other than these three. `retry` stays unset.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_FILES = [
  "test/extractor.test.js",
  "test/scorer.test.js",
  "test/cli.test.js",
  "test/check-coverage-scope.test.js",
];
const missing = TEST_FILES.filter(
  (f) => !existsSync(fileURLToPath(new URL(f, import.meta.url))),
);
if (missing.length > 0) {
  throw new Error(
    `vitest.config.js: listed test file(s) missing: ${missing.join(", ")}`,
  );
}

export default defineConfig({
  test: {
    environment: "node",
    // The CLI tests change the working directory, which worker threads forbid.
    pool: "forks",
    include: TEST_FILES,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["bin/cli.js", "src/extractor.js", "src/scorer.js"],
      // Exact paths only, one per entry, never a glob. None today.
      exclude: [],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
