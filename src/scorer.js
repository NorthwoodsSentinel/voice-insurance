/**
 * Voice scorer — checks a document against a voice profile
 */

import { extractSentences, extractParagraphs, wordCount } from "./extractor.js";

// Enhanced strip that handles structural formatting better than the extractor's version
function stripForScoring(text) {
  return text
    .replace(/^---[\s\S]*?---\n*/m, "")           // frontmatter
    .replace(/^#{1,6}\s+.*$/gm, "")               // headers
    .replace(/\|.*\|/g, "")                        // table rows
    .replace(/[-|:]+\s*[-|:]+/g, "")               // table separators
    .replace(/\*\*([^*]+)\*\*/g, "$1")             // bold
    .replace(/\*([^*]+)\*/g, "$1")                 // italic
    .replace(/^\s*[-*•]\s+/gm, "")                 // bullet markers (content stays as prose)
    .replace(/^\d+\.\s+/gm, "")                    // numbered list markers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")       // links
    .replace(/`[^`]+`/g, "")                       // inline code
    .replace(/```[\s\S]*?```/g, "")                // code blocks
    .replace(/>\s*/g, "")                          // blockquotes
    .replace(/\s—\s/g, ". ")                       // structural em dashes → periods
    .replace(/—\s/g, ". ")                         // em dash at start of clause
    .replace(/\s—$/gm, ".")                        // em dash at end of line
    .replace(/—/g, ", ")                           // remaining em dashes → commas (mid-word asides)
    .replace(/\n{3,}/g, "\n\n")                    // excess newlines
    .trim();
}

const AI_FILLER_WORDS = [
  "certainly", "indeed", "furthermore", "moreover", "additionally",
  "it's worth noting", "in today's landscape", "in conclusion",
  "it is important to note", "based on the analysis", "comprehensive",
  "robust", "holistic", "cutting-edge", "innovative", "best-in-class",
  "paradigm", "utilize", "leverage", "synergize", "stakeholders",
  "delve", "tapestry", "multifaceted", "nuanced", "streamline",
  "facilitate", "endeavor", "aforementioned", "subsequently",
  "in summary", "to summarize", "as previously mentioned"
];

const FILLER_OPENERS = [
  "certainly,", "indeed,", "absolutely,", "great question",
  "here is the", "here's the", "in today's", "it's worth noting",
  "it is important", "based on the analysis", "based on our analysis"
];

const HEDGE_PHRASES = [
  "it appears that", "it could be argued", "it seems that",
  "it is possible that", "one might say", "it is worth considering",
  "it may be the case", "to some extent", "it is generally accepted"
];

function checkBannedWords(text, profile) {
  const neverUsed = profile.vocabulary?.neverUsedAIWords || AI_FILLER_WORDS;
  const flags = [];
  const fixes = [];

  for (const word of neverUsed) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "gi");
    const matches = text.match(regex);
    if (matches) {
      flags.push(`"${word}" found ${matches.length}x`);
      fixes.push(`Remove "${word}" — this author never uses it.`);
    }
  }

  const score = flags.length === 0 ? 100 : Math.max(0, 100 - flags.length * 15);
  return { name: "Banned words", weight: 15, score, flags, fixes };
}

function checkFillerOpeners(text) {
  const sentences = extractSentences(text);
  const flags = [];
  const fixes = [];

  for (const s of sentences) {
    const lower = s.toLowerCase();
    for (const opener of FILLER_OPENERS) {
      if (lower.startsWith(opener)) {
        flags.push(`Opens with "${s.substring(0, 50)}..."`);
        fixes.push(`Rewrite: "${s.substring(0, 60)}..." — cut the filler, lead with the point.`);
        break;
      }
    }
  }

  const rate = sentences.length > 0 ? (flags.length / sentences.length) * 100 : 0;
  const score = rate === 0 ? 100 : Math.max(0, 100 - rate * 20);
  return { name: "Filler openers", weight: 10, score, flags, fixes };
}

function checkSentenceLength(text, profile) {
  const sentences = extractSentences(text);
  const lengths = sentences.map(s => wordCount(s));
  const flags = [];
  const fixes = [];

  if (lengths.length === 0) return { name: "Sentence length", weight: 15, score: 100, flags: [], fixes: [] };

  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const target = profile.scoring?.sentenceLength?.target || { min: 8, max: 22 };
  const profileAvg = profile.sentences?.avgLength || 14;

  if (avg < target.min || avg > target.max) {
    flags.push(`Avg sentence length ${avg.toFixed(1)} words (target: ${target.min}-${target.max})`);
    fixes.push(`Adjust sentence length — profile averages ${profileAvg} words.`);
  }

  const maxConsec = profile.scoring?.maxConsecutiveLong || 3;
  let currentRun = 0;
  let maxRun = 0;
  for (const l of lengths) {
    if (l > 20) { currentRun++; maxRun = Math.max(maxRun, currentRun); }
    else currentRun = 0;
  }

  if (maxRun >= maxConsec) {
    flags.push(`${maxRun} consecutive long sentences (max: ${maxConsec - 1})`);
    fixes.push(`Break up the long run — insert a short punch sentence.`);
  }

  const profileBurstiness = profile.sentences?.burstiness || 30;
  let bursts = 0;
  for (let i = 1; i < lengths.length; i++) {
    if (Math.abs(lengths[i] - lengths[i - 1]) > 10) bursts++;
  }
  const docBurstiness = Math.round((bursts / Math.max(lengths.length - 1, 1)) * 100);

  if (docBurstiness < profileBurstiness - 15) {
    flags.push(`Low burstiness: ${docBurstiness}% (profile: ${profileBurstiness}%)`);
    fixes.push(`Rhythm is too uniform. Vary sentence lengths more.`);
  }

  const score = Math.max(0, 100 - flags.length * 20);
  return { name: "Sentence length", weight: 15, score, flags, fixes };
}

function checkParagraphStructure(text, profile) {
  const paragraphs = extractParagraphs(text);
  const flags = [];
  const fixes = [];

  if (paragraphs.length < 3) return { name: "Paragraph structure", weight: 10, score: 100, flags: [], fixes: [] };

  const sentenceCounts = paragraphs.map(p => extractSentences(p).length);
  const maxParagraph = profile.scoring?.paragraphLength?.maxSentences || 6;

  const longParas = sentenceCounts.filter(c => c >= maxParagraph);
  if (longParas.length > 0) {
    flags.push(`${longParas.length} paragraph(s) with ${maxParagraph}+ sentences`);
    fixes.push(`Break long paragraphs — profile averages ${profile.paragraphs?.avgSentencesPerParagraph || 3} sentences.`);
  }

  const uniqueLengths = new Set(sentenceCounts);
  if (uniqueLengths.size <= 2 && paragraphs.length > 5) {
    flags.push(`Paragraph lengths too uniform`);
    fixes.push(`Vary paragraph length — mix 1-sentence punches with longer blocks.`);
  }

  const maxTopicFirst = profile.scoring?.topicSentenceFirstMax || 80;
  const topicFirst = paragraphs.filter(p => {
    const first = p.split(/[.!?]/)[0]?.trim() || "";
    return !/^(But|And|When|If|However|Although|While|Since|Because|Or|Yet|So)\s/i.test(first)
      && !/^["']/.test(first) && first.length > 20;
  }).length;
  const topicFirstRate = Math.round((topicFirst / paragraphs.length) * 100);

  if (topicFirstRate > maxTopicFirst) {
    flags.push(`Topic-sentence-first rate ${topicFirstRate}% (max: ${maxTopicFirst}%)`);
    fixes.push(`Lead some paragraphs with context, not the conclusion.`);
  }

  const score = Math.max(0, 100 - flags.length * 15);
  return { name: "Paragraph structure", weight: 10, score, flags, fixes };
}

function checkHedging(text) {
  const flags = [];
  const fixes = [];

  for (const hedge of HEDGE_PHRASES) {
    const regex = new RegExp(hedge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "gi");
    const matches = text.match(regex);
    if (matches) {
      flags.push(`"${hedge}" found ${matches.length}x`);
      fixes.push(`Replace "${hedge}" with a direct assertion.`);
    }
  }

  const score = flags.length === 0 ? 100 : Math.max(0, 100 - flags.length * 20);
  return { name: "Hedge clusters", weight: 5, score, flags, fixes };
}

function checkPassiveVoice(text, profile) {
  const sentences = extractSentences(text);
  const passivePattern = /\b(was|were|been|being|is|are)\s+([\w]+ed|[\w]+en)\b/gi;
  const flags = [];
  const fixes = [];

  const passiveMatches = text.match(passivePattern) || [];
  const rate = sentences.length > 0 ? Math.round((passiveMatches.length / sentences.length) * 100) : 0;
  const maxRate = profile.scoring?.passiveVoiceMax || 15;

  if (rate > maxRate) {
    flags.push(`Passive voice rate ${rate}% (max: ${maxRate}%)`);
    fixes.push(`Convert passive to active: "was developed" → "I built".`);
  }

  const score = rate <= maxRate ? 100 : Math.max(0, 100 - (rate - maxRate) * 5);
  return { name: "Passive voice", weight: 5, score, flags, fixes };
}

function checkAITriple(rawText) {
  const lines = rawText.split("\n");
  const flags = [];
  const fixes = [];

  const bulletLines = [];
  for (const line of lines) {
    const match = line.match(/^\s*[-*•]\s+(.+)/);
    if (match) {
      bulletLines.push(match[1].trim());
    } else if (line.trim().length > 0 && bulletLines.length >= 3) {
      checkRun(bulletLines, flags, fixes);
      bulletLines.length = 0;
    } else if (line.trim().length === 0 && bulletLines.length >= 3) {
      checkRun(bulletLines, flags, fixes);
      bulletLines.length = 0;
    } else if (line.trim().length > 0) {
      bulletLines.length = 0;
    }
  }
  if (bulletLines.length >= 3) checkRun(bulletLines, flags, fixes);

  const score = flags.length === 0 ? 100 : Math.max(0, 100 - flags.length * 25);
  return { name: "AI triple", weight: 5, score, flags, fixes };
}

function checkRun(bullets, flags, fixes) {
  const starters = bullets.map(b => {
    const firstWord = b.split(/\s/)[0]?.toLowerCase() || "";
    if (/^(ensure|create|deploy|monitor|identify|assess|evaluate|review|implement|establish|develop|provide|support|manage|build|design|enable|deliver|discover|enforce)s?$/i.test(firstWord)) return "verb";
    if (/^(the|a|an|our|their|this|that|each|every|all|no)$/i.test(firstWord)) return "article";
    return "other";
  });

  for (let i = 0; i <= starters.length - 3; i++) {
    if (starters[i] === starters[i + 1] && starters[i + 1] === starters[i + 2] && starters[i] === "verb") {
      flags.push(`3+ verb-led bullets: "${bullets[i].substring(0, 40)}..."`);
      fixes.push(`Vary bullet structure — start one with a noun phrase or rewrite as prose.`);
      break;
    }
  }
}

function checkBulletWalls(rawText, profile) {
  const lines = rawText.split("\n");
  const maxRun = profile.scoring?.maxConsecutiveBullets || 7;
  const flags = [];
  const fixes = [];

  let currentRun = 0;
  let runStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[-*•]\s/.test(lines[i])) {
      if (currentRun === 0) runStart = i;
      currentRun++;
    } else if (lines[i].trim().length > 0) {
      if (currentRun >= maxRun) {
        flags.push(`${currentRun} consecutive bullets at line ${runStart + 1}`);
        fixes.push(`Break the bullet wall — insert prose after 5-6 bullets.`);
      }
      currentRun = 0;
    }
  }
  if (currentRun >= maxRun) {
    flags.push(`${currentRun} consecutive bullets at line ${runStart + 1}`);
    fixes.push(`Break the bullet wall — insert prose after 5-6 bullets.`);
  }

  const score = flags.length === 0 ? 100 : Math.max(0, 100 - flags.length * 20);
  return { name: "Bullet walls", weight: 5, score, flags, fixes };
}

function checkVoiceConformance(text, rawText, profile) {
  const flags = [];
  const fixes = [];
  let deductions = 0;

  const sentences = extractSentences(text);
  const paragraphs = extractParagraphs(text);

  // Em dash conformance — structural dashes already converted by stripForScoring
  // Only real stylistic em dashes remain in the scored text
  const profileEmDashRate = profile.vocabulary?.emDashUsageRate || 0;
  const docEmDashes = (text.match(/—/g) || []).length;
  const docEmDashRate = sentences.length > 0 ? Math.round((docEmDashes / sentences.length) * 100) : 0;
  const emDashDiff = Math.abs(docEmDashRate - profileEmDashRate);
  if (emDashDiff > 10) {
    flags.push(`Em dash usage ${docEmDashRate}% vs profile ${profileEmDashRate}%`);
    fixes.push(docEmDashRate < profileEmDashRate
      ? `Add em dashes — profile uses them in ${profileEmDashRate}% of sentences.`
      : `Reduce em dashes — profile uses ${profileEmDashRate}%, you're at ${docEmDashRate}%.`);
    deductions += Math.min(emDashDiff - 8, 25);
  }

  // Contraction rate — count both apostrophe styles + informal no-apostrophe contractions
  const profileContractionRate = profile.vocabulary?.contractionRate || 3;
  const formalContractions = text.match(/\b\w+['']\w+\b/g) || [];  // don't, don't (both quote types)
  const informalContractions = text.match(/\b(dont|cant|wont|isnt|wasnt|doesnt|didnt|wouldnt|couldnt|shouldnt|hasnt|havent|hadnt|im|ive|ill|youre|youve|youll|theyre|theyve|theyll|weve|were|wed|hes|shes|its|thats|whats|whos|wheres|hows|aint)\b/gi) || [];
  const allContractions = formalContractions.length + informalContractions.length;
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  const docContractionRate = totalWords > 0 ? Math.round((allContractions / totalWords) * 10000) / 100 : 0;
  const contractionDiff = Math.abs(docContractionRate - profileContractionRate);
  if (contractionDiff > 3) {
    flags.push(`Contraction rate ${docContractionRate}% vs profile ${profileContractionRate}%`);
    fixes.push(docContractionRate < profileContractionRate
      ? `Use more contractions — write "don't" not "do not", or even "dont" if it's casual.`
      : `Fewer contractions — profile uses ${profileContractionRate}%.`);
    deductions += Math.min(contractionDiff * 3, 20);
  }

  // Smart quote detection — AI/word processors use curly quotes, humans type straight ones
  const smartQuotes = (rawText.match(/[\u2018\u2019\u201C\u201D]/g) || []).length;
  const straightQuotes = (rawText.match(/['"]/g) || []).length;
  const totalQuotes = smartQuotes + straightQuotes;
  if (totalQuotes > 3 && smartQuotes > straightQuotes) {
    const smartRate = Math.round((smartQuotes / totalQuotes) * 100);
    flags.push(`Smart quotes ${smartRate}% — AI/word processor artifact`);
    fixes.push(`Replace curly quotes (\u2018\u2019\u201C\u201D) with straight ones ('"). Human typing uses straight quotes.`);
    deductions += Math.min(Math.round(smartRate / 5), 15);
  }

  // List-to-prose ratio
  const lines = rawText.split("\n");
  const bulletLines = lines.filter(l => /^\s*[-*•]\s/.test(l)).length;
  const totalContentLines = lines.filter(l => l.trim().length > 0).length;
  const docListRate = totalContentLines > 0 ? Math.round((bulletLines / totalContentLines) * 100) : 0;
  const profileListRate = profile.structure?.listToProse || 0;
  const listDiff = Math.abs(docListRate - profileListRate);
  if (listDiff > 20) {
    flags.push(`List ratio ${docListRate}% vs profile ${profileListRate}%`);
    fixes.push(docListRate > profileListRate
      ? `Too many lists — convert some bullets to prose.`
      : `Add structure — profile uses ${profileListRate}% lists.`);
    deductions += Math.min(listDiff - 15, 25);
  }

  // Single-sentence paragraph rate
  if (paragraphs.length > 5) {
    const profileSingleRate = profile.paragraphs?.distribution?.singleSentence || 20;
    const docSingleRate = Math.round((paragraphs.filter(p => extractSentences(p).length <= 1).length / paragraphs.length) * 100);
    const singleDiff = Math.abs(docSingleRate - profileSingleRate);
    if (singleDiff > 18) {
      flags.push(`Single-sentence ¶ rate ${docSingleRate}% vs profile ${profileSingleRate}%`);
      fixes.push(docSingleRate < profileSingleRate
        ? `Add single-sentence impact paragraphs.`
        : `Too many one-liners — profile uses ${profileSingleRate}%.`);
      deductions += Math.min(singleDiff - 15, 20);
    }
  }

  // Average sentence length (tight check)
  if (sentences.length > 10) {
    const profileAvg = profile.sentences?.avgLength || 14;
    const docAvg = sentences.reduce((sum, s) => sum + wordCount(s), 0) / sentences.length;
    const avgDiff = Math.abs(docAvg - profileAvg);
    if (avgDiff > 4) {
      flags.push(`Avg sentence ${docAvg.toFixed(1)} vs profile ${profileAvg}`);
      fixes.push(`Target ${profileAvg} words per sentence.`);
      deductions += Math.min((avgDiff - 3) * 5, 25);
    }
  }

  // Information density — meaning per word
  // Detect padding: filler phrases, redundant qualifiers, saying-the-same-thing-twice
  if (sentences.length > 5) {
    const paddingPatterns = [
      /\bin terms of\b/gi,
      /\bin order to\b/gi,
      /\bdue to the fact that\b/gi,
      /\bit is worth noting that\b/gi,
      /\bwith respect to\b/gi,
      /\bin the context of\b/gi,
      /\bfor the purpose of\b/gi,
      /\bat this point in time\b/gi,
      /\bin the event that\b/gi,
      /\bas a result of\b/gi,
      /\bwith regard to\b/gi,
      /\bin light of\b/gi,
      /\bgoing forward\b/gi,
      /\bmoving forward\b/gi,
      /\bat the end of the day\b/gi,
      /\bneedless to say\b/gi,
      /\bit goes without saying\b/gi,
      /\bthe fact that\b/gi,
      /\bin this regard\b/gi,
      /\bplease don't hesitate\b/gi,
      /\bwe look forward to\b/gi,
      /\bI would like to\b/gi,
      /\bI wanted to follow up\b/gi,
      /\bthank you for taking the time\b/gi,
      /\bas (?:we )?mentioned (?:during|in|above|earlier|previously)\b/gi,
      /\bit was a productive\b/gi,
      /\bwe are committed to\b/gi,
      /\bwe believe that\b/gi,
      /\bwe understand that\b/gi,
      /\bpositions us well\b/gi,
      /\bthe opportunity to\b/gi,
      /\bensuring minimal disruption\b/gi,
    ];

    // Redundancy: adjective-noun pairs that say nothing
    const fluffPairs = [
      /\bunique combination\b/gi,
      /\bextensive experience\b/gi,
      /\bcritical priority\b/gi,
      /\bdetailed overview\b/gi,
      /\bactionable insights?\b/gi,
      /\bkey (?:points?|takeaways?|considerations?)\b/gi,
      /\bcore (?:capabilities|competencies|strengths)\b/gi,
      /\bstrategic (?:initiative|approach|direction|alignment)\b/gi,
      /\bseamless (?:integration|transition|experience)\b/gi,
      /\bindustry[- ]leading\b/gi,
      /\bworld[- ]class\b/gi,
      /\bdeep (?:expertise|knowledge|understanding)\b/gi,
      /\bbroad (?:range|spectrum|array)\b/gi,
      /\bproven (?:track record|methodology|approach)\b/gi,
      /\bmeaningful (?:impact|results|outcomes|progress)\b/gi,
    ];

    let paddingHits = 0;
    for (const p of [...paddingPatterns, ...fluffPairs]) {
      const matches = text.match(p);
      if (matches) paddingHits += matches.length;
    }

    // Density score: padding hits per 100 words
    const paddingRate = (paddingHits / Math.max(totalWords, 1)) * 100;

    if (paddingRate > 0.5) {
      flags.push(`Information density low: ${paddingHits} padding phrases in ${totalWords} words (${paddingRate.toFixed(1)} per 100)`);
      fixes.push(`Cut the padding. Say it once, mean it, move on.`);
      deductions += Math.min(paddingHits * 5, 40);
    }
  }

  const score = Math.max(0, 100 - deductions);
  return { name: "Voice conformance", weight: 30, score, flags, fixes };
}

export function scoreDocument(rawText, profile) {
  const text = stripForScoring(rawText);
  const PASS_THRESHOLD = 81;

  const checks = [
    checkBannedWords(text, profile),        // 15%
    checkFillerOpeners(text),               // 10%
    checkSentenceLength(text, profile),     // 15%
    checkParagraphStructure(text, profile), // 10%
    checkHedging(text),                     // 5%
    checkPassiveVoice(text, profile),       // 5%
    checkAITriple(rawText),                 // 5%
    checkBulletWalls(rawText, profile),     // 5%
    checkVoiceConformance(text, rawText, profile), // 30%
  ];

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const weightedScore = checks.reduce((sum, c) => sum + (c.score * c.weight / 100), 0);
  const finalScore = Math.round((weightedScore / totalWeight) * 100);
  const pass = finalScore >= PASS_THRESHOLD;

  return { checks, finalScore, pass, threshold: PASS_THRESHOLD };
}
