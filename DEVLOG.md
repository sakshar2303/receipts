# Devlog

Timestamped notes for each milestone: what was built, what the real data showed, and
what changed because of it. Times are IST.

## 2026-10-29 18:48 IST: Milestone 1, scaffold

Built: package setup, strict TypeScript, ESLint (type-aware) with Prettier, Vitest, tsup
bundling into one CLI file, CI on Node 22 and 24, and a placeholder `receipts` command that
prints help with examples and exit codes.

What this machine looked like before any code:

- Node 25.9, npm 11.12, git 2.54. CI covers the supported LTS lines (22 and 24); local runs
  on 25 are a useful forward check.
- Ollama is installed with general-purpose models only, no coder model. So the LLM
  extractor must pick its default from `ollama list`, not from a hardcoded name.
- Seven Claude Code project folders under `~/.claude/projects`.
- No database at the plain OpenCode path. One OpenCode-format database exists inside
  another desktop app's dot-folder, at `<dot-folder>/**/share/opencode/opencode.db`. This
  confirms the spec's call for vendor-neutral discovery instead of a single fixed path.
- No `~/.codex/sessions`, so the Codex reader (a should-have) will be skipped.

Spec changes, agreed before coding:

- Engines set to Node `>=22.13`, where `node:sqlite` is unflagged.
- TypeScript pinned to 6.0: the latest TypeScript (7) is outside typescript-eslint's
  supported range.
- `dotenv` and the `openai` SDK dropped in favour of Node built-ins (see
  `docs/decisions.md`).
- Real-session eval runs without hosted LLMs (`--no-llm` or local Ollama only), so no real
  transcript text leaves the machine.
- OpenCode discovery under `~/.*` will get a skip list and a time budget, because some
  dot-folders (package caches, model stores) are very large.
- The Markdown screenshot will come from the rendered Markdown inside the report unless a
  GitHub-rendered one is explicitly wanted later.

CI note: the smoke step runs `--help` for now. It switches to
`receipts check demo --no-llm --format all` once the demo fixture exists.
