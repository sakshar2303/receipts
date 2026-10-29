# Decisions

Short records of choices that are not obvious from the code.

## Runtime dependencies

The budget is fewer than 10. Each entry says why it earns its place.

| Package    | Why                                                                            |
| ---------- | ------------------------------------------------------------------------------ |
| commander  | Subcommands, typed options and generated `--help` without hand-rolled parsing. |
| picocolors | Terminal colour in 2 KB with no dependencies; we decide when colour is on.     |
| zod        | Validates LLM output (and later the config file) with readable errors.         |
| picomatch  | Glob matching for test, doc and manifest files; small and dependency-free.     |

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

## Reading exit codes

A shell exit code belongs to the last command, so Receipts reads it as follows:

- The check is the last command, and no `||` before it could have skipped it: the exit code
  is the check's own.
- The check is followed by `&&` and exit is 0, with no `||` anywhere and no `;` after it: the
  check passed, because a failure would have stopped the chain and become its code.
- Anything else falls back to the output: a test summary, printed compiler or linter errors,
  or, when piped into `tail`, `head`, `cat` or `tee`, a clean output for compilers, linters,
  builds and pushes.
- Otherwise the outcome is unknown, and the claim is unverified with the reason. Unknown is
  never a pass.

## Staleness counts shell writes

A run is stale when any code file changed after it. That includes edit and write tool calls,
and shell commands that write files: redirects, `sed -i`, `tee`, `mv`, `cp`, `rm`, package
installs, formatters, git commands that rewrite the tree, and inline scripts that call a
file-writing API. Docs never make a run stale, and test files do not make a build stale.
When a shell command may have changed files we cannot name, the claim is stale with that
reason. A false stale costs a reviewer a minute; a false verified is the worst failure.

## Checkers grouped by shared logic

`src/check/` has one module per family of claim types, not one per type, so the last-run
and staleness logic exists once.

## Flags are about risk, not truth

Flags never change a verdict. They point at things a reviewer should look at whether or not
the agent claimed anything about them. Detectors that guess (assertion-weakened) say so in
the report. Each detector errs towards silence on inspection commands and towards noise on
destructive ones: a missed `git reset --hard` is worse than an extra line in a table.

## Redaction

Credential-looking values are replaced with `[redacted <kind>]` before any line is stored on
a flag. The same function will run over every string in every output format, so a secret in
a transcript or diff is never printed, written to report.json, or shown in the HTML report.
