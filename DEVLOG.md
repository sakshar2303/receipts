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

## 2026-10-29 20:53 IST: Milestone 3, diff

Built: a unified diff parser (git and plain `diff -u`, renames, binary files, quoted and
non-UTF-8 paths, CRLF), a git source that spawns git with argument arrays only, `--diff`
patch files, a per-step edit timeline, and the not-a-repo fallback that rebuilds an
approximate diff from the agent's own edit calls with the notice "No git diff available.
Using the agent's own edit records."

Things that only showed up while building or on real data:

- **`git diff HEAD` misses new files.** Files the agent created are usually untracked, and
  `git diff <ref>` ignores untracked files. Each untracked file is now diffed against
  `/dev/null` so it appears as added. Without this, "Created docs/api.md" would have been
  contradicted on every repository where the agent did not `git add`.
- **Old sessions compared against today's working tree.** On real data, a past OpenCode
  session that edited 0 files showed 15 changed files, and one that edited 25 showed 76: the
  default range ran from the session start to the current working tree, so it swept in every
  later session's work. When commits exist after the session's last step, the range now ends
  at the last commit made before the session ended, and the receipt says so. For a session
  that never committed, the range stays HEAD to working tree with a warning that the
  repository has moved on. After the fix those two sessions show 2 and 34 files.
- **The working folder moves mid-session.** A Claude Code session can start in one folder
  and be moved to another (`relocated` records, and a new `cwd` on later lines). The
  reader took the first `cwd`, so 63 edits in one real session looked like they were
  outside the project and no git diff was found. It now uses the latest folder and
  relativises every edit against it. That session now gets a real git diff.
- **The diff has files the edit records do not.** Even with the right range, git shows more
  changed files than the transcript's edit and write calls (for example 56 against 50, and
  34 against 25). The extra files were written by shell commands (heredocs, `sed -i`,
  package installs). So the edit timeline alone undercounts edits. The staleness checks in
  milestone 5 must also treat file-writing shell commands as possible edits, or "tests
  pass" could be marked verified after a `sed -i` that changed code.
- **`git commit-tree` is not a commit.** The commit detector first matched it; it now needs
  `commit` as a whole word.

Default range when no `--base` is given:

1. The agent never ran a successful `git commit`: HEAD to working tree.
2. It committed on a feature branch: merge-base with the default branch (origin's HEAD,
   else main or master) to working tree.
3. It committed on the default branch: the parent of the oldest commit made since the session
   started to working tree; the empty tree if that commit is the repository's first.
4. In cases 2 and 3, if commits exist after the session ended, the range ends at the last
   commit made before the session ended.
