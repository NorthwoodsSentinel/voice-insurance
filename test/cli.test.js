// Tests for bin/cli.js: the extract, score and compare commands, help and
// errors, run in-process through test/helpers/run-cli.js.
//
// Why: the printed report and the exit code are what users and scripts rely
// on (score exits 1 on FAIL). Every input is synthetic (test/fixtures/ and
// temp files written here); profiles are written to a temp directory, never
// into the repo.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const CORPUS = path.join(FIXTURES, "corpus");
const PLAIN = path.join(FIXTURES, "docs", "plain.md");
const PADDED = path.join(FIXTURES, "docs", "padded.md");

let tmp;
let profilePath;
beforeEach(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "voice-insurance-cli-"));
  profilePath = path.join(tmp, "profile.json");
  const r = await runCli(["extract", "--corpus", CORPUS, "--out", profilePath]);
  expect(r.code).toBeUndefined();
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("help and unknown commands", () => {
  it.each([[[]], [["--help"]], [["-h"]]])(
    "prints help for %j and exits normally",
    async (argv) => {
      const r = await runCli(argv);
      expect(r.code).toBeUndefined();
      expect(r.out).toContain(
        "voice-insurance — Forensic stylometric instrument",
      );
      expect(r.out).toContain(
        "compare   Compare two voice profiles side by side",
      );
    },
  );

  it("rejects an unknown command with help and exit 1", async () => {
    const r = await runCli(["bogus"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("  Unknown command: bogus");
    expect(r.out).toContain("Commands:");
  });
});

describe("extract", () => {
  it("writes the profile and prints its summary", async () => {
    const r = await runCli([
      "extract",
      "--corpus",
      CORPUS,
      "--out",
      profilePath,
      "--verbose",
    ]);
    expect(r.code).toBeUndefined();
    const profile = JSON.parse(readFileSync(profilePath, "utf8"));
    expect(profile.meta.sourceCount).toBe(3);
    expect(r.out).toContain("Extracting voice profile from 3 file(s)...");
    expect(r.out).toContain("  Total words:       299");
    expect(r.out).toContain("  Avg sentence:      12 words");
    expect(r.out).toContain("  AI words avoided:  33/33");
    expect(r.out).toContain(`  Profile saved:     ${profilePath}`);
    expect(r.out).toContain("  Top vocabulary:");
  });

  it("reads a --files list up to the next flag, warning about missing files", async () => {
    const out = path.join(tmp, "files.json");
    const r = await runCli([
      "extract",
      "--files",
      PLAIN,
      path.join(tmp, "nope.md"),
      "--out",
      out,
    ]);
    expect(r.code).toBeUndefined();
    expect(r.err).toBe(
      `  Warning: file not found: ${path.join(tmp, "nope.md")}`,
    );
    expect(JSON.parse(readFileSync(out, "utf8")).meta.sources).toEqual([
      "plain.md",
    ]);
    expect(r.out).not.toContain("Top vocabulary");
  });

  it("writes voice-profile.json in the working directory by default", async () => {
    const r = await runCli(["extract", "--files", PLAIN], { cwd: tmp });
    expect(r.code).toBeUndefined();
    expect(
      JSON.parse(readFileSync(path.join(tmp, "voice-profile.json"), "utf8"))
        .meta.sourceCount,
    ).toBe(1);
  });

  it("prints zero and blank figures for a corpus with no sentences", async () => {
    const header = path.join(tmp, "header.md");
    writeFileSync(header, "# Only a header\n");
    const r = await runCli([
      "extract",
      "--files",
      header,
      "--out",
      path.join(tmp, "h.json"),
    ]);
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("  Sentences:         0");
    expect(r.out).toContain("  Avg sentence:      undefined words");
  });

  it("exits 1 when no files are found", async () => {
    const r = await runCli(["extract", "--files"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      "  No files found. Use --corpus <dir> or --files <f1> <f2>",
    );
  });
});

describe("score", () => {
  it("passes plain text with exit 0 and shows fixes", async () => {
    const r = await runCli(["score", PLAIN, "--profile", profilePath, "--fix"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✅ VOICE SCORE: PASS (94/100)");
    expect(r.out).toContain("  ✓ Voice conformance       80/100  (30%)");
    expect(r.out).toContain("      → Contraction rate 5.26% vs profile 1.98%");
    expect(r.out).toContain(
      "      🔧 Fewer contractions — profile uses 1.98%.",
    );
    expect(r.out).toContain(`  File:      ${PLAIN}`);
    expect(r.out).toContain("  Threshold: 81/100");
  });

  it("fails padded text with exit 1, all three check icons and a truncated flag list", async () => {
    const r = await runCli([
      "score",
      PADDED,
      "--profile",
      profilePath,
      "--verbose",
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("❌ VOICE SCORE: FAIL (31/100)");
    expect(r.out).toContain("  ✗ Banned words             0/100  (15%)");
    expect(r.out).toContain("  △ Sentence length         60/100  (15%)");
    expect(r.out).toContain("  ✓ Paragraph structure     85/100  (10%)");
    expect(r.out).toContain("      ... and 4 more");
    // Only the first five flags are listed; the sixth is "holistic".
    expect(r.out).toContain('"robust" found 1x');
    expect(r.out).not.toContain('"holistic" found 1x');
    expect(r.out).not.toContain("🔧");
  });

  it("prints JSON and exits by the verdict", async () => {
    const pass = await runCli([
      "score",
      PLAIN,
      "--profile",
      profilePath,
      "--json",
    ]);
    expect(pass.code).toBe(0);
    const parsed = JSON.parse(pass.out);
    expect(parsed.score).toBe(94);
    expect(parsed.pass).toBe(true);
    expect(parsed.checks).toHaveLength(9);
    expect(parsed.profile.sourceCount).toBe(3);
    const fail = await runCli([
      "score",
      PADDED,
      "--profile",
      profilePath,
      "--json",
    ]);
    expect(fail.code).toBe(1);
    expect(JSON.parse(fail.out).pass).toBe(false);
  });

  it("reads the document from stdin when no file is given", async () => {
    const r = await runCli(["score", "--profile", profilePath], {
      stdin: readFileSync(PLAIN, "utf8"),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("PASS (94/100)");
    expect(r.out).not.toContain("File:");
  });

  it("exits 1 when stdin is a terminal and no file is given", async () => {
    const r = await runCli(["score", "--profile", profilePath], { tty: true });
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      "  No file provided. Usage: voice-insurance score <file>",
    );
  });

  it("exits 1 when the profile is missing, defaulting to voice-profile.json", async () => {
    const r = await runCli(["score", PLAIN], { cwd: tmp });
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      "  Profile not found: voice-profile.json\n  Run 'voice-insurance extract' first.",
    );
  });

  it("uses voice-profile.json in the working directory by default", async () => {
    writeFileSync(
      path.join(tmp, "voice-profile.json"),
      readFileSync(profilePath, "utf8"),
    );
    const r = await runCli(["score", PLAIN], { cwd: tmp });
    expect(r.code).toBe(0);
    expect(r.out).toContain("  Profile:   voice-profile.json");
  });
});

describe("compare", () => {
  it("prints two profiles side by side, named by their first source", async () => {
    const second = path.join(tmp, "second.json");
    await runCli(["extract", "--files", PADDED, "--out", second]);
    const r = await runCli(["compare", profilePath, second]);
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("  Voice Comparison");
    expect(r.out).toMatch(/Dimension {16}\S+ +padded.md/);
    expect(r.out).toContain("  Avg sentence length      12");
    expect(r.out).toContain("  Burstiness               50%");
  });

  it("falls back to the path and prints undefined for an empty profile", async () => {
    const empty = path.join(tmp, "e.json");
    writeFileSync(empty, "{}");
    const r = await runCli(["compare", empty, empty]);
    expect(r.code).toBeUndefined();
    expect(r.out).toContain(`${empty.substring(0, 10)}`);
    expect(r.out).toContain(
      "  Top word                 undefined    undefined",
    );
  });

  it.each([
    [["compare"]],
    [["compare", "a.json"]],
    [["compare", "missing-1.json", "missing-2.json"]],
  ])("exits 1 with usage for %j", async (argv) => {
    const r = await runCli(argv, { cwd: tmp });
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      "  Usage: voice-insurance compare <profile1.json> <profile2.json>",
    );
  });

  it("exits 1 when the second profile is missing", async () => {
    const r = await runCli([
      "compare",
      profilePath,
      path.join(tmp, "none.json"),
    ]);
    expect(r.code).toBe(1);
  });
});
