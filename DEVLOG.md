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

## 2026-10-29 21:55 IST: Milestone 4, extraction

Built: a sentence and bullet segmenter that keeps exact offsets, a pattern extractor for
all 16 claim types, an optional LLM extractor (free models only), a disk cache under
`.receipts/cache/`, per-provider rate limits with `Retry-After` backoff, and the merge.
`--no-llm` makes no network calls at all. Pattern extraction on the real final messages
takes 0 to 8 ms each.

Ran both extractors on the 11 real final messages (local Ollama only, so no real text left
the machine). What that showed:

- **Commit and push claims are the most common claims, and the spec had no pattern for
  them.** "Pushed to `main`", "committed as `a45c3b2`", "five commits pushed" appeared
  in 8 of 11 messages. They are mechanically checkable, so they now map to the spec's
  `command-ran` type with subject `git commit` or `git push`. No new claim type was
  needed.
- **Agents name the command, not the check.** "`npm test` 263/263 passing", "`npm run
typecheck` clean", "`npm run build` succeeds". The test, typecheck, lint and build
  patterns now accept a package-manager prefix and `N/N passing`.
- **Passive voice.** "`docs/demo.mp4` replaced", "`src/new.ts` was added". File claims
  now match a path followed by the verb too.
- **Words with two meanings.** "Paths are resolved against the session cwd" was read as a
  bug fix, "Fixed and pushed as `20e81c0`" gave a bug subject of "and pushed", and
  "`Step.userText` added" looked like a file. "resolved" and "patched" now need a problem
  noun, a fix subject cannot start with a conjunction, and a path without a slash needs a
  lowercase extension.
- **A small local model invents claim types.** With the smallest local model, the LLM
  extractor labelled a résumé's skill list ("Redis", "Agile/Scrum", "Shadcn UI") as
  dependency and scope claims, a plan ("build the research … here now") as a command that
  ran, and a test framework list as "tests pass". Two guards now run on every model claim:
  its text must be found in the final message (an invented quote is dropped), and it must
  contain a cue for its type: a path for file claims, "install", "dependency" or "package"
  for dependency claims, and so on. Behaviour and feature claims have no cue; they become
  needs-review, which is honest. After the guards the model added 18 claims on top of the
  patterns' 31; most are behaviour descriptions. Whether the LLM is worth having on by
  default is a question for the eval in milestone 9, which measures precision for
  pattern-only against pattern plus LLM.
- **Latency.** The local model took 1 to 19 seconds per message, against milliseconds for
  patterns. Answers are cached by model and prompt, so a re-run is instant.
- **Hinglish.** One real final message mixes Hindi and English ("Check green hai (93
  tests)"). The patterns are English-only and missed it; the model found it. This goes into
  the README's limitations.

Groq caveat recorded in `docs/decisions.md`: Receipts cannot tell a free Groq key from
one on a paid plan, so the docs must say to use a free-tier key only.

## 2026-10-29 22:31 IST: Milestone 5, checkers

Built: a deterministic checker for every claim type, quote-aware command splitting and
normalisation, test-summary parsing for the common runners, shell-write detection, and an
activity timeline that orders every run and every file change. The repository went public
on GitHub at the user's request, and each milestone is now pushed when it is green.

On the real sessions, with patterns only: 30 claims, 22 verified, 4 unverified, 2 stale and
2 needs-review. Extracting and checking the largest session (768 steps) takes about 30 ms.
The first pass gave much worse numbers, and the gap was all in how commands are read:

- **Agents pipe almost everything.** `npm run typecheck 2>&1 | tail -5` and
  `git push origin main 2>&1 | tail -3` were in most real sessions. The exit code is then
  tail's, so the first version called all of them unverified. Now the output decides:
  compilers and linters print their errors, so a clean tail after one counts as a pass,
  and errors in it count as a failure. A push counts when its output shows `main -> main`
  or "Everything up-to-date". Tests still need a summary line ("Tests 252 passed"). Piping
  into grep or wc still leaves the run unknown.
- **"&&" chains carry proof.** `npm run typecheck && npm test && git commit … && git push |
tail` exited 0. A failing command stops an && chain and its code becomes the chain's, so
  exit 0 proves every check before an `&&` passed. The first version only trusted the last
  command. Pipes bind tighter than `&&`, so the trailing `| tail` does not break this; an
  `||` anywhere, or a `;` later on, does.
- **"After the final edit" was false once.** A verified test claim said "after the final
  edit at step 23" while the run was at step 20. Step 23 was a docs edit, so the verdict was
  right but the sentence was not. The reason now names the last code edit before the run.
- **Read-only scripts looked like writes.** Agents inspect files with `node -e` and
  `python3 - <<EOF`. Counting every inline script as a possible write made passing runs
  stale. A script now counts only if its text calls a write API (`writeFileSync`,
  `open(..., "w")`, `shutil`, …). `git checkout -b` no longer counts either.
- **Kept on purpose:** one real "stale" comes from a `git rebase --exec` that only reworded
  commit messages. A rebase can change files, and nothing in the transcript says this one
  did not, so "may have changed files" stays. A false stale costs a reviewer a minute; a
  false verified is the failure this tool exists to prevent.
- **Composite scripts.** `npm run check` runs typecheck, lint, tests and build in one go.
  It counts as a run of all four. If it fails, it is unclear which one failed.
- **Filtered runs.** `vitest run test/parser.test.ts` passing does not verify "all tests
  pass". It still verifies "the parser tests pass".

Spec deviation: the spec asks for one file per claim type under `src/check/`. Claim types
that share logic are grouped instead: `runs.ts` (tests, build, typecheck, lint, command,
no-errors), `files.ts` (file claims, tests-added, scope), `dependencies.ts` and
`review.ts`. A file per type would have copied the last-run and staleness logic four times.

## 2026-10-29 22:40 IST: Milestone 6, flags

Built: all 11 risk detectors from the spec, each with an id, severity, title, one-sentence
detail, evidence, the triggering diff lines, and an explain text for `receipts explain`.
Secret detection covers common token formats, private key blocks and long random values
assigned to key, token, secret or password names; every flagged line is redacted before it
is stored, and `redactSecrets` is ready for every output in milestone 7. Severity can be
overridden per flag in config.

Fake credentials in the tests are assembled at run time ("gh" + "p_" + ...), so the public
repository never holds a string that looks like a real token. GitHub's push protection would
have blocked a literal one, and it would have taught scanners to ignore this repo.

The first run on real sessions was noisy. What changed and why:

- **The detector caught itself.** This session's diff includes the flag detector and its
  tests, which contain `it.skip(` and `describe.only(` inside strings. test-skipped fired on
  them. Skip markers now count only at the start of a line, where code is, not inside a
  string.
- **Failed looks are not failures.** failing-command-ignored first fired on
  `cat README.md; echo ===; ls docs` and `node -e "console.log(...)"` that exited 1
  because a file was missing. Inspection commands (cat, sed -n, ls, git status, inline
  scripts that write nothing) no longer count. After `;` or `|` the exit code is the last
  command's, so a chain that ends in a look (`python3 build.py; ls *.png`) does not count
  either. What remains on real data is a real crash: `node dist/cli.js --help` exiting 1
  after a build, which was the `node:sqlite` bundling bug from milestone 2.
- **unmentioned-change fired on almost every session.** Agents summarise by topic, not by
  file. Docs, lockfiles and binary assets are now left out, a file counts as mentioned when
  its name without the extension appears ("the tokenizer" names `tokenizer.ts`), and the
  default threshold is 5 files instead of 3. It still fires on 9 of 11 real sessions, which
  is the honest finding: agent summaries name a small part of what they changed.
- **True positives kept.** One real session ran `git commit --no-verify` twice and
  `git reset --hard`. Four sessions touched `.github/workflows/ci.yml`. Three edited an
  existing test file (`test/replay.test.ts`); whether that was legitimate is exactly what a
  reviewer should look at.
- `.env.example` and other templates are not sensitive files; the spec's `.env*` glob
  would have flagged every project that ships one.

## 2026-10-29 22:52 IST: Milestone 7, outputs

Built: the receipt model (`report.json`, schema version 1.0, with
`schema/receipt.schema.json` generated from the same zod schema and a test that keeps them
equal), the terminal summary, Markdown for pull requests, `receipts check` with targets
(`demo`, `latest`, `latest:<source>`, a .jsonl path, a session id, `--db`), `--turns`,
`--fail-on` and the documented exit codes, `receipts.config.json` loading with readable
errors, `install-hook`, `explain` and `doctor`. The bundled demo (a synthetic session about
a CSV parser, plus its patch) needs no keys, no network and no git, and produces every
verdict but one plus two high flags. CI now runs the demo and uploads the report.

Timing: `receipts check latest --no-llm` on this repository's own session (205 steps,
113 changed files) takes 0.87 s end to end, including git. The spec's target was 2 s for 300
steps.

Things that came up:

- **The tool checked its own author.** Run on the session that is building it, Receipts found
  one claim in my last message ("246 tests pass"), verified it against `npm run check` at the
  step before, and flagged the CI workflow edit and 103 files the message never named.
- **Evidence labels showed the wrong command.** That verified claim pointed at
  `sed -i '' 's/expect(he…`, the first line of a chained command, not the `npm run check`
  that proved it. Run evidence now carries the segment the verdict is about.
- **Secrets and offsets.** Redacting a token in the final message changes its length, which
  would move every claim's highlight. The final message is now redacted before claims are
  extracted, so offsets point into the text that is shown. Everything else is redacted once,
  on the finished receipt, so nothing in any format can skip it. A test puts a token in the
  user message, the command, the output and the final message, and checks all three formats.
- **Behaviour claims read as clauses.** The demo surfaced "now handles" as a claim. Behaviour
  claims now start at the beginning of their clause ("The parser now handles quoted
  commas"), and phrases no longer stop at the dot inside `test/parser.test.ts`.
- **"latest" in a hook must mean this repository.** The pre-push hook passes `--repo`; with
  it, "latest" only considers sessions that worked inside that repository and exits 3 (which
  never blocks a push) when there is none, instead of checking some other project's session.
- **Report size.** Every step stays in report.json for the timeline, but only tool calls
  that a claim or flag points at, and failures, keep their output (clipped to 8 KB). Check
  outcomes per call are computed in one pass; the first version looked each call up again,
  which would have been quadratic on a 5,000-step session.

Spec deviations:

- The terminal shows the reason under every claim that is not verified. The spec asked for
  one line per claim; without the reason, a blocked push says what failed but not why.
- `--format` defaults to `all` (write report files and print the terminal summary);
  `terminal`, `json` and `md` print only to stdout, so `--format md > receipt.md` and
  piping JSON work. `html` arrives with the HTML report in milestone 8, as does `--open`.

## 2026-10-29 23:05 IST: Milestone 8, HTML report

Built: `receipts-report/report.html`, one self-contained file with inline CSS, an inline
script and the receipt as JSON. It has the header with Copy Markdown and Download JSON, the
verdict strip as filters, the summary sentence, the final message with every claim
underlined in its verdict colour, the claim list with lazy evidence panels, a timeline of
every step, the flags table, the changed-files table with diffs, and a footer that says what
left the machine. Light and dark themes follow the system and can be switched (remembered in
localStorage behind try/catch). Keyboard: j/k, Enter, /, 1 to 5, Esc. Filters, selection and
open panels live in the URL hash. `--format html`, `--open` and `receipts open` work.

How it is built: the page is rendered on the server side as plain escaped HTML, so it
reads well before any script runs. The client script is a single TypeScript function inlined
with `Function.prototype.toString()`, so it is type-checked and linted like the rest of the
code but ships with no bundler step and no external file. It builds every node with
`textContent`, never `innerHTML`. Evidence panels, flag hunks and file diffs render only
when opened, so a 2,001-step session builds and renders in about 100 ms and stays under
1.5 MB.

No external requests, by construction: `esc()` writes "://" as "&#58;//", and the embedded
JSON escapes "/" as "\/" (a valid JSON escape), so even a URL quoted from a transcript never
appears as one in the page source. A test feeds the report a hostile session with
`<script>`, `</script>`, an `onerror` image and URLs, and checks the page.

Browser review (built-in browser, 1440, 1100 and 390 px, light and dark). What it caught:

- **Blocks instead of ticks.** With 15 steps, each tick was a 40 px block. Each step now owns
  an equal slot with a 3 px line centred in it, so short and long sessions read the same and
  markers line up with their ticks. The stale story reads at a glance: a green test marker at
  step 8, then emphasised edits at steps 10 to 12.
- **Empty left pane.** On wide screens the final message scrolled away while the claim list
  was still long. It is now sticky.
- **The verdict strip broke on phones.** At 390 px, "CONTRADICTED" ran into "STALE" and
  "NEEDS REVIEW" was cut. On narrow screens the strip becomes five ledger rows.
- **Nested tables inherited ledger styles.** Diffs inside the files table got 8 px padding,
  row borders and a flat background, which hid the add and remove colours. Ledger styles now
  use child selectors only.
- **"Bashexit 0".** Adjacent text nodes in a flex row merged into one item. Each part is now
  its own element.
- **Paths broke mid-word** in the flags table ("test/parser.test." / "ts"); `overflow-wrap:
anywhere` became `break-word`.
- **Theme button label went stale** when the system theme changed after load; it now
  listens for the change.
- **The skip hunk showed only `+ it.skip(`.** The test-skipped flag now keeps the line it
  replaced, so the reader sees `it(` become `it.skip(`.
- No console errors and no network requests other than the page itself, in every state
  tested.

Design notes: the light "stale" colour went from #9a6a00 to #875c00. The original measured
4.54:1 on the page and 4.19:1 on the tinted surfaces, under WCAG AA for small text; the new
one is 5.65:1 and 5.22:1. The spec allows tuning for contrast. Verdict tags carry a word and
a CSS shape (filled circle, cross, half circle, ring, diamond) so colour is never the only
signal. The footer is honest about hosted models: with a Groq or OpenRouter model it says the
final message was sent there, not "nothing left your machine".

## 2026-10-31 12:15 IST: Milestone 9, eval

Built: 30 hand-written cases in `eval/fixtures/` (JSON, materialised into Claude Code JSONL
or an OpenCode-format SQLite database plus a patch), span-overlap scoring, per-verdict
precision and recall, the false-verified rate, flag scoring, `npm run eval` writing
`eval/results.md`, and `npm run label`, an interactive labeller for real sessions whose
labels stay in the gitignored `eval/private/`. Real sessions are only ever sent to a local
Ollama model; the eval drops hosted keys.

**Synthetic cases.** 100% on every metric with patterns, 93.5% extraction precision with
gemma3, false-verified 0 of 22, flags 100% precision and recall over 17. Writing them found
two wrong expectations in my own labels (cases 03, 04, 12 and 18 really do ignore a failing
command) and one detector bug: failing-command-ignored counted a mention of the command's
name as acknowledging the failure. It now needs a failure word.

**Real sessions: the unit is one turn.** 15 sessions hold about 130 turns that ran a tool
and ended with a message. Each is checked with `--turns N` on its own.

**Who labelled.** The author asked the coding assistant to make the first pass. It labelled
45 turns from 10 sessions (both agents), 191 extracted claims plus a count of missed claims
per message, judging each claim from the tool outputs, not from Receipts' verdict, and
opening the raw output wherever the verdict depended on it. The label file records
`provenance: "assistant"`, and `eval/results.md` says the author has not reviewed them yet.
A private review sheet lists every label next to Receipts' verdict.

**Results on real sessions (after the fixes below):**

|                      | Patterns | Patterns + gemma3 |
| -------------------- | -------: | ----------------: |
| Extraction precision |    97.6% |             88.6% |
| Extraction recall    |    27.7% |             52.7% |
| Verdict accuracy     |    90.2% |             87.2% |
| False-verified       |  0 of 66 |    1 of 76 (1.3%) |

Before the fixes, on the first-pass labels: extraction precision 87.2% and 81.7%,
false-verified 0 of 64 and 1 of 74.

**Headline finding.** The agents' checkable claims were nearly always true: only 2 of 45
messages held a claim that was truly stale or unverified (a build that ran before the last
code edit, and a push and new tests that a parallel worker made, not that turn). The weak
point is extraction recall. Most of what real agents report is prose about features and
behaviour (what a function now accepts, what a page now shows), which patterns cannot find and a
3B local model finds about half of. Those claims would be needs-review anyway, so missing
them costs coverage, not correctness.

**Bugs labelling found, all fixed with tests:**

- **Quoted words became claims.** My milestone 4 message quoted agent wording as examples
  ("pushed to `main`", "`npm test` 263/263 passing"), and two of those were marked
  verified. A drafted post in a blockquote did the same. Claims inside quotation marks or a
  blockquote are now dropped for both extractors.
- **"Let me verify the build"** was extracted by the model and marked verified. A sentence
  that announces the next step is not a claim.
- **"When it's pushed, tell me"** read as a push claim. It is now a conditional sentence.
- **"the fixed version"** read as a bug fix.
- **"Nothing else changed"** got the literal subject "scope", so any changed file
  contradicted it. With no named scope it is now needs-review.
- **`perl -e 'alarm 25; exec @ARGV' npm test`**, a time limit one agent used twice, hid the
  test run, so "All 11 tests pass" and "all 21 tests still pass" were unverified although
  the output showed them passing. The wrapper is now stripped like `timeout`.
- **`gh repo create --push`** was not seen as a push.

**My own labelling mistake, caught by the rerun.** After the `gh repo create --push` fix,
one claim I had labelled unverified came out verified. I had filtered successful runs out
of my reading view and wrongly concluded that turn ran no tools; the push was at step 18.
The label is corrected and the review sheet notes it.

**Still wrong, left as is:**

- gemma3 typed "vitest, jest, pytest … test summaries are read" as tests-added, and test
  files really were added, so it was marked verified. The type cue only needs the word
  "test". A tighter cue would also drop true Hinglish claims about new tests.
- Recall gaps worth a later pattern: a dash between a command and its result
  ("`npm run typecheck` — passes"), "`a` and `b`" naming two files in one claim, commit
  tables, and Hinglish ("`npm run check` green hai").

**Screenshots.** `npm run screenshots` renders seven README images from the demo with the
installed Chrome over the DevTools protocol, no new dependency. It is rerun at each
milestone.

## 2026-10-31 14:31 IST: Milestone 10, packaging

**Install time was the real problem.** Measured from an empty folder with a fresh npm cache,
`npx github:sakshar2303/receipts check demo` worked but took 305 seconds. For a git install
npm runs `prepare`, and to do that it first installs every development dependency
(TypeScript, ESLint, Vitest and the rest) just to build one file. The bundle already inlines
all four runtime dependencies, so `dist/receipts.js` is now committed, `prepare` is gone,
and the package has no dependencies to fetch. The same run from a local git copy now takes 8
seconds, with nothing downloaded but the package. CI rebuilds and fails if the committed
bundle differs from the source.

Global install (`npm install -g`) from the packed tarball works: `receipts --version`,
`check demo`, and exit 1 with `--fail-on contradicted`. (From a `git+file:` URL npm links a
temporary clone instead of copying it, so that is not a valid local test of a GitHub
install; the real `github:` install is tested after the push.)

The bundle is 1.1 MB, 730 KB of it zod. Compressed it is 220 KB. It stays unminified.

**Self-check needed two CLI additions.** An agent checking itself before it replies has not
written the reply yet, so `latest` would check its previous message. `--message -` checks a
draft from standard input, and `--turns last` limits the evidence to the current request.
Tried on this session: it caught that I had run only `test/commands`, not the whole suite,
before claiming "All tests pass". It also showed two bugs, both fixed:

- **A secret in the bundle.** `const optionKey = option2.attributeName()` in commander
  matched the "long value assigned to a key-like name" rule (a digit, high entropy). A value
  followed by `(` is a call; it is now skipped. This would have fired on ordinary source
  code too.
- **"Updated `a` and `b`"** gave a claim for `a` only. Every further path in a list after
  the verb is now its own claim. This was also a recall gap in the eval.

**Agent skill.** `skills/receipts/SKILL.md` (standard SKILL.md frontmatter) tells an agent to
pass its draft on stdin, read the verdicts, fix contradicted and stale claims, re-run the
check rather than rephrase, never weaken a test, and name every high flag in its reply.

**MCP server.** `receipts mcp` serves `check_session` over stdio with plain JSON-RPC, no
SDK. It returns verdicts, reasons and flags, not transcript text. Tested in-process and
end-to-end against the built CLI.

**--watch.** Re-runs the check when the transcript, its sub-agent folder, or the database
and its `-wal` change. It polls once a second; a transcript caught mid-write prints the
error and waits for the next change.

**Codex CLI reader: skipped.** There is no `~/.codex` on this machine, so there is nothing
real to inspect, and the spec says not to guess formats.
