---
name: receipts
description: Check your own claims against the evidence before you tell the user a coding task is done. Use it right before your final message whenever that message will say tests pass, the build or typecheck is clean, files changed, a dependency was added, a command ran, or a bug is fixed.
---

# Self-check with Receipts

Receipts reads your session transcript and the git diff, finds the claims in your reply
("All tests pass", "Updated src/parser.ts", "Pushed to main"), and checks each one against
what actually ran. Run it on your draft reply before you send it, and fix what it finds.

## When to use it

At the end of a task, after the last edit, when your reply will claim something a
transcript can prove or disprove. Skip it for answers that make no claims about work done.

## How to run it

1. Draft the reply you are about to send.
2. From the project folder, pass the draft on standard input:

   ```bash
   npx -y github:sakshar2303/receipts check latest --repo . --turns last --no-llm --format json --message - <<'DRAFT'
   Fixed the empty-input crash in src/parser.ts. All tests pass.
   DRAFT
   ```

   - `latest` is the newest session for this folder. In OpenCode use `latest:opencode`; in
     Claude Code use `latest:claude-code`.
   - `--turns last` checks only the work since the user's latest request.
   - `--message -` checks your draft, because your reply is not in the transcript yet. Do
     not write the draft to a file in the project: it would show up in the diff.
   - `--no-llm` keeps everything on the machine. Leave it on.
   - If `receipts` is installed (`npm install -g github:sakshar2303/receipts`), use
     `receipts check …` instead of `npx -y github:sakshar2303/receipts check …`.

3. Read `claims` in the JSON. Each has `text`, `verdict` and `reason`.

## What to do with each verdict

| Verdict      | Meaning                                       | What to do                                                                 |
| ------------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| verified     | The evidence proves it.                       | Keep the claim.                                                            |
| contradicted | The evidence shows it is false.               | Fix the work, or remove the claim. Never send it as written.               |
| stale        | It was true, then code changed after the run. | Run the check again (the whole suite, not one file), then re-run Receipts. |
| unverified   | Nothing in the session proves it.             | Run the check that proves it, or say plainly that you did not run it.      |
| needs-review | A person has to judge it (behaviour, a fix).  | Keep it, and tell the user what to try or look at.                         |

Also read `flags`. Mention every `high` flag in your reply, in particular
`test-skipped`, `test-file-modified`, `assertion-weakened` and `secret-in-diff`, and say
why the change was needed.

## Rules

- Repeat until nothing is contradicted or stale, then send the reply.
- Fix the work, not the wording. Do not rephrase a claim to dodge a verdict, and never
  skip, delete or weaken a test to make a claim pass.
- In the reply, say which claims are still unverified or need review.
- Exit codes: 0 ok, 1 a claim matched `--fail-on`, 2 usage error, 3 session or file not
  found, 4 internal error. Add `--fail-on contradicted,stale` to get exit 1 when either is
  present.
