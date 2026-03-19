#!/usr/bin/env node

/**
 * voice-insurance — Forensic stylometric instrument
 *
 * Commands:
 *   voice-insurance extract --corpus ~/writing/     Extract voice profile
 *   voice-insurance score document.md               Score against profile
 *   voice-insurance compare profile1.json profile2.json  Compare two voices
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { collectFiles, buildProfile } from "../src/extractor.js";
import { scoreDocument } from "../src/scorer.js";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(flag) {
  return args.includes(flag);
}

function printHelp() {
  console.log(`
  voice-insurance — Forensic stylometric instrument
  Ensures AI-assisted content matches your natural voice.

  Commands:

    extract   Build a voice profile from your writing
              --corpus <dir>     Folder of .md/.txt files
              --files <f1> <f2>  Specific files
              --out <path>       Output path (default: voice-profile.json)

    score     Check a document against a voice profile
              <file>             Document to score
              --profile <path>   Profile to score against (default: voice-profile.json)
              --verbose          Show flagged items
              --fix              Show specific fixes
              --json             Raw JSON output

    compare   Compare two voice profiles side by side
              <profile1> <profile2>

  Examples:
    voice-insurance extract --corpus ~/sent-mail/
    voice-insurance score proposal.md --fix
    voice-insurance compare rob.json moser.json

  https://github.com/NorthwoodsSentinel/voice-insurance
  `);
}

// --- EXTRACT ---
function runExtract() {
  const corpusDir = getFlag("--corpus");
  const outputPath = getFlag("--out") || "voice-profile.json";
  const verbose = hasFlag("--verbose");

  const filesFlag = args.indexOf("--files");
  let specificFiles = [];
  if (filesFlag !== -1) {
    for (let i = filesFlag + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      specificFiles.push(args[i]);
    }
  }

  const files = collectFiles(corpusDir, specificFiles);
  if (files.length === 0) {
    console.error("  No files found. Use --corpus <dir> or --files <f1> <f2>");
    process.exit(1);
  }

  console.log(`\n  Extracting voice profile from ${files.length} file(s)...\n`);

  const profile = buildProfile(files);
  writeFileSync(outputPath, JSON.stringify(profile, null, 2));

  console.log(`  ✅ Voice profile extracted`);
  console.log(`  ────────────────────────────`);
  console.log(`  Sources:           ${profile.meta.sourceCount} files`);
  console.log(`  Total words:       ${profile.meta.totalWords}`);
  console.log(`  Sentences:         ${profile.sentences?.count || 0}`);
  console.log(`  Avg sentence:      ${profile.sentences?.avgLength} words`);
  console.log(`  Burstiness:        ${profile.sentences?.burstiness}%`);
  console.log(`  Fragment rate:     ${profile.sentences?.fragmentRate}%`);
  console.log(`  Em dash usage:     ${profile.vocabulary.emDashUsageRate}%`);
  console.log(`  Passive voice:     ${profile.vocabulary.passiveVoiceRate}%`);
  console.log(`  AI words avoided:  ${profile.vocabulary.neverUsedAIWords.length}/${33}`);
  console.log(`  Profile saved:     ${outputPath}`);

  if (verbose) {
    console.log(`\n  Top vocabulary:`);
    for (const w of profile.vocabulary.topWords.slice(0, 10)) {
      console.log(`    ${w.word.padEnd(20)} ${w.count}x`);
    }
  }

  console.log();
}

// --- SCORE ---
async function runScore() {
  const filePath = args.find((a, i) => i > 0 && !a.startsWith("--") && args[i - 1] !== "--profile");
  const profilePath = getFlag("--profile") || "voice-profile.json";
  const verbose = hasFlag("--verbose");
  const fixMode = hasFlag("--fix");
  const jsonOutput = hasFlag("--json");

  let rawText;
  if (filePath && existsSync(filePath)) {
    rawText = readFileSync(filePath, "utf-8");
  } else if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    rawText = Buffer.concat(chunks).toString("utf-8");
  } else {
    console.error("  No file provided. Usage: voice-insurance score <file>");
    process.exit(1);
  }

  if (!existsSync(profilePath)) {
    console.error(`  Profile not found: ${profilePath}`);
    console.error(`  Run 'voice-insurance extract' first.`);
    process.exit(1);
  }

  const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
  const { checks, finalScore, pass, threshold } = scoreDocument(rawText, profile);

  if (jsonOutput) {
    console.log(JSON.stringify({ score: finalScore, pass, checks, profile: profile.meta }, null, 2));
    process.exit(pass ? 0 : 1);
  }

  const icon = pass ? "✅" : "❌";
  const verdict = pass ? "PASS" : "FAIL";

  console.log();
  console.log(`  ${icon} VOICE SCORE: ${verdict} (${finalScore}/100)`);
  console.log(`  ════════════════════════════════════`);

  for (const check of checks) {
    const checkIcon = check.score >= 80 ? "✓" : check.score >= 50 ? "△" : "✗";
    const scoreStr = `${Math.round(check.score)}`.padStart(3);
    console.log(`  ${checkIcon} ${check.name.padEnd(22)} ${scoreStr}/100  (${check.weight}%)`);

    if ((verbose || fixMode) && check.flags.length > 0) {
      for (const flag of check.flags.slice(0, 5)) {
        console.log(`      → ${flag}`);
      }
      if (check.flags.length > 5) console.log(`      ... and ${check.flags.length - 5} more`);
    }

    if (fixMode && check.fixes.length > 0) {
      for (const fix of check.fixes.slice(0, 3)) {
        console.log(`      🔧 ${fix}`);
      }
    }
  }

  console.log();
  if (filePath) console.log(`  File:      ${filePath}`);
  console.log(`  Profile:   ${profilePath}`);
  console.log(`  Threshold: ${threshold}/100`);
  console.log();

  process.exit(pass ? 0 : 1);
}

// --- COMPARE ---
function runCompare() {
  const p1Path = args[1];
  const p2Path = args[2];

  if (!p1Path || !p2Path || !existsSync(p1Path) || !existsSync(p2Path)) {
    console.error("  Usage: voice-insurance compare <profile1.json> <profile2.json>");
    process.exit(1);
  }

  const p1 = JSON.parse(readFileSync(p1Path, "utf-8"));
  const p2 = JSON.parse(readFileSync(p2Path, "utf-8"));

  const name1 = p1.meta?.sources?.[0] || p1Path;
  const name2 = p2.meta?.sources?.[0] || p2Path;

  const metrics = [
    ["Avg sentence length", p1.sentences?.avgLength, p2.sentences?.avgLength],
    ["Burstiness", `${p1.sentences?.burstiness}%`, `${p2.sentences?.burstiness}%`],
    ["Fragment rate", `${p1.sentences?.fragmentRate}%`, `${p2.sentences?.fragmentRate}%`],
    ["Avg paragraph (sents)", p1.paragraphs?.avgSentencesPerParagraph, p2.paragraphs?.avgSentencesPerParagraph],
    ["Single-sentence ¶", `${p1.paragraphs?.distribution?.singleSentence}%`, `${p2.paragraphs?.distribution?.singleSentence}%`],
    ["Em dash usage", `${p1.vocabulary?.emDashUsageRate}%`, `${p2.vocabulary?.emDashUsageRate}%`],
    ["Contractions", `${p1.vocabulary?.contractionRate}%`, `${p2.vocabulary?.contractionRate}%`],
    ["Passive voice", `${p1.vocabulary?.passiveVoiceRate}%`, `${p2.vocabulary?.passiveVoiceRate}%`],
    ["List-to-prose", `${p1.structure?.listToProse}%`, `${p2.structure?.listToProse}%`],
    ["Top word", p1.vocabulary?.topWords?.[0]?.word, p2.vocabulary?.topWords?.[0]?.word],
  ];

  console.log();
  console.log(`  Voice Comparison`);
  console.log(`  ════════════════════════════════════════════`);
  console.log(`  ${"Dimension".padEnd(24)} ${String(name1).substring(0, 10).padEnd(12)} ${String(name2).substring(0, 10)}`);
  console.log(`  ${"─".repeat(24)} ${"─".repeat(12)} ${"─".repeat(12)}`);

  for (const [label, v1, v2] of metrics) {
    console.log(`  ${label.padEnd(24)} ${String(v1).padEnd(12)} ${v2}`);
  }

  console.log();
}

// --- MAIN ---
switch (command) {
  case "extract":
    runExtract();
    break;
  case "score":
    await runScore();
    break;
  case "compare":
    runCompare();
    break;
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;
  default:
    console.error(`  Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
