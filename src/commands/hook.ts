import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ReceiptsError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";

const MARKER = "Installed by Receipts";

export function hookScript(failOn: string): string {
  return `#!/bin/sh
# ${MARKER}. Blocks a push when the latest agent session in this repository
# has claims that are ${failOn.split(",").join(" or ")}. Remove this file to stop.
root="$(git rev-parse --show-toplevel)"
if command -v receipts >/dev/null 2>&1; then
  receipts check latest --repo "$root" --no-llm --format terminal --fail-on ${failOn}
else
  npx --yes github:sakshar2303/receipts check latest --repo "$root" --no-llm --format terminal --fail-on ${failOn}
fi
status=$?
if [ "$status" -eq 1 ]; then
  echo "receipts: push blocked. Fix the claims above, or push with --no-verify to skip this check."
  exit 1
fi
# Missing sessions or other errors never block a push.
exit 0
`;
}

export interface InstallHookOptions {
  cwd: string;
  failOn: string;
  force: boolean;
  /** Asks the user; undefined when there is no terminal to ask in. */
  confirm?: (question: string) => Promise<boolean>;
}

/** Writes .git/hooks/pre-push. Never replaces someone else's hook without asking. */
export async function installHook(options: InstallHookOptions): Promise<string> {
  let hooksDir: string;
  try {
    hooksDir = execFileSync("git", ["-C", options.cwd, "rev-parse", "--git-path", "hooks"], {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new ReceiptsError(`${options.cwd} is not a git repository.`, ExitCode.Usage);
  }
  const hookPath = path.resolve(options.cwd, hooksDir, "pre-push");
  if (existsSync(hookPath) && !readFileSync(hookPath, "utf8").includes(MARKER) && !options.force) {
    if (!options.confirm) {
      throw new ReceiptsError(
        `A pre-push hook already exists at ${hookPath}. Rerun with --force to replace it.`,
        ExitCode.Usage,
      );
    }
    if (
      !(await options.confirm(`A pre-push hook already exists at ${hookPath}. Replace it? [y/N] `))
    ) {
      return `Left the existing hook at ${hookPath} unchanged.\n`;
    }
  }
  mkdirSync(path.dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, hookScript(options.failOn));
  chmodSync(hookPath, 0o755);
  return `Installed a pre-push hook at ${hookPath}. Pushes stop when the latest session has ${options.failOn.split(",").join(" or ")} claims.\n`;
}
