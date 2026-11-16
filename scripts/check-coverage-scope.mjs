// Coverage scope check: the gate must fail if coverage measured
// nothing, or something other than the source.
//
// Why: a coverage threshold over zero files passes. Vitest's per-file
// thresholds only judge the files it measured, so a mistyped or unanchored
// include/exclude pattern can leave the gate green while checking nothing
// (an unanchored pattern once left a gate green on 0 of 0 files). This
// script reads coverage/coverage-summary.json after `vitest run --coverage`
// and fails unless the measured set is exactly EXPECTED, each file has a
// non-zero count of statements, functions and branches, and each of the four
// figures is >= 90.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const THRESHOLD = 90;
export const EXPECTED = ["bin/cli.js", "src/extractor.js", "src/scorer.js"];
const METRICS = ["lines", "statements", "functions", "branches"];

/** Returns a list of problems; empty means the scope and figures are good. */
export function checkSummary(summary, repoRoot) {
  const problems = [];
  const measured = Object.keys(summary)
    .filter((k) => k !== "total")
    .map((k) => path.relative(repoRoot, k).split(path.sep).join("/"))
    .sort();
  const expected = [...EXPECTED].sort();
  if (JSON.stringify(measured) !== JSON.stringify(expected)) {
    problems.push(
      `coverage measured [${measured.join(", ")}], expected exactly [${expected.join(", ")}]`,
    );
    return problems;
  }
  for (const [key, figures] of Object.entries(summary)) {
    if (key === "total") continue;
    const rel = path.relative(repoRoot, key).split(path.sep).join("/");
    for (const m of ["statements", "functions", "branches"]) {
      if (!figures[m] || figures[m].total === 0)
        problems.push(`${rel}: zero ${m} measured`);
    }
    for (const m of METRICS) {
      const pct = figures[m]?.pct;
      if (typeof pct !== "number" || pct < THRESHOLD) {
        problems.push(`${rel}: ${m} ${pct}% < ${THRESHOLD}%`);
      }
    }
  }
  return problems;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const file = path.join(repoRoot, "coverage", "coverage-summary.json");
  let summary;
  try {
    summary = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`check-coverage-scope: cannot read ${file}: ${err.message}`);
    process.exit(1);
  }
  const problems = checkSummary(summary, repoRoot);
  if (problems.length > 0) {
    for (const p of problems) console.error(`check-coverage-scope: FAIL ${p}`);
    process.exit(1);
  }
  console.log(
    `check-coverage-scope: OK, measured exactly ${EXPECTED.join(", ")}, all >= ${THRESHOLD}`,
  );
}
