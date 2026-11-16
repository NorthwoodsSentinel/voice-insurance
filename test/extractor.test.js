// Tests for src/extractor.js: corpus collection, text cleanup and the
// stylometric profile.
//
// Why: the profile is what every score is judged against, so its numbers are
// the product. These tests pin them on synthetic text only (test/fixtures/
// and inline strings written for this suite); no real person's writing is
// used, and nothing here reads outside the repo or a temp directory.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProfile,
  collectFiles,
  extractParagraphs,
  extractSentences,
  stripMarkdown,
  wordCount,
} from "../src/extractor.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const CORPUS = path.join(FIXTURES, "corpus");
const rel = (files) =>
  files.map((f) => path.relative(CORPUS, f).split(path.sep).join("/")).sort();

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "voice-insurance-extractor-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeTmp(name, text) {
  const file = path.join(tmp, name);
  writeFileSync(file, text);
  return file;
}

describe("collectFiles", () => {
  it("walks a corpus folder: supported extensions in any case, nested folders, hidden folders skipped", () => {
    expect(rel(collectFiles(CORPUS))).toEqual([
      "UPPER.TXT",
      "field-notes.md",
      "nested/garden-log.txt",
    ]);
  });

  it("prefers a specific file list and warns about each missing file", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = path.join(CORPUS, "field-notes.md");
    const files = collectFiles(CORPUS, [real, path.join(tmp, "nope.md")]);
    expect(files).toEqual([real]);
    expect(err).toHaveBeenCalledWith(
      `  Warning: file not found: ${path.join(tmp, "nope.md")}`,
    );
  });

  it("falls back to the corpus folder when the file list is empty", () => {
    expect(collectFiles(CORPUS, [])).toHaveLength(3);
  });

  it("throws on a missing corpus folder", () => {
    const missing = path.join(tmp, "absent");
    expect(() => collectFiles(missing)).toThrow(
      `Corpus directory not found: ${missing}`,
    );
  });

  it("returns nothing when given neither a folder nor files", () => {
    expect(collectFiles(undefined, undefined)).toEqual([]);
    expect(collectFiles(undefined, [])).toEqual([]);
  });
});

describe("text helpers", () => {
  it("stripMarkdown removes frontmatter, headers, tables, emphasis, list markers, links, code and quotes", () => {
    const md = [
      "---",
      "title: x",
      "---",
      "# Heading",
      "| a | b |",
      "**bold** and *italic* text.",
      "- bullet item",
      "1. numbered item",
      "See [the link](http://example.invalid) here.",
      "Run `code` now.",
      "> quoted line",
      "",
      "",
      "",
      "End.",
    ].join("\n");
    expect(stripMarkdown(md)).toBe(
      [
        "",
        "bold and italic text.",
        "bullet item",
        "numbered item",
        "See the link here.",
        "Run  now.",
        "quoted line",
        "",
        "End.",
      ]
        .join("\n")
        .trim(),
    );
  });

  it("extractSentences keeps terminated sentences longer than ten characters", () => {
    expect(
      extractSentences(
        "Short one. This sentence is long enough! Tiny? Unended",
      ),
    ).toEqual(["This sentence is long enough!"]);
  });

  it("extractParagraphs splits on blank lines and drops short blocks", () => {
    expect(
      extractParagraphs(
        "A paragraph that is long enough.\n\nshort\n\n\nAnother paragraph long enough.",
      ),
    ).toEqual([
      "A paragraph that is long enough.",
      "Another paragraph long enough.",
    ]);
  });

  it("wordCount counts whitespace-separated words", () => {
    expect(wordCount("  one two\tthree\nfour ")).toBe(4);
    expect(wordCount("")).toBe(0);
  });
});

describe("buildProfile", () => {
  it("profiles the synthetic corpus", () => {
    const profile = buildProfile(collectFiles(CORPUS));
    expect(profile.meta.version).toBe("1.0.0");
    expect(Number.isNaN(Date.parse(profile.meta.extractedAt))).toBe(false);
    expect(profile.meta.sourceCount).toBe(3);
    expect([...profile.meta.sources].sort()).toEqual([
      "UPPER.TXT",
      "field-notes.md",
      "garden-log.txt",
    ]);
    expect(profile.meta.totalWords).toBe(299);
    expect(profile.sentences).toMatchObject({
      count: 25,
      avgLength: 12,
      medianLength: 10,
      minLength: 3,
      maxLength: 29,
      stdDev: 8.1,
      distribution: { short: 44, medium: 36, long: 20 },
      burstiness: 50,
      maxConsecutiveLong: 1,
      fragmentCount: 9,
      fragmentRate: 36,
      andButStartRate: 4,
    });
    expect(profile.paragraphs).toEqual({
      count: 12,
      avgSentencesPerParagraph: 2.1,
      distribution: {
        singleSentence: 17,
        short_2_3: 75,
        medium_4_5: 0,
        long_6plus: 0,
      },
      uniformity: 1,
      topicSentenceFirstRate: 50,
    });
    expect(profile.vocabulary).toMatchObject({
      totalWords: 252,
      uniqueWords: 157,
      vocabularyRichness: 62,
      fillerWordsFound: {},
      passiveVoiceRate: 4,
      contractionRate: 1.98,
      emDashUsageRate: 4,
    });
    expect(profile.vocabulary.neverUsedAIWords).toHaveLength(33);
    expect(profile.vocabulary.topWords).toHaveLength(30);
    expect(profile.vocabulary.topWords[0]).toHaveProperty("rate");
    expect(profile.structure).toEqual({
      listToProse: 25,
      bulletLineCount: 3,
      numberedLineCount: 2,
      maxConsecutiveBullets: 3,
      headerCount: 2,
      avgHeaderWordCount: 3,
    });
    expect(profile.openingsClosings.openingPatterns).toHaveLength(3);
    expect(profile.openingsClosings.closingPatterns).toHaveLength(3);
    expect(profile.scoring).toMatchObject({
      sentenceLength: { target: { min: 5, max: 20 } },
      paragraphLength: { maxSentences: 6 },
      topicSentenceFirstMax: 65,
      maxConsecutiveLong: 3,
      maxConsecutiveBullets: 7,
      passiveVoiceMax: 15,
    });
  });

  it("buckets sentence lengths at 8 and 20 words", () => {
    const s = (n) =>
      `${Array.from({ length: n - 1 }, (_, i) => `w${i}`).join(" ")} end.`;
    const file = writeTmp("buckets.md", [s(8), s(9), s(20), s(21)].join(" "));
    expect(buildProfile([file]).sentences.distribution).toEqual({
      short: 25,
      medium: 50,
      long: 25,
    });
  });

  it("records filler words used, summary and forward-looking endings", () => {
    const file = writeTmp(
      "filler.md",
      [
        "We will leverage the plan and utilize the tools here today.",
        "",
        "The second paragraph is long enough to count here.",
        "",
        "In conclusion, we are going to look at what's next tomorrow.",
      ].join("\n"),
    );
    const profile = buildProfile([file]);
    expect(profile.vocabulary.fillerWordsFound).toEqual({
      utilize: 1,
      leverage: 1,
      "in conclusion": 1,
    });
    expect(profile.vocabulary.neverUsedAIWords).toHaveLength(30);
    expect(profile.openingsClosings.endsSummary).toBe(true);
    expect(profile.openingsClosings.endsForward).toBe(true);
  });

  it("raises derived limits from long runs, bullet runs and passive voice", () => {
    const long =
      "This sentence keeps going with many words so that it is clearly longer than twenty words in total length for the test.";
    const bullets = Array.from(
      { length: 9 },
      (_, i) => `- item number ${i}`,
    ).join("\n");
    const file = writeTmp(
      "runs.md",
      [
        `${long} ${long} ${long} ${long}`,
        "",
        bullets,
        "",
        "The wall was painted. The door was opened. The roof was mended. The yard was cleaned.",
      ].join("\n"),
    );
    const profile = buildProfile([file]);
    // The unpunctuated bullets join the next sentence, making a fifth long one.
    expect(profile.sentences.maxConsecutiveLong).toBe(5);
    expect(profile.scoring.maxConsecutiveLong).toBe(6);
    expect(profile.structure.maxConsecutiveBullets).toBe(9);
    expect(profile.scoring.maxConsecutiveBullets).toBe(11);
    expect(profile.vocabulary.passiveVoiceRate).toBeGreaterThan(10);
    expect(profile.scoring.passiveVoiceMax).toBe(
      profile.vocabulary.passiveVoiceRate + 5,
    );
  });

  it("caps the topic-sentence limit at 80 (the corpus test covers the floor of 5)", () => {
    const paras = Array.from(
      { length: 4 },
      (_, i) => `Paragraph ${i} opens with a plain topic sentence here. Hi.`,
    ).join("\n\n");
    const profile = buildProfile([writeTmp("topic.md", paras)]);
    expect(profile.paragraphs.topicSentenceFirstRate).toBe(100);
    expect(profile.scoring.topicSentenceFirstMax).toBe(80);
    expect(profile.scoring.sentenceLength.target).toEqual({ min: 9, max: 9 });
  });

  it("returns null sections when the text has no sentences or paragraphs", () => {
    const profile = buildProfile([writeTmp("empty.md", "# Only a header\n")]);
    expect(profile.sentences).toBeNull();
    expect(profile.paragraphs).toBeNull();
    expect(profile.openingsClosings).toBeNull();
    expect(profile.structure.listToProse).toBe(100 * 0);
    expect(profile.structure.headerCount).toBe(1);
    expect(profile.scoring.sentenceLength.target).toEqual({ min: 0, max: 0 });
    expect(profile.scoring.maxConsecutiveLong).toBe(0);
    expect(profile.scoring.topicSentenceFirstMax).toBe(0);
    expect(profile.vocabulary.passiveVoiceRate).toBe(0);
    expect(profile.vocabulary.emDashUsageRate).toBe(0);
  });

  it("handles a file that is entirely blank", () => {
    const profile = buildProfile([writeTmp("blank.txt", "")]);
    expect(profile.meta.totalWords).toBe(0);
    expect(profile.vocabulary.totalWords).toBe(0);
    expect(profile.vocabulary.contractionRate).toBe(0);
    expect(profile.structure.listToProse).toBe(0);
    expect(profile.structure.avgHeaderWordCount).toBe(0);
  });

  it("skips quoted and connective paragraph openings in the topic-sentence rate", () => {
    const text = [
      '"A quoted opening that is long enough to count," she said.',
      "",
      "But this paragraph starts with a connective word here.",
      "",
      "Short.",
      "",
      "A plain topic sentence that is long enough to count here.",
    ].join("\n");
    const profile = buildProfile([writeTmp("openings.md", text)]);
    expect(profile.paragraphs.count).toBe(3);
    expect(profile.paragraphs.topicSentenceFirstRate).toBe(33);
  });
});
