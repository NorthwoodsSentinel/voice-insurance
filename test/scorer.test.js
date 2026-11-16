// Tests for src/scorer.js: each of the nine checks and the weighted verdict.
//
// Why: the score and its PASS/FAIL line are what a user acts on, so each
// check's flags, fixes and arithmetic are pinned here. Every document and
// profile is synthetic, written for this suite (inline strings and
// test/fixtures/); no real person's writing is used.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProfile, collectFiles } from "../src/extractor.js";
import { scoreDocument } from "../src/scorer.js";

const fixture = (p) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url)),
    "utf8",
  );
const CORPUS_PROFILE = buildProfile(
  collectFiles(fileURLToPath(new URL("./fixtures/corpus", import.meta.url))),
);

function check(result, name) {
  const found = result.checks.find((c) => c.name === name);
  if (!found) throw new Error(`no check named ${name}`);
  return found;
}

// A profile that matches neutral prose closely, so a test can move one
// dimension at a time.
// Zero is falsy, so a profile value of 0 would fall back to the default; the
// neutral figures are small non-zero numbers instead.
const NEUTRAL = {
  sentences: { avgLength: 8, burstiness: 1 },
  paragraphs: {
    avgSentencesPerParagraph: 2,
    distribution: { singleSentence: 1 },
  },
  vocabulary: { emDashUsageRate: 0, contractionRate: 0.01 },
  structure: { listToProse: 0 },
  scoring: {
    sentenceLength: { target: { min: 1, max: 100 } },
    paragraphLength: { maxSentences: 6 },
    topicSentenceFirstMax: 100,
    maxConsecutiveLong: 3,
    maxConsecutiveBullets: 7,
    passiveVoiceMax: 15,
  },
};
const sentence = (n) =>
  `${Array.from({ length: n - 1 }, (_, i) => `word${i}`).join(" ")} end.`;

describe("scoreDocument", () => {
  it("returns nine weighted checks, a rounded score, the verdict and the threshold", () => {
    const result = scoreDocument(fixture("docs/plain.md"), CORPUS_PROFILE);
    expect(result.checks.map((c) => [c.name, c.weight])).toEqual([
      ["Banned words", 15],
      ["Filler openers", 10],
      ["Sentence length", 15],
      ["Paragraph structure", 10],
      ["Hedge clusters", 5],
      ["Passive voice", 5],
      ["AI triple", 5],
      ["Bullet walls", 5],
      ["Voice conformance", 30],
    ]);
    expect(result.finalScore).toBe(94);
    expect(result.pass).toBe(true);
    expect(result.threshold).toBe(81);
    expect(check(result, "Voice conformance").flags).toEqual([
      "Contraction rate 5.26% vs profile 1.98%",
      "List ratio 0% vs profile 25%",
    ]);
  });

  it("fails padded, hedged, list-heavy text on many checks at once", () => {
    const result = scoreDocument(fixture("docs/padded.md"), CORPUS_PROFILE);
    expect(result.finalScore).toBe(31);
    expect(result.pass).toBe(false);
    expect(check(result, "Banned words").score).toBe(0);
    expect(check(result, "Banned words").flags).toContain(
      '"certainly" found 1x',
    );
    expect(check(result, "Filler openers").flags).toHaveLength(3);
    expect(check(result, "Sentence length").flags).toEqual([
      "3 consecutive long sentences (max: 2)",
      "Low burstiness: 30% (profile: 50%)",
    ]);
    expect(check(result, "Paragraph structure").flags).toEqual([
      "Topic-sentence-first rate 100% (max: 65%)",
    ]);
    expect(check(result, "Hedge clusters").score).toBe(40);
    expect(check(result, "Passive voice").flags).toEqual([
      "Passive voice rate 64% (max: 15%)",
    ]);
    expect(check(result, "Passive voice").score).toBe(0);
    expect(check(result, "AI triple").score).toBe(75);
    expect(check(result, "Bullet walls").flags).toEqual([
      "8 consecutive bullets at line 9",
    ]);
    const conformance = check(result, "Voice conformance");
    expect(conformance.score).toBeCloseTo(14.09, 2);
    expect(conformance.flags).toEqual([
      "Smart quotes 100% — AI/word processor artifact",
      "List ratio 50% vs profile 25%",
      "Avg sentence 19.2 vs profile 12",
      "Information density low: 17 padding phrases in 216 words (7.9 per 100)",
    ]);
    expect(conformance.fixes[1]).toBe(
      "Too many lists — convert some bullets to prose.",
    );
  });

  it("falls back to built-in defaults for an empty profile", () => {
    const result = scoreDocument(
      "Certainly, we will leverage this. It seems that it works.",
      {},
    );
    expect(check(result, "Banned words").flags).toEqual([
      '"certainly" found 1x',
      '"leverage" found 1x',
    ]);
    expect(check(result, "Banned words").score).toBe(70);
    expect(check(result, "Filler openers").score).toBe(0);
    expect(check(result, "Hedge clusters").flags).toEqual([
      '"it seems that" found 1x',
    ]);
    expect(check(result, "Sentence length").flags).toEqual([
      "Avg sentence length 5.0 words (target: 8-22)",
      "Low burstiness: 0% (profile: 30%)",
    ]);
    expect(check(result, "Voice conformance").flags).toEqual([]);
  });

  it("scores empty text as clean on every check", () => {
    const result = scoreDocument("", {});
    for (const c of result.checks) expect(c.score).toBe(100);
    expect(result.finalScore).toBe(100);
  });
});

describe("sentence length", () => {
  it("flags an average above the target", () => {
    const text = [sentence(12), sentence(12)].join(" ");
    const profile = {
      ...NEUTRAL,
      scoring: {
        ...NEUTRAL.scoring,
        sentenceLength: { target: { min: 2, max: 6 } },
      },
    };
    const c = check(scoreDocument(text, profile), "Sentence length");
    expect(c.flags).toEqual(["Avg sentence length 12.0 words (target: 2-6)"]);
    expect(c.fixes).toEqual([
      "Adjust sentence length — profile averages 8 words.",
    ]);
    expect(c.score).toBe(80);
  });
});

describe("paragraph structure", () => {
  it("skips documents with fewer than three paragraphs", () => {
    const c = check(
      scoreDocument(`${sentence(8)}\n\n${sentence(8)}`, NEUTRAL),
      "Paragraph structure",
    );
    expect(c.score).toBe(100);
    // Two long paragraphs: still skipped, so the long-paragraph flag is not raised.
    const long = Array.from({ length: 6 }, () => sentence(8)).join(" ");
    expect(
      check(scoreDocument(`${long}\n\n${long}`, NEUTRAL), "Paragraph structure")
        .flags,
    ).toEqual([]);
  });

  it("flags long paragraphs and uniform paragraph lengths", () => {
    const para = Array.from({ length: 6 }, () => sentence(8)).join(" ");
    const text = Array.from({ length: 6 }, () => para).join("\n\n");
    const c = check(scoreDocument(text, NEUTRAL), "Paragraph structure");
    expect(c.flags).toEqual([
      "6 paragraph(s) with 6+ sentences",
      "Paragraph lengths too uniform",
    ]);
    expect(c.fixes[0]).toBe(
      "Break long paragraphs — profile averages 2 sentences.",
    );
    expect(c.score).toBe(70);
  });

  it("uses defaults and does not count quoted or connective openings as topic-first", () => {
    const text = [
      "But this paragraph starts with a connective word. It is fine.",
      '"Quoted openings do not count as topic sentences," she said.',
      "Short one. It has more words after it, though.",
      "A plain topic sentence that is long enough. Then more.",
    ].join("\n\n");
    const c = check(scoreDocument(text, {}), "Paragraph structure");
    expect(c.flags).toEqual([]);
    const strict = {
      scoring: { topicSentenceFirstMax: 10, paragraphLength: {} },
      paragraphs: {},
    };
    expect(
      check(scoreDocument(text, strict), "Paragraph structure").flags,
    ).toEqual(["Topic-sentence-first rate 25% (max: 10%)"]);
  });
});

describe("passive voice", () => {
  it("passes a rate at the limit and scales the score above it", () => {
    const passive = "The wall was painted by the crew today.";
    const active = "The crew painted the wall today again.";
    const atLimit = [passive, active, active, active].join(" ");
    const profile = { scoring: { passiveVoiceMax: 25 } };
    const lenient = { scoring: { passiveVoiceMax: 45 } };
    expect(check(scoreDocument(atLimit, profile), "Passive voice").score).toBe(
      100,
    );
    const over = [passive, passive, active, active].join(" ");
    const c = check(scoreDocument(over, profile), "Passive voice");
    expect(c.flags).toEqual(["Passive voice rate 50% (max: 25%)"]);
    expect(c.score).toBe(0);
    expect(check(scoreDocument(over, lenient), "Passive voice").score).toBe(
      100 - (50 - 45) * 5,
    );
  });
});

describe("AI triple", () => {
  it("flags three verb-led bullets once per run, whatever ends the run", () => {
    const verbs = "- Ensure one\n- Deploy two\n- Monitors three";
    const text = [verbs, "A prose line ends this run.", verbs, "", verbs].join(
      "\n",
    );
    const c = check(scoreDocument(text, NEUTRAL), "AI triple");
    expect(c.flags).toEqual([
      '3+ verb-led bullets: "Ensure one..."',
      '3+ verb-led bullets: "Ensure one..."',
      '3+ verb-led bullets: "Ensure one..."',
    ]);
    expect(c.score).toBe(25);
  });

  it("ignores article-led and mixed runs and runs shorter than three", () => {
    const text = [
      "- The first\n- A second\n- An third",
      "",
      "- Ensure one\n- Plain two\n- Deploy three",
      "",
      "- Ensure one\n- Deploy two",
      "Prose resets a short run.",
      "- *\n- Ensure two\n- Deploy three",
    ].join("\n");
    const c = check(scoreDocument(text, NEUTRAL), "AI triple");
    expect(c.flags).toEqual([]);
    expect(c.score).toBe(100);
  });
});

describe("bullet walls", () => {
  it("flags runs at or over the limit, mid-document and at the end", () => {
    const wall = Array.from({ length: 7 }, (_, i) => `- point ${i}`).join("\n");
    const text = [wall, "Prose between.", wall].join("\n");
    const c = check(scoreDocument(text, NEUTRAL), "Bullet walls");
    expect(c.flags).toEqual([
      "7 consecutive bullets at line 1",
      "7 consecutive bullets at line 9",
    ]);
    expect(c.score).toBe(60);
  });

  it("lets blank lines continue a run and uses the default limit", () => {
    const text = "- a\n\n- b\n- c\n- d\n- e\n- f\nProse.";
    expect(check(scoreDocument(text, {}), "Bullet walls").flags).toEqual([]);
    const seven = "- a\n\n- b\n- c\n- d\n- e\n- f\n- g\nProse.";
    expect(check(scoreDocument(seven, {}), "Bullet walls").flags).toEqual([
      "7 consecutive bullets at line 1",
    ]);
  });
});

describe("voice conformance", () => {
  const conformance = (text, profile) =>
    check(scoreDocument(text, profile), "Voice conformance");

  it("flags em dash usage only when the profile differs by more than 10 points", () => {
    const text = "One plain sentence here. Another plain one.";
    const at = (rate) =>
      conformance(text, {
        ...NEUTRAL,
        vocabulary: { emDashUsageRate: rate, contractionRate: 0.01 },
      }).flags;
    expect(at(10)).toEqual([]);
    expect(at(11)).toEqual(["Em dash usage 0% vs profile 11%"]);
  });

  it("asks for em dashes the profile uses (scoring converts the document's own to punctuation)", () => {
    const text = "One idea — and an aside. Another—with a dash —\nEnd here.";
    const profile = {
      ...NEUTRAL,
      vocabulary: { emDashUsageRate: 30, contractionRate: 0 },
    };
    const c = conformance(text, profile);
    expect(c.flags).toEqual(["Em dash usage 0% vs profile 30%"]);
    expect(c.fixes).toEqual([
      "Add em dashes — profile uses them in 30% of sentences.",
    ]);
    expect(c.score).toBe(100 - Math.min(30 - 8, 25));
  });

  it("flags too few and too many contractions, counting the no-apostrophe forms", () => {
    const formal = "We do not know. It is not done. They are not here.";
    const few = conformance(formal, {
      ...NEUTRAL,
      vocabulary: { emDashUsageRate: 0, contractionRate: 10 },
    });
    expect(few.flags).toEqual(["Contraction rate 0% vs profile 10%"]);
    expect(few.fixes[0]).toMatch(/^Use more contractions/);
    expect(few.score).toBe(80);

    const casual = "dont cant im won't isn't youre theyre";
    const many = conformance(casual, NEUTRAL);
    expect(many.flags).toEqual(["Contraction rate 100% vs profile 0.01%"]);
    expect(many.fixes).toEqual(["Fewer contractions — profile uses 0.01%."]);
  });

  it("uses the default contraction rate when the profile has none", () => {
    const c = conformance("dont cant", {});
    expect(c.flags).toEqual(["Contraction rate 100% vs profile 3%"]);
    expect(conformance("plain words with none", {}).flags).toEqual([]);
  });

  it("flags curly quotes only when they outnumber straight ones and there are more than three", () => {
    const curly = "“A” and ‘b’ and “c”.";
    const c = conformance(curly, NEUTRAL);
    expect(c.flags).toEqual(["Smart quotes 100% — AI/word processor artifact"]);
    expect(c.score).toBe(100 - 15 - 3 * 0);
    expect(conformance('"a" "b" “c”', NEUTRAL).flags).toEqual([]);
    expect(conformance("“a”", NEUTRAL).flags).toEqual([]);
    // Equal counts do not flag; three curly quotes alone are not enough.
    expect(conformance('"a" “b”', NEUTRAL).flags).toEqual([]);
    expect(conformance("“a” ‘", NEUTRAL).flags).toEqual([]);
  });

  it("flags too few lists against a list-heavy profile", () => {
    const c = conformance("Just prose here, no lists.", {
      ...NEUTRAL,
      structure: { listToProse: 60 },
    });
    expect(c.flags).toEqual(["List ratio 0% vs profile 60%"]);
    expect(c.fixes).toEqual(["Add structure — profile uses 60% lists."]);
    expect(c.score).toBe(100 - 25);
  });

  it("flags single-sentence paragraph rates in both directions once there are more than five paragraphs", () => {
    const one = sentence(8);
    const two = `${sentence(8)} ${sentence(8)}`;
    const allSingles = Array.from({ length: 6 }, () => one).join("\n\n");
    const many = conformance(allSingles, NEUTRAL);
    expect(many.flags).toEqual(["Single-sentence ¶ rate 100% vs profile 1%"]);
    expect(many.fixes).toEqual(["Too many one-liners — profile uses 1%."]);

    const noSingles = Array.from({ length: 6 }, () => two).join("\n\n");
    const few = conformance(noSingles, {
      ...NEUTRAL,
      paragraphs: { distribution: { singleSentence: 50 } },
    });
    expect(few.flags).toEqual(["Single-sentence ¶ rate 0% vs profile 50%"]);
    expect(few.fixes).toEqual(["Add single-sentence impact paragraphs."]);

    const defaults = conformance(noSingles, {
      vocabulary: { contractionRate: 0 },
    });
    expect(defaults.flags).toEqual([
      "Single-sentence ¶ rate 0% vs profile 20%",
      "Avg sentence 8.0 vs profile 14",
    ]);
  });

  it("checks average sentence length tightly once there are more than ten sentences", () => {
    const text = Array.from({ length: 11 }, () => sentence(20)).join(" ");
    const c = conformance(text, NEUTRAL);
    expect(c.flags).toEqual(["Avg sentence 20.0 vs profile 8"]);
    expect(c.score).toBe(100 - 25);
    const defaults = conformance(text, { vocabulary: { contractionRate: 0 } });
    expect(defaults.flags).toEqual(["Avg sentence 20.0 vs profile 14"]);
  });

  it("flags padding above exactly half a phrase per hundred words", () => {
    const base = Array.from({ length: 19 }, () => sentence(10)).join(" ");
    const hit = "We did it in order to win.";
    // 190 + 3 + 7 = 200 words, one hit: 0.5 per 100, not flagged.
    expect(conformance(`${base} ${sentence(3)} ${hit}`, NEUTRAL).flags).toEqual(
      [],
    );
    // 199 words, one hit: just over 0.5, flagged.
    expect(
      conformance(`${base} ${sentence(2)} ${hit}`, NEUTRAL).flags,
    ).toHaveLength(1);
  });

  it("flags padding only above half a phrase per hundred words", () => {
    const filler = Array.from({ length: 6 }, () => sentence(10)).join(" ");
    const light = `${filler} ${filler} ${filler} ${filler} We did it in order to win.`;
    expect(conformance(light, NEUTRAL).flags).toEqual([]);
    const heavy = `${filler} In order to win, at the end of the day, we did it.`;
    const c = conformance(heavy, NEUTRAL);
    expect(c.flags).toEqual([
      "Information density low: 2 padding phrases in 73 words (2.7 per 100)",
    ]);
    expect(c.fixes).toEqual([
      "Cut the padding. Say it once, mean it, move on.",
    ]);
    expect(c.score).toBe(90);
  });
});
