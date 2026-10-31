# Decisions

Short records of choices that are not obvious from the code.

## Runtime dependencies

The budget is fewer than 10. Each entry says why it earns its place. All four are bundled
into `dist/receipts.js`, so the published package lists them as development dependencies
and installs nothing at run time (see "Build" below).

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

`tsup` produces a single `dist/receipts.js` with every dependency inlined. `node:` imports
stay external. tsup is in maintenance mode; it is stable and sufficient here.

## The built CLI is committed

The first plan built the package through a `prepare` script. Measured from an empty folder
with a fresh npm cache, `npx github:sakshar2303/receipts check demo` then took 305 seconds:
for a git install npm first installs every development dependency (TypeScript, ESLint,
Vitest) just to run the build. So `dist/receipts.js` is committed, there is no `prepare`,
and the package has no runtime dependencies to fetch. An install from GitHub downloads one
tarball and runs. CI rebuilds and fails if the committed bundle differs from the source.

The bundle is about 1.1 MB unminified (zod is 730 KB of it) and 220 KB compressed. It stays
unminified so stack traces in a bug report point at readable code.

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

## Output formats

`--format all` is the default: it writes report.json and report.md (and report.html from
milestone 8) to `--out` and prints the terminal summary. `terminal`, `json` and `md` write
only to stdout and create no files, so they can be piped or redirected. `--quiet` silences
the terminal summary, never the exit code.

## Exit codes in hooks

The pre-push hook blocks only on exit 1, a `--fail-on` match. A usage error, a missing
session or an internal error never blocks a push: a broken tool should not stop someone's
work, and the hook prints what happened.

## report.json is versioned

`schemaVersion` is "1.0". The zod schema in `src/report/schema.ts` is the source; `npm run
schema` regenerates `schema/receipt.schema.json`, and a test fails if they differ.

## The HTML report has no build step of its own

The client behaviour is one TypeScript function, inlined into the page with
`Function.prototype.toString()`. It must not use imports or anything from its module, which a
test checks. This keeps one toolchain (tsc, ESLint, tsup) for all code and keeps the report a
single file that works from `file://`, offline, and on GitHub Pages.

## No URL ever appears in the page

The report must make no external requests. Rather than trust that transcript text never
contains a URL, the escaping makes it impossible for one to appear: HTML text writes "://"
as "&#58;//", and the embedded JSON writes "/" as "\/". The browser shows and parses the
original text unchanged.

## The real-data eval unit is one turn

Real sessions hold many requests, each ending in a message that reports what was done.
Scoring only the last message of each session would give 15 samples, most of them long
summaries. Each turn (a human request and the work up to the agent's reply) is scored on
its own, with `--turns` selecting it, so the sample is every reply that followed real work.

## Who made the labels is part of the result

The label file records its provenance: `hand` (the author with `npm run label`),
`assistant` (a first pass by an AI coding assistant reading the same evidence) or
`assistant-reviewed`. `eval/results.md` states it next to the numbers, because a label
made by the same kind of system that wrote the transcripts is weaker evidence than a
person's. Real sessions are only ever sent to a local model, never a hosted one.

## Quoted words are not claims

A claim counts only when the agent reports its own work. Words inside quotation marks or
a Markdown blockquote (an example, a commit title, a drafted post), a sentence that
announces the next step ("Let me verify the build") and a conditional sentence ("When it's
pushed, tell me") are dropped for both extractors. On real data, two quoted examples had
been marked verified.

## The MCP server speaks the protocol directly

`receipts mcp` serves one tool, `check_session`, over stdio. The stdio transport is
newline-delimited JSON-RPC 2.0, and one tool needs only `initialize`, `tools/list`,
`tools/call` and `ping`. That is about 150 lines, so the official SDK, which would be the
largest dependency in the bundle, is not used. The tool returns verdicts, reasons and
flags, never transcript text, and uses no model unless asked (`llm: true`).

## Agents check their draft, not their sent reply

An agent that checks itself before replying has not written its reply into the transcript
yet, so `latest` would check its previous message. `check --message -` takes the draft on
standard input (the MCP tool takes it as `message`), and `--turns last` limits the evidence
to the work since the latest request. The skill tells agents not to write the draft into
the project, where it would show up in the diff.

## --watch polls

`check --watch` re-runs when the session changes. It polls the transcript (and the
sub-agent folder) or the database and its write-ahead log once a second. `fs.watch` was
not used because SQLite writes go to the `-wal` file first and appends are not reported on
every file system.

## Global install uses --install-links

npm 11 installs a git package without a `prepare` script as a symlink to its temporary
clone, with no command linked. Adding `prepare` back would make every install fetch the
development toolchain again. The documented global install is
`npm install -g --install-links github:sakshar2303/receipts`, which copies the package.

## Staleness ignores shell writes git does not see

A passing check goes stale when code changes after it. With a git diff, a shell write to a
file that is not in the diff did not change the final code: the file is ignored (a data
file, a log) or was put back as it was. Such writes no longer make a claim stale. The agent's
own edit records always count, and without a git diff every write still counts, because
there is nothing to compare with.
