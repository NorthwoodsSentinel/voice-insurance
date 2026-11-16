// Tests for scripts/check-coverage-scope.mjs.
//
// Why: the scope check is what stops the gate passing on zero measured files
// (or on the wrong files). A check that is never exercised can rot into one
// that passes everything, so its refusals are pinned here on synthetic
// coverage summaries.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED, checkSummary } from "../scripts/check-coverage-scope.mjs";

const ROOT = path.resolve("/repo");
const fig = (pct, total = 10) => ({
  total,
  covered: Math.round((pct / 100) * total),
  pct,
});
const good = {
  lines: fig(100),
  statements: fig(100),
  functions: fig(100),
  branches: fig(95),
};
const allGood = () =>
  Object.fromEntries(EXPECTED.map((f) => [path.join(ROOT, f), good]));

describe("checkSummary", () => {
  it("names the three source files", () => {
    expect(EXPECTED).toEqual([
      "bin/cli.js",
      "src/extractor.js",
      "src/scorer.js",
    ]);
  });

  it("passes exactly the source files at or above the bar", () => {
    expect(checkSummary({ total: good, ...allGood() }, ROOT)).toEqual([]);
  });

  it("fails when coverage measured zero files", () => {
    expect(checkSummary({ total: good }, ROOT)).toEqual([
      "coverage measured [], expected exactly [bin/cli.js, src/extractor.js, src/scorer.js]",
    ]);
  });

  it("fails when coverage measured an extra, a missing or a different file", () => {
    const extra = {
      total: good,
      ...allGood(),
      [path.join(ROOT, "test/helpers/run-cli.js")]: good,
    };
    expect(checkSummary(extra, ROOT)).toHaveLength(1);
    const fewer = { total: good, [path.join(ROOT, "src/scorer.js")]: good };
    expect(checkSummary(fewer, ROOT)[0]).toMatch(
      /^coverage measured \[src\/scorer.js\]/,
    );
  });

  it("fails a figure under 90", () => {
    const summary = { total: good, ...allGood() };
    summary[path.join(ROOT, "src/scorer.js")] = {
      ...good,
      branches: fig(89.9),
    };
    expect(checkSummary(summary, ROOT)).toEqual([
      "src/scorer.js: branches 89.9% < 90%",
    ]);
  });

  it("fails zero statements, functions or branches measured, and a missing figure", () => {
    const summary = { total: good, ...allGood() };
    summary[path.join(ROOT, "bin/cli.js")] = {
      lines: fig(100),
      statements: { total: 0, covered: 0, pct: 100 },
      functions: { total: 0, covered: 0, pct: 100 },
      branches: { total: 0, covered: 0, pct: 100 },
    };
    expect(checkSummary(summary, ROOT)).toEqual([
      "bin/cli.js: zero statements measured",
      "bin/cli.js: zero functions measured",
      "bin/cli.js: zero branches measured",
    ]);
    summary[path.join(ROOT, "bin/cli.js")] = {
      lines: fig(100),
      statements: fig(100),
      functions: fig(100),
    };
    expect(checkSummary(summary, ROOT)).toEqual([
      "bin/cli.js: zero branches measured",
      "bin/cli.js: branches undefined% < 90%",
    ]);
  });
});
