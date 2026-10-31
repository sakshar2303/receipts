# Flags

A flag is a risk in the session that the agent did not necessarily claim anything about: an
edited test, a skipped test, a touched `.env`, a force push. Flags are separate from
verdicts. A session can have every claim verified and still carry a high flag, because the
cheapest way to make "all tests pass" true is to change the tests.

Each flag has a severity, a one-line title, the evidence (diff lines, files or steps) and an
explanation, which `receipts explain <flag-id>` prints. Severities can be changed per
project with `severity` in `receipts.config.json`.

| Flag                         | Severity | Fires when                                                                                                                                                                                                         |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test-file-modified`         | high     | An existing test file was edited or deleted, not just added to. The hunks are shown.                                                                                                                               |
| `test-skipped`               | high     | The diff adds `.skip`, `.only`, `.todo`, `xit`, `fit`, `xdescribe`, `@pytest.mark.skip`, `@unittest.skip`, `t.Skip()`, `#[ignore]` or similar at the start of a line, or comments out an assertion in a test file. |
| `assertion-weakened`         | medium   | An assertion was removed, or changed to a looser matcher (for example `toEqual` to `toBeDefined`). A heuristic, and labelled as one.                                                                               |
| `coverage-threshold-lowered` | medium   | A coverage threshold number decreased in a config file.                                                                                                                                                            |
| `sensitive-file`             | high     | The diff touches `.env` files, `secrets/`, `*.pem`, `*.key`, SSH keys, CI workflows, `auth/` or `migrations/`. The globs are `sensitivePaths` in the config.                                                       |
| `secret-in-diff`             | high     | An added line looks like a credential: a cloud key, an API token, a private key, a JWT, or a long random value assigned to a name like key, token, secret or password. The value is redacted in every output.      |
| `dangerous-command`          | high     | The agent ran `rm -rf` on the home folder, `/` or outside the repository, `git push --force`, `git reset --hard`, `--no-verify`, `chmod -R 777`, or piped a download into a shell.                                 |
| `lockfile-churn`             | low      | A lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `poetry.lock` and others) changed while its manifest did not.                                                            |
| `unmentioned-change`         | medium   | More than `unmentionedFiles` (default 5) changed code files are not named by any claim. Docs, lockfiles and binary assets are not counted. The files are listed.                                                   |
| `large-diff`                 | low      | The change set is larger than `largeDiffLines` (default 1,000) changed lines. Lockfiles and binary files are not counted.                                                                                          |
| `failing-command-ignored`    | medium   | A command failed, and the agent neither ran it again successfully nor mentioned the failure before it finished. Read-only commands such as `grep` or `ls`, which "fail" when they find nothing, are left out.      |

## Secrets

Receipts redacts anything that looks like a credential in every output: the terminal, the
HTML report, JSON and Markdown. The redacted text says what kind of value was there, for
example `[redacted GitHub token]`, so a reviewer knows what to rotate. The final message is
redacted before claims are extracted, so a secret never reaches a model either.
