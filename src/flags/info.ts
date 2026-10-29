import type { FlagId, Severity } from "../types.js";

export interface FlagInfo {
  severity: Severity;
  title: string;
  /** What `receipts explain <id>` prints: what triggers it and why it matters. */
  explain: string;
}

export const FLAG_INFO: Record<FlagId, FlagInfo> = {
  "test-file-modified": {
    severity: "high",
    title: "An existing test file was changed",
    explain:
      "An existing test file was edited or deleted, not just added to. Changing a test is sometimes right, but it is also the easiest way to make a failing suite pass. Read the hunks and check that the test still checks the same behaviour.",
  },
  "test-skipped": {
    severity: "high",
    title: "A test was skipped or focused",
    explain:
      "The diff adds .skip, .only, xit, xdescribe, @pytest.mark.skip, t.Skip() or similar, or comments out an assertion. A skipped test passes by not running; a focused test (.only) silently skips every other test in the file.",
  },
  "assertion-weakened": {
    severity: "medium",
    title: "An assertion may have been weakened",
    explain:
      "A test assertion was removed, or changed to a looser matcher (for example toEqual to toBeDefined). This detector is a heuristic: it compares removed and added assertion lines in test files and can be wrong.",
  },
  "coverage-threshold-lowered": {
    severity: "medium",
    title: "A coverage threshold was lowered",
    explain:
      "A coverage threshold number decreased in a config file. Lowering the bar makes a coverage check pass without new tests.",
  },
  "sensitive-file": {
    severity: "high",
    title: "A sensitive file was changed",
    explain:
      "The diff touches environment files, secrets, keys, CI workflows, auth code or database migrations. These deserve a careful look whatever the agent said. The paths are configurable with sensitivePaths.",
  },
  "secret-in-diff": {
    severity: "high",
    title: "A secret may have been added",
    explain:
      "An added line looks like a credential: a cloud access key, an API token, a private key header, or a long random string next to a word like key, token, secret or password. Receipts redacts the value everywhere it prints it. Rotate the secret if it was real.",
  },
  "dangerous-command": {
    severity: "high",
    title: "A dangerous command ran",
    explain:
      "The agent ran a command that can destroy work or bypass safety: rm -rf on / or outside the repository, git push --force, git reset --hard, --no-verify, chmod -R 777, or piping a download into a shell.",
  },
  "lockfile-churn": {
    severity: "low",
    title: "A lockfile changed without its manifest",
    explain:
      "A lockfile changed while its manifest did not. That usually means a reinstall pulled in different versions, which can change behaviour without any visible dependency change.",
  },
  "unmentioned-change": {
    severity: "medium",
    title: "Files changed that the summary does not mention",
    explain:
      "Several changed files are not named by any claim in the final message. The summary may be incomplete; review what else changed. The threshold is configurable with unmentionedFiles.",
  },
  "large-diff": {
    severity: "low",
    title: "The diff is large",
    explain:
      "The change set is larger than the configured number of changed lines (largeDiffLines). Large diffs are harder to review and easier to hide things in.",
  },
  "failing-command-ignored": {
    severity: "medium",
    title: "A failing command was not followed up",
    explain:
      "A command failed, and the agent neither mentioned the failure nor ran the command again before it finished. The failure may still be there.",
  },
};
