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

## 2026-10-29 19:03 IST: Milestone 2, ingest

Built: the normalised session model (`src/types.ts`), a streaming Claude Code JSONL reader,
an OpenCode-format SQLite reader, discovery for both, and `receipts sessions`. Fixture tests
cover both formats; an OpenCode fixture is a compact JSON file turned into a real database
by `test/helpers/opencode-fixture.ts`.

Inspected first (structure and counts only, no content): 9 Claude Code sessions plus one
sub-agent transcript, and one OpenCode-format database with 10 sessions.

What the real data showed that the spec did not expect:

- **Request blobs repeat the conversation.** Claude Code transcripts contain
  `api-request-blob` records that carry the same `tool_use` and `text` blocks as the
  assistant lines. Counting every line with a `message.content` gave 663 Bash calls; the
  real number is 561. The reader now only reads `assistant`, `user` and `custom-title`
  records, and a fixture line pins that.
- **Sub-agents live in separate files.** The spec expected `isSidechain: true` lines inline.
  On this machine they are in `<session>/subagents/agent-<id>.jsonl`, next to the parent
  transcript. The reader loads those files, marks their steps as sidechain, and merges all
  steps in timestamp order so staleness sees one timeline. Inline sidechain lines still work.
- **Not every `is_error` Bash result is a failed command.** 18 failures start with
  `Exit code N`, but others are denied by a permission rule or blocked before running. Those
  now get `status: error`, `exitCode: null` and the note "the command did not run", so a
  denied `npm test` can never count as a test run. The text can also start with
  `Error: Exit code N` when it comes from the string form of `toolUseResult`; both parse.
- **"No is_error" does not always mean exit 0.** Background commands (`backgroundTaskId`)
  and timeouts (`timedOutAfterMs`) return immediately with no result. They are now
  `interrupted`. Results with `returnCodeInterpretation` (for example grep's "No matches
  found") had a non-zero exit that the harness chose not to flag; they get `exitCode: null`.
- **Sessions with nothing but API errors.** 4 of the 9 Claude Code sessions contain only
  synthetic API-error messages, so they have no final message. That is correct, and
  `check` will exit 3 for them.
- **One step per message, mostly.** The spec said one OpenCode assistant message holds
  several step segments. Here 648 of 649 messages hold exactly one. The reader splits at
  `step-start` either way.
- **A completed bash part can have `exit: null`.** Two real runs did. They are treated as
  interrupted, not as passes.
- **Code-mode calls are recorded twice.** The engine's `execute` tool stores its child calls
  in two metadata arrays: one with outputs under a vendor-specific key, one with only status
  under `toolCalls`. A union would double count. The generic detector keeps the single
  richest array of `{ tool, input | output }` objects. None of the child calls on this
  machine were shell or edit calls, but they are kept as evidence.
- **The database copy holds credentials.** Besides `session`, `message` and `part`, the file
  has account and credential tables with access tokens. Receipts queries only the three
  session tables, and the temp copy is deleted as soon as the reader closes it. The copy is
  opened read-write (not read-only as the spec said) so SQLite can fold the copied WAL into
  it; the live file is never opened.

Bundling bug caught before commit: tsup strips the `node:` prefix by default, and
`node:sqlite` has no un-prefixed name, so the bundled CLI crashed while the unit tests
(which run sources) passed. Fixed with `removeNodeProtocol: false`, and `npm run check` now
ends with `scripts/smoke.mjs`, which runs the built CLI against a real database.

Timing on real data (Node 25, this machine): the largest Claude Code session (768 steps,
~10k lines) parses in 180 ms; all 19 sessions parse in 0.42 s total. `receipts sessions`
over both sources, with database discovery, takes 0.37 s.
