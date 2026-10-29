# Decisions

Short records of choices that are not obvious from the code.

## Runtime dependencies

The budget is fewer than 10. Each entry says why it earns its place.

| Package    | Why                                                                            |
| ---------- | ------------------------------------------------------------------------------ |
| commander  | Subcommands, typed options and generated `--help` without hand-rolled parsing. |
| picocolors | Terminal colour in 2 KB with no dependencies; we decide when colour is on.     |
| zod        | Validates LLM output (and later the config file) with readable errors.         |

Planned for later milestones: `picomatch` (glob matching for sensitive paths and test
files).

Deliberately left out:

- `dotenv`: Node 22 ships `process.loadEnvFile()`.
- `openai` SDK: Ollama, Groq and OpenRouter all speak the same chat-completions HTTP shape,
  so plain `fetch` with a small typed wrapper is enough.

## Node version

Node 22.13 or newer. `node:sqlite` is unflagged from 22.13, which lets Receipts read
OpenCode-format databases without native modules. It still prints an experimental warning
on some versions; the SQLite reader will suppress that one warning so terminal output
stays clean.

## TypeScript 6, not 7

TypeScript 7 (the native compiler) is out, but `typescript-eslint` supports
`typescript < 6.1`. We pin `~6.0` so type-aware linting works, and will move when the
linter supports 7.

## Build: tsup, bundled into one file

`tsup` produces a single `dist/receipts.js` with every dependency inlined, so a
`npx github:` install has nothing extra to resolve at run time. `node:` imports stay
external. The package builds itself through `prepare`, so installing from GitHub works
without committing `dist/`. tsup is in maintenance mode; it is stable and sufficient here.

## Exit code 2 for usage errors

Commander exits with 1 on a parse error, but 1 means "a claim matched `--fail-on`". The
entry point maps every Commander error to 2 so hooks never mistake a typo for a failing
receipt.

## Reading OpenCode-format databases

The reader copies the database and its `-wal`/`-shm` sidecars to a temp folder and opens
the copy. It opens the copy read-write, because SQLite needs to fold the copied WAL into
the copy to see the newest rows; the live file is never opened. The copy also contains
tables Receipts must never read (accounts, credentials), so it is deleted when the reader
closes it, and only `session`, `message` and `part` are queried.

## Timeline order

Sub-agent steps come from separate files (Claude Code) or child sessions (OpenCode). All
steps are merged and stably sorted by timestamp, then renumbered. Staleness checks depend
on "what happened after what", so one true order matters more than keeping each
transcript's steps contiguous.

## Default diff range

A receipt is about one session, so the default range tries to cover exactly that session's
changes. Without `--base`, Receipts compares HEAD to the working tree, plus untracked files.
If the agent committed, it compares from the merge-base with the default branch (on a
feature branch) or from the commit HEAD was on when the session started. If the repository
has commits from after the session ended, the range stops at the session's last commit and
the receipt shows a notice. Every range is a guess when the repository has moved on, so the
notice always says how to choose one with `--base` and `--head`.

## Git is spawned, never shelled

Every git call goes through `execFile` with an argument array, `--end-of-options` before
user-supplied refs, and no external diff or textconv drivers. Output is decoded as UTF-8
without failing on invalid bytes.

## Free models only

Three providers, all through the OpenAI-compatible chat API with plain `fetch`: local
Ollama, Groq, and OpenRouter. The guard in `src/providers/models.ts` refuses any OpenRouter
model whose id does not end in `:free`, and an HTTP 402 ends the attempt instead of
retrying. Receipts cannot tell a Groq key on the free tier from one on a paid plan, so the
README must say to use a free-tier key only. When no free model answers, Receipts continues
with patterns only and prints one line; the exit code does not change.

Only the final message is sent, never the transcript. Provider keys are read from the
environment or from a `.env` file in the current folder, and only the three provider keys
are taken from that file.

## The model never decides a verdict

The LLM may find a claim and propose its type. Its quote must appear in the final message,
and the quote must contain a cue for that type (a path for a file claim, "install" or
"dependency" for a package claim). Verdicts come only from deterministic checkers.

## Commit and push claims

The spec's claim types had no place for "pushed to main" or "committed as abc123", which
were the most common claims in real final messages. They map to `command-ran` with the
subject `git push` or `git commit`, so the existing checker covers them.
