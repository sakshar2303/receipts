# Receipts

Your agent says it's done. Check the receipts.

Receipts reads a coding agent's session (Claude Code or OpenCode) and the git diff, finds the
claims in the agent's final message, and checks each one against what actually ran.

[![CI](https://github.com/sakshar2303/receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/sakshar2303/receipts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-blue.svg)](package.json)

![The Receipts HTML report for the bundled demo session: nine claims with their verdicts, a stale test claim selected, and the evidence for a contradicted build claim open](docs/assets/report-light.png)

[Project site](https://sakshar2303.github.io/receipts/) · [Live sample report](https://sakshar2303.github.io/receipts/report.html)

## Why

Coding agents end their work with a confident summary, and part of it is often unproven: the
tests were run before the last edit, the build failed, or a file it names was never touched.
Reviewers then read long transcripts to find out what really happened. Receipts does that
reading for you: every claim gets a verdict and a link to the step, command or diff line that
decides it.

## Try it in 60 seconds, no keys

```bash
npx github:sakshar2303/receipts check demo --open
```

This checks a bundled demo session (an agent fixing a CSV parser) and opens the report. It
needs no API key. Without one, claims come from patterns and, if one is running, a local
Ollama model; add `--no-llm` to use patterns only.

On your own work, from the project folder after an agent session:

```bash
npx github:sakshar2303/receipts check latest
```

`latest` is the newest Claude Code or OpenCode session that worked in this folder. Use
`latest:claude-code` or `latest:opencode` to pick one, `receipts sessions` to list them, a
`.jsonl` path or a session id to name one, and `--db <path>` for any OpenCode-format
database. `--turns 3..5` checks part of a long session, and `--turns last` only the latest
request.

To install the command instead of using `npx`:

```bash
npm install -g --install-links github:sakshar2303/receipts
```

The `--install-links` flag matters: without it, npm 11 links a git package to a temporary
folder instead of copying it. Node 22.13 or later is required.

## What it checks

Each claim in the final message gets one of five verdicts:

| Verdict      | Meaning                                                                       |
| ------------ | ----------------------------------------------------------------------------- |
| verified     | Direct evidence supports it, and nothing later invalidates it.                |
| contradicted | Evidence shows it is false.                                                   |
| stale        | It was true at some point, but later changes broke the link.                  |
| unverified   | No evidence either way.                                                       |
| needs-review | It is about behaviour that cannot be checked mechanically. A human must look. |

Claims about tests, the build, typecheck and lint, files, dependencies and commands are
checked against exit codes, command output and the diff. A test run that passed before the
agent edited code again is stale, not verified. Claims about behaviour ("the dropdown now
feels faster") are always needs-review: a verdict never comes from a language model.

Receipts also raises flags for risks the agent may not have mentioned: an existing test file
changed, a test skipped or focused, an assertion weakened, a coverage threshold lowered, a
sensitive file touched, a secret added, a dangerous command run, lockfile churn, unmentioned
changes, a large diff, and a failing command left behind.

The details are in [docs/verdicts.md](docs/verdicts.md) and [docs/flags.md](docs/flags.md),
and `receipts explain <verdict-or-flag>` prints them.

## Screenshots

All of these are rendered from the bundled demo by `npm run screenshots`, which drives
headless Chrome over the DevTools protocol. The full report in the light theme is at the top
of this page.

![The full report in the dark theme](docs/assets/report-dark.png)

The full report in the dark theme.

![A stale claim selected: the evidence panel and the step timeline, with a passing test run at step 8 followed by edits at steps 10 to 12](docs/assets/evidence-stale.png)

The evidence for a stale claim. The timeline shows the test run that passed, then the edits
that came after it.

![The flags table with the test-skipped flag open, showing it( replaced by it.skip(](docs/assets/flags-skipped.png)

The flags table, with the `test-skipped` hunk open.

<img src="docs/assets/mobile.png" width="320" alt="The report at 390 pixels wide, with the verdict counts as rows">

The report at 390 px.

![Terminal output of receipts check on the demo: a summary, the verdict counts, one line per claim with its evidence, and the flags](docs/assets/terminal.png)

`receipts check` in a terminal.

![The Markdown output rendered as it appears in a pull request](docs/assets/markdown.png)

The Markdown output (`--format md`), ready to paste into a pull request.

## Demo

[![The demo video: the report open on the contradicted build claim, with its evidence](docs/assets/demo-poster.png)](https://sakshar2303.github.io/receipts/demo.mp4)

A 76-second narrated film of the bundled demo: an agent's confident checklist falling apart,
the report flying in, a spotlight on the contradicted build, the stale timeline drawn step by
step, a test quietly turned into `it.skip`, a blocked push, and the results.
[Watch it in 1080p60](https://sakshar2303.github.io/receipts/demo.mp4), or download the
[4K60 master](https://github.com/sakshar2303/receipts/releases/latest) from the release.

`npm run video` renders it from the demo: [scripts/video/stage.html](scripts/video/stage.html)
draws every frame as a function of time, headless Chrome captures it at 4K and 60 fps, the
best installed macOS voice reads the script, and
[scripts/video/sound.mjs](scripts/video/sound.mjs) synthesises the music and every sound
effect. Nothing in it is recorded or downloaded.

## How it works

![Five stages from left to right: ingest, normalise, extract, check and flag, report](docs/assets/architecture.svg)

1. **Ingest.** Reads Claude Code JSONL transcripts, including sub-agent transcripts, and
   OpenCode-format SQLite databases, from a temporary copy.
2. **Normalise.** Turns both into one session model of steps, tool calls, exit codes and
   edits, and reads the change set from git, from a patch, or from the agent's own edits.
3. **Extract.** Finds the claims in the final message with patterns, and optionally with a
   free local or hosted model, keeping each claim's exact position in the text.
4. **Check and flag.** A deterministic checker per claim type gives each claim a verdict and
   a reason; risk detectors raise flags.
5. **Report.** Writes the terminal summary, a self-contained HTML report, JSON with a
   published schema ([schema/receipt.schema.json](schema/receipt.schema.json)) and Markdown.

Design decisions and the reasons for them are in [docs/decisions.md](docs/decisions.md).

## Results

From `npm run eval` ([eval/results.md](eval/results.md)). The false-verified rate is the share
of claims Receipts marked verified that were not actually verified: the number this tool
exists to keep low.

|                                 | Hand-written cases, patterns |               Real sessions, patterns | Real sessions, patterns + gemma3 (local) |
| ------------------------------- | ---------------------------: | ------------------------------------: | ---------------------------------------: |
| **False-verified rate**         |             **0%** (0 of 22) |                      **0%** (0 of 54) |                         **0%** (0 of 61) |
| Verdict accuracy (claims found) |                         100% |                                 82.9% |                                    70.7% |
| Claim extraction precision      |                         100% |                                 97.2% |                                    89.2% |
| Claim extraction recall         |                         100% |                                 21.3% |                                    42.6% |
| Sample                          |       30 sessions, 43 claims | 45 turns from 16 sessions, 329 claims |                                     same |

Flags on the hand-written cases: 100% precision and recall over 17 expected flags.

**Every error is on the safe side.** On real sessions Receipts never called a claim verified
when it was not. Where its verdict was wrong, it said unverified or needs review although
the transcript held enough evidence: a test run hidden behind an unusual wrapper, a push made
by another session, or a measured number it treats as behaviour. That costs a reviewer a
look, never a false sense of safety. Recall is low because agents report most of their work
in prose ("the parser now accepts quoted commas"), which the English-only patterns rarely
match and which would be needs-review anyway.

**How the real sessions were labelled.** 45 replies (one turn each) from 16 Claude Code and
OpenCode sessions on the author's machine. An AI coding assistant labelled them first. A
second AI agent then labelled the same claims independently, without seeing the first
labels or Receipts' verdicts. The two agreed on 117 of 138 claims (Cohen's kappa 0.73), and
each disagreement was settled against the raw tool output. The author has not reviewed the
labels, so treat these numbers as provisional. Labels and transcripts stay private.

The hand-written cases cover every verdict and flag and were written alongside the code, so
they show the checks do what they are meant to; they are not an independent measure.

## CI and hooks

`--fail-on` makes the exit code depend on the verdicts:

```bash
receipts check latest --fail-on contradicted,stale
```

| Exit code | Meaning                                |
| --------- | -------------------------------------- |
| 0         | Nothing matched `--fail-on`            |
| 1         | At least one claim matched `--fail-on` |
| 2         | Usage error                            |
| 3         | Input not found or unreadable          |
| 4         | Internal error                         |

**Pre-push hook.** `receipts install-hook` writes `.git/hooks/pre-push`, which checks the
latest session for the repository and blocks the push on exit 1 only. A usage error or a
missing session never blocks a push. It asks before replacing an existing hook.

```bash
receipts install-hook --fail-on contradicted,stale
```

**GitHub Actions.** When an agent runs inside a workflow job, check its session in the same
job and put the receipt in the job summary:

```yaml
- name: Check the agent's claims
  run: |
    npx --yes github:sakshar2303/receipts check latest --no-llm --format md \
      --fail-on contradicted,stale >> "$GITHUB_STEP_SUMMARY"
```

`--format md` prints Markdown to standard output; `--format json` prints JSON. `--format all`
(the default) writes `report.html`, `report.json` and `report.md` to `--out`
(`receipts-report/`) and prints the terminal summary.

## Use it from an agent

An agent can check its own reply before it sends it.

**Skill.** [skills/receipts/SKILL.md](skills/receipts/SKILL.md) is a standard agent skill.
It tells the agent to pass its draft reply on standard input, fix every contradicted or stale
claim by fixing the work (never by rewording or weakening a test), and say which claims are
still unverified:

```bash
npx -y github:sakshar2303/receipts check latest --repo . --turns last --no-llm --format json --message - <<'DRAFT'
Fixed the empty-input crash in src/parser.ts. All tests pass.
DRAFT
```

**MCP server.** `receipts mcp` serves one tool, `check_session`, over stdio, to any
MCP-capable agent. Its arguments are `target`, `repo`, `turns` (default `last`), `message`
(the draft reply), `db` and `llm` (default off). It returns verdicts, reasons and flags, not
transcript text.

```json
{
  "mcpServers": {
    "receipts": { "command": "npx", "args": ["-y", "github:sakshar2303/receipts", "mcp"] }
  }
}
```

`receipts check --watch` re-runs the check whenever the session changes, for a second
window next to the agent.

## Configuration

Receipts reads `receipts.config.json` from the repository (or `--config <file>`). Every key
is optional; a key you set replaces its default, and under `commands` each kind is replaced
on its own. Unknown keys and invalid patterns are errors that list the valid choices.

```json
{
  "commands": {
    "test": ["^make test\\b", "^npm run test:unit\\b"]
  },
  "docFiles": ["**/*.md", "docs/**", "examples/**"],
  "sensitivePaths": ["**/.env", "infra/**", ".github/workflows/**"],
  "severity": { "large-diff": "medium", "unmentioned-change": "low" },
  "claimTypes": { "scope": false },
  "largeDiffLines": 2000,
  "unmentionedFiles": 8
}
```

| Key                  | What it controls                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands.test`      | Regular expressions for test commands, matched against one command segment after `cd`, environment variables, `npx`, `timeout` and redirections are removed. Defaults cover npm, pnpm, yarn and bun scripts, vitest, jest, mocha, pytest, unittest, go, cargo, playwright, cypress, deno, bun, `node --test`, rspec, phpunit, maven, gradle and dotnet. |
| `commands.build`     | Build commands: package scripts named `build`, vite, next, nuxt, astro, remix, tsup, webpack, rollup, esbuild, parcel, `tsc --build`, cargo, go, dotnet, gradle, make and maven.                                                                                                                                                                        |
| `commands.typecheck` | Typecheck commands: scripts such as `typecheck`, `tsc`, `vue-tsc`, mypy, pyright and `cargo check`.                                                                                                                                                                                                                                                     |
| `commands.lint`      | Lint commands: scripts named `lint`, eslint, biome, oxlint, stylelint, ruff, flake8, pylint, golangci-lint, rubocop, clippy and `prettier --check`.                                                                                                                                                                                                     |
| `commands.composite` | Scripts that run several checks at once, such as `npm run check`, `ci`, `verify` or `validate`. Their output decides each check they contain.                                                                                                                                                                                                           |
| `testFiles`          | Globs for test files, used by `tests-added`, the test flags and staleness.                                                                                                                                                                                                                                                                              |
| `docFiles`           | Globs for documentation. Edits to these never make a claim stale.                                                                                                                                                                                                                                                                                       |
| `manifests`          | Dependency manifests checked for `dependency-added` and `dependency-removed`.                                                                                                                                                                                                                                                                           |
| `claimTypes`         | Turn claim types off, for example `{ "scope": false }`. The types are listed in [docs/verdicts.md](docs/verdicts.md).                                                                                                                                                                                                                                   |
| `sensitivePaths`     | Globs that raise `sensitive-file`.                                                                                                                                                                                                                                                                                                                      |
| `severity`           | Change a flag's severity to `high`, `medium` or `low`.                                                                                                                                                                                                                                                                                                  |
| `largeDiffLines`     | The changed-line count above which `large-diff` fires. Default 1000.                                                                                                                                                                                                                                                                                    |
| `unmentionedFiles`   | How many changed code files may go unmentioned before `unmentioned-change` fires. Default 5.                                                                                                                                                                                                                                                            |

`receipts doctor` shows which sessions, models and API keys Receipts can find on the machine.

## Privacy

Receipts runs on your machine. It opens agent databases from a temporary copy and never
writes to them, reads only the session tables, and never runs a command from a transcript.
Secrets are redacted in every output.

Claims are found with patterns, and by default also with a free model: the smallest local
[Ollama](https://ollama.com) model if one is running, otherwise Groq's free tier or an
OpenRouter `:free` model if a key is set in `.env` (`GROQ_API_KEY`, `OPENROUTER_API_KEY`).
Only the final message is sent, after redaction, never the transcript or the code. Receipts
refuses paid models, and when a free tier runs out it continues with patterns only. Pass
`--no-llm` to use patterns only, with no network at all.

## Limitations

- **Behaviour needs a human.** Bug fixes, features and behaviour claims are needs-review by
  design.
- **The patterns are English-only.** A message in another language yields few claims unless a
  model is used.
- **Staleness is about files, not meaning.** An edit that cannot affect a test still makes a
  test claim stale.
- **Evidence is only as good as the transcript.** A command run outside the agent, or output
  the agent never saw, is invisible. A command whose outcome cannot be read is unverified,
  not guessed.
- **Out of scope:** running tests or builds itself, judging code quality, and agents other
  than Claude Code and OpenCode-format sessions. There is no Codex CLI reader yet.

## Development

```bash
npm install
npm run check        # typecheck, lint, build, tests and a smoke test of the built CLI
npm run eval         # score Receipts on the hand-written cases (and on labelled real sessions)
npm run label        # label real sessions locally; labels stay in eval/private/
npm run screenshots  # render the README images from the demo
```

Tests and fixtures are synthetic, written by hand; real transcripts never enter the
repository. The built CLI (`dist/receipts.js`) is committed so a GitHub install needs no
build, and CI checks it matches the source. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
rules and the project layout, [DEVLOG.md](DEVLOG.md) for what real data taught us, and
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © Sakshar Dhawan
