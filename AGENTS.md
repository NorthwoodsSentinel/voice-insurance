# AGENTS.md — voice-insurance

Rules for any agent (or person) changing this repo. The shape and most of the wording come from the
`modelcontextprotocol/inspector` AGENTS.md (branch v2/main, commit d330df9617e44ec893bc1a53618662239342d433), as the
maintainer ruled on it. Where the source's way and ours differ, **the source's way stands until there is a reason to
depart**; every departure below says why.

`CLAUDE.md` contains only `@./AGENTS.md`. Keep one copy of these rules: two copies are strictly worse than one,
because the stale copy is indistinguishable from the live one.

## What this is

A public, zero-runtime-dependency Node command-line tool, written in JavaScript (ES modules). `extract` reads a
folder or list of writing samples (`.md`, `.txt`, `.mdx`, `.eml`) and writes a stylometric voice profile as JSON;
`score` checks a document against a profile and prints a weighted 0-100 score with PASS/FAIL (exit 0/1); `compare`
prints two profiles side by side. `README.md` is the user-facing description.

**It reads local files and prints; it never calls a model, a service or the network.** Keep it that way: a change
that adds a network call, a model call or code execution is a decision made explicitly in the issue, never a side
effect of a refactor.

**Writing samples are personal.** Tests, fixtures and examples use synthetic text written for the purpose, never a
real person's writing, and never a profile extracted from one.

## The output is the interface (read this before touching the source)

Users act on the printed score and its exit code, and keep profile JSON on disk, so the report text, the JSON shapes
and the numbers are the contract. The tests pin them on synthetic fixtures. A change to a pinned number, flag or line
of output is a behavior change: it needs an issue that asks for it, and the PR says so.

The CLI does its work at import time. Tests run it in-process through `test/helpers/run-cli.js` (argv in, console
captured, `process.exit` turned into a thrown error, optional fake stdin) so coverage can measure it. Do not
restructure the CLI just to make testing easier.

## Project structure

- `bin/cli.js` — the command-line entry point (`extract`, `score`, `compare`).
- `src/extractor.js` — corpus collection, text cleanup and the profile.
- `src/scorer.js` — the nine checks and the weighted verdict.
- `test/` — Vitest suites (`*.test.js`), `test/helpers/run-cli.js`, and `test/fixtures/` (synthetic corpus and
  documents; editing one changes pinned numbers).
- `scripts/check-coverage-scope.mjs` — gate tooling.

The npm package holds `bin/`, `src/` and `README.md` (`files` in `package.json`), plus `package.json` and
`LICENSE`, which npm always includes (`npm pack --dry-run` lists them).

## Development setup

- `npm ci`. Tooling runs on npm, the source's runner. The tool itself needs no install step and declares Node
  `>=18`; the development tooling was measured on Node 22, which CI uses.
- Tests run on Vitest with `@vitest/coverage-v8`, the source's choice.
- No account or secret is needed. Installing the dependencies (`npm ci`) uses the network; after that, no gate step
  does. Tests write their files to a temp directory; the coverage run writes `coverage/` (git-ignored).

## Issue-driven work style

- **Before starting work, find the issue.** Every change has one. Before filing a new one, search for a match:
  **never create a duplicate**.
- **`Todo` means the maintainer approved it, and only the maintainer moves an issue into `Todo`.** `Backlog` is
  filed, not approved. Start work only on an approved issue.
- **Label by type: exactly one of `bug` / `enhancement` / `documentation` / `chore` / `question`.**
- **`Done` means the work shipped** (its PR merged) and was verified. Anything else is canceled, not done.
- **When work begins**, assign yourself, set the issue In Progress, and create the branch **in a new git worktree**,
  never by switching branches in a checkout another session may share.
- **When work is complete**, run `npm run format` then `npm run local:gate`, **sign off every commit**
  (`git commit -s`), open a PR with **the issue reference as the body's first line**, and set the issue In Review.
- **After opening a PR, run a Codex review loop** (`codex exec --sandbox read-only`), unprompted. Stop on the
  **first** clean round. **Weigh each finding against the issue the PR closes and decline scope expansion.** Two
  failed rounds in a row: stop, leave the PR open, list the findings in it. (Departure: the source uses Copilot; the
  maintainer chose Codex as the off-lineage reviewer.)
- **If new tasks are discovered during development, file issues** rather than widening the PR.
- **Pace bulk GitHub writes: 1 s between requests, never in parallel**, under 80 a minute and 500 an hour.
- **A security issue stays private until its fix is ready**; accepting or publishing an advisory is outward-facing
  and stays human-gated, never automated.
- **This repo is public. Merging is the maintainer's act**, and nothing personal goes into a commit, PR or test
  (home paths, emails, names, tokens, writing samples).
- **Releases are human-gated.** No agent publishes, tags or releases, and no workflow does.

### Responding to code reviews

- Judge each suggestion against the issue the PR closes. Fix defects in what the PR added; decline, with a reason,
  what expands it; file an issue for anything worth doing on its own.
- Reply in each review comment's own thread (a rollup comment does not discharge it), then post a summary in
  addition.

## Always test new or modified code

- **Every source file must clear ≥ 90 on all four dimensions (lines, statements, functions, branches), per file**,
  enforced by `vitest.config.js` and therefore by `npm test`, `npm run local:gate` and CI. This is the source's bar.
  **Never lower the threshold to pass.**
- Coverage `include` names the source files by exact path (`bin/cli.js`, `src/extractor.js`, `src/scorer.js`),
  never a glob. A new source file is added to that list, and to `EXPECTED` in `scripts/check-coverage-scope.mjs`, in
  the same change.
- Measured on 2026-11-16 (statements / branches / functions / lines): `bin/cli.js` 99.15 / 100 / 100 / 99.13,
  `src/extractor.js` 100 / 96.1 / 100 / 100, `src/scorer.js` 100 / 97.61 / 100 / 100. No coverage exclusions.
- Coverage exclusions, if one is ever needed, are exact paths, one per entry, each with a reason and a follow-up
  issue; never a glob that could hide a new file.
- **A genuinely-unreachable branch is annotated at the source** (`/* v8 ignore next -- <reason> */`), never waved
  through by lowering the gate.
- **A gate must show how much it checked.** `scripts/check-coverage-scope.mjs` runs after the tests and fails unless
  coverage measured exactly the three source files, each with non-zero statements, functions and branches, each
  figure ≥ 90. Fix a mismatch by fixing the lists, never by excusing the file.
- Test files are listed by exact path in `vitest.config.js`; the config refuses to start if a listed file is
  missing, and a test file that is not listed does not run. Add a new test file to that list in the same change.
- A test that races is fixed with fake timers or an awaited condition, never with a longer timeout.

## Mandatory pre-push gate

- **ALWAYS run `npm run format` before committing.**
- **`npm run local:gate` is the mandatory pre-push command.** It runs every check CI runs: `format:check`, `lint`,
  `typecheck` and `test` (Vitest with the coverage bar, then the coverage-scope check).
- `typecheck` is `tsc -p jsconfig.json`: TypeScript checking the JavaScript (`checkJs`, not strict). Departure: the
  source is TypeScript; this repo stays JavaScript, so the type check runs over the JS instead.
- There is deliberately no `ci` script (the name collides with the package-manager built-in). CI runs the four
  stages directly and never calls a `local:*` script.
- Departures, each for a stated reason: no gate lease (the gate takes seconds and binds no ports); no DCO check job
  (adding a required-check ruleset is a repository setting, the maintainer's to change); no smoke stage beyond the
  CLI tests (they already drive all three commands end to end on the fixtures).

## Waiting on long-running work

**When you are waiting for something to finish, arm a notifier and stop. Never spend turns polling.** For state the
harness cannot observe (a CI run, a remote review), poll inside one backgrounded loop that exits when the condition
holds, at 30 s or more.

## Build output is never a gate target

**No gate (lint, format or typecheck) may read generated output.** Out of scope: `node_modules/`, `coverage/`,
`.scratch/`, `package-lock.json`. Each scope states it: `globalIgnores` in `eslint.config.js`, `.prettierignore`
(which also inherits `.gitignore`), and the `include` list in `jsconfig.json`. **When a build starts writing to a new
location, add it to the ignore lists in the same change.** Never widen an ignore to silence a finding in first-party
code. Markdown is also outside the format scope: prettier rewrites prose, and the fixtures' exact text is pinned.

## Lint has no warning tier

**`lint` runs with `--max-warnings 0`, so a warning fails the gate exactly as an error does.** Rules: ESLint
recommended, with `_`-prefixed names allowed as unused.

- **Do not silence a finding to satisfy the gate.** If a rule genuinely must be waived on one line, use its inline
  disable comment **with a one-line justification**. Dropping a rule or widening an ignore to make `lint` pass is
  not a fix. There are no inline disables today.

## JavaScript

- JavaScript (ES modules) for all code; the maintainer ruled this repo stays JavaScript. Departure from the source's
  "TypeScript for all new code" for that reason.
- No floating promises: `await` them, or `void` them with a comment saying why.
- Every new JavaScript file and workflow starts with a header comment saying what it is for and why (the three
  source files already open with one). JSON, Markdown, the fixtures and the lockfile carry none.
- A rule about what the code does is asserted at runtime in a test, not read out of the source.
