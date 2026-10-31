# Verdicts and claim types

Receipts reads the final message of a session, finds the claims in it, and gives each claim
one of five verdicts. A verdict always comes from a deterministic checker; a language model
may help find claims, but it never decides whether one holds.

## The five verdicts

| Verdict      | Meaning                                                               | Example                                                                                   |
| ------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| verified     | Direct evidence supports the claim, and nothing later invalidates it. | `npm test` exited 0 after the last code edit.                                             |
| contradicted | Evidence shows the claim is false.                                    | The last `npm test` exited 1, but the agent said "all tests pass".                        |
| stale        | The claim was true at some point, but later changes broke the link.   | Tests passed at step 40, then `src/parser.ts` was edited at step 52 with no run after it. |
| unverified   | No evidence either way.                                               | "Tests pass", but no test command ever ran.                                               |
| needs-review | The claim is about behaviour that cannot be checked mechanically.     | "The dropdown now feels faster."                                                          |

`needs-review` is an honest answer, not a failure. Receipts never turns a behaviour claim
into `verified`, whatever a model says about it.

Each verdict comes with one plain sentence of reasoning, such as "Last test run (step 48,
npm test) exited 1, after the last code edit at step 46.", and links to its evidence: a
step, a command and its exit code, an edit, or a diff hunk.

`receipts explain <verdict>` prints the same definitions.

## Claim types and how each is checked

| Type                                        | Example                         | How it is checked                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tests-pass                                  | "All tests pass"                | The last test run decides. It passed: verified, unless a code file changed after it (stale). It failed: contradicted. It reported no tests: contradicted. It ran only some tests (a file or `-t` filter): unverified. No test run at all: unverified. |
| build-passes, typecheck-passes, lint-passes | "The build succeeds"            | The same rule, using the build, typecheck and lint command patterns. A combined script such as `npm run check` counts for each check it runs. Test files changing after a build does not make the build stale.                                        |
| tests-added                                 | "Added tests for empty input"   | Test files (`**/*.test.*`, `**/*.spec.*`, `test/**`, `tests/**`, `__tests__/**`, `*_test.go`, `test_*.py`) gained lines in the diff: verified. They changed but gained none: contradicted. No test file changed: unverified.                          |
| file-changed, file-created, file-deleted    | "Updated `src/auth.ts`"         | The path, matched by suffix, is in the diff with the right status: verified. It is missing from the diff, or has the wrong status: contradicted. Without a diff, the agent's edit records are used and a missing file is unverified.                  |
| dependency-added, dependency-removed        | "Installed zod"                 | A manifest (`package.json`, `requirements*.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json`) adds or drops the package: verified. An install command ran but no manifest changed: unverified.                               |
| command-ran                                 | "Pushed to `main`"              | A matching command is in the transcript, and its outcome decides: exit 0 verified, a failure contradicted, an unknown outcome unverified. Commit and push claims match `git commit` and `git push` (and `gh repo create --push`).                     |
| no-errors                                   | "No errors"                     | A command failed after the last edit: contradicted. A test, build, typecheck or lint run passed after it and nothing failed: verified. Otherwise unverified.                                                                                          |
| scope                                       | "Only touched the parser"       | Every changed file must share a word with the claimed scope; files outside it make the claim contradicted, and they are listed. A claim that names no scope ("nothing else changed") needs review.                                                    |
| bug-fixed, feature-done, behaviour          | "Fixed the login redirect loop" | Always needs-review. The related edits and the nearest test run are attached as context.                                                                                                                                                              |

## How a command's outcome is read

Agents rarely run a check on its own. They write `npm test 2>&1 | tail -20` or
`npm run typecheck && npm test && git push`. Receipts splits a command on `&&`, `||`, `;` and
`|` outside quotes and heredocs, strips noise that does not change what runs (`cd dir &&`,
environment assignments, `npx`, `timeout N`, a `perl -e 'alarm N; exec @ARGV'` time limit and
redirections), then decides each check's outcome in this order:

1. **The exit code**, when the check is the last part of the command and no `||` comes
   before it.
2. **An `&&` chain.** Exit 0 means every part joined by `&&` succeeded, unless a `||` appears
   anywhere or a `;` comes later.
3. **The output.** A test summary from vitest, jest, pytest, mocha, go test, cargo test or
   `node --test` gives the counts; failure markers mean a failure. For a typecheck, lint or
   build piped to `tail` or `head`, output with no errors means a pass, because compilers and
   linters print their errors. A push that prints `main -> main` succeeded.
4. **Otherwise the outcome is unknown**, and a claim that depends on it is unverified, with
   the reason.

A run that was denied, timed out, interrupted or sent to the background has no exit code and
never counts as a pass.

## What makes a claim stale

A passing run goes stale when a code file changes after it. Changes count from the agent's
edit records and from shell commands that write files: redirections, `sed -i`, `tee`, `mv`,
`cp`, `rm`, installs (which change the lockfile), formatters, git commands that rewrite files,
and inline scripts that call a file-writing API. Edits to docs (`*.md`, `docs/**`) never make
a claim stale, and test-file edits do not make a build claim stale. Both lists are
configurable (see `docFiles` and `testFiles` in the README).
