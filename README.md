# Voice Insurance

Forensic stylometric instrument that ensures AI-assisted content matches your natural voice.

Not an AI detector. A **voice conformance system.** It doesn't ask "is this AI?" — it asks "does this sound like you?"

## How it works

1. Feed it your writing — emails, docs, blog posts, anything you wrote before AI
2. It extracts your stylometric fingerprint — sentence patterns, vocabulary, paragraph structure
3. Score any document against your profile — pass/fail with specific fixes

## Install

```bash
npx voice-insurance --help
```

## Usage

### Extract your voice profile

```bash
# From a folder of your writing
voice-insurance extract --corpus ~/sent-mail/

# From specific files
voice-insurance extract --files essay.md report.md email.txt

# Custom output path
voice-insurance extract --corpus ~/writing/ --out my-voice.json
```

**Best corpus:** Your Gmail sent folder (Google Takeout export). Personal emails are unperformed, unedited, pre-AI. That's who you actually sound like.

### Score a document

```bash
# Basic pass/fail
voice-insurance score document.md

# See what to fix
voice-insurance score document.md --fix

# Show all flags
voice-insurance score document.md --verbose

# Custom profile
voice-insurance score document.md --profile my-voice.json

# JSON output for pipelines
voice-insurance score document.md --json
```

### Compare two voices

```bash
voice-insurance compare alice.json bob.json
```

## What it checks

| Check | Weight | What it catches |
|-------|--------|----------------|
| Banned words | 20% | AI filler: "robust," "comprehensive," "utilize" |
| Filler openers | 10% | "Certainly," "In conclusion," "It's worth noting" |
| Sentence length | 15% | Rhythm, burstiness, consecutive long sentences |
| Paragraph structure | 10% | Uniformity, topic-sentence-first rate |
| Hedge clusters | 10% | "It appears that," "it could be argued" |
| Passive voice | 5% | "was developed" vs "I built" |
| AI triple | 10% | 3+ bullets with identical grammatical structure |
| Bullet walls | 10% | 7+ consecutive bullets without prose |
| Voice conformance | 20% | Em dashes, contractions, list ratio, paragraph density |

Score >= 81 = PASS. Below 81 = rewrite. The threshold is calibrated to the score of a real document that passed expert human review.

## Why

Every professional using AI to write has this problem. Your clients, colleagues, and reviewers know what you sound like. When a document doesn't match, they notice — even if they can't articulate why.

AI detectors ask the wrong question. "Is this AI?" gets less useful as models improve. "Does this sound like you?" gets more useful as your profile deepens.

The corpus is the moat. Every user's voice is unique.

## License

MIT

---

## Northwoods Sentinel Labs

Part of the [Northwoods Sentinel Labs](https://northwoodssentinel.com) ecosystem — open-source tools for human-centered AI.

[Blog](https://northwoodssentinel.com) · [Substack](https://substack.com/@chewvala) · [GitHub](https://github.com/NorthwoodsSentinel)
