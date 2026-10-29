# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: strict TypeScript, ESLint, Prettier, Vitest, tsup and CI on Node 22 and 24.
- `receipts` CLI with documented exit codes.
- Readers for Claude Code JSONL (including sub-agent transcripts) and OpenCode-format SQLite
  sessions, normalised into one session model.
- Session discovery, including OpenCode engines embedded in other apps, and
  `receipts sessions`.
- Change sets from git (including untracked files), from a `--diff` patch, or from the
  agent's own edit records when there is no repository, plus a per-step edit timeline.
- Claim extraction: a deterministic pattern extractor and an optional free-model extractor
  (Ollama, Groq free tier, OpenRouter `:free`) with a disk cache, rate limits and a
  patterns-only fallback.
- Deterministic checkers for every claim type, with staleness that counts shell writes,
  output-aware reading of piped and chained commands, and a default configuration.
- Risk flags: edited or skipped tests, weakened assertions, lowered coverage, sensitive
  files, secrets (redacted), dangerous commands, lockfile churn, unmentioned changes, large
  diffs and ignored failures, with severity overrides.
- `receipts check` with terminal, JSON (versioned schema) and Markdown output, `--fail-on`
  and exit codes, `--turns`, config file loading, and a bundled demo that needs no keys.
- `receipts install-hook`, `receipts explain` and `receipts doctor`.
- A self-contained HTML report with light and dark themes, keyboard navigation, linkable
  state, evidence panels, a step timeline and diffs; `--format html`, `--open` and
  `receipts open`.
