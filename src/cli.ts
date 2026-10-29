import os from "node:os";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError, Option } from "commander";
import { FORMATS, runCheck, type CheckOptions, type Format } from "./commands/check.js";
import { doctor } from "./commands/doctor.js";
import { explain } from "./commands/explain.js";
import { installHook } from "./commands/hook.js";
import { renderSessions } from "./commands/sessions.js";
import { EXIT_CODE_HELP } from "./exit-codes.js";
import { discoverSessions } from "./ingest/discover.js";
import { colorsFor } from "./report/colors.js";
import { VERDICTS, type SourceKind, type Verdict } from "./types.js";
import { VERSION } from "./version.js";

const EXAMPLES = `Examples:
  $ receipts check demo
  $ receipts check latest --fail-on contradicted,stale
  $ receipts check latest --format md > receipt.md
  $ receipts sessions --limit 5`;

/** Where a command leaves the exit code for the entry point to return. */
export interface CliState {
  exitCode: number;
}

export function createProgram(state: CliState = { exitCode: 0 }): Command {
  const program = new Command();
  program
    .name("receipts")
    // Set before subcommands are added: they copy this setting when created.
    .exitOverride()
    .description("Your agent says it's done. Check the receipts.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError()
    .addHelpText("after", `\n${EXAMPLES}\n\n${EXIT_CODE_HELP}`);

  program
    .command("check")
    .description("Check the claims in an agent session's final message against the evidence")
    .argument(
      "[target]",
      'a session: "demo", "latest", "latest:claude-code", "latest:opencode", a .jsonl path, or a session id',
      "latest",
    )
    .option("--repo <path>", "git repository to diff (default: the session's folder)")
    .option("--base <ref>", "diff from this ref")
    .option("--head <ref>", "diff to this ref (default: the working tree)")
    .option("--diff <file>", "read changes from a patch file instead of git")
    .option("--db <path>", "read sessions from this OpenCode-format database")
    .option("--turns <from..to>", "check only these turns, for example 3..5")
    .addOption(
      new Option("--format <format>", "what to write").choices([...FORMATS]).default("all"),
    )
    .option("--out <dir>", "folder for report files", "receipts-report")
    .option("--no-llm", "use pattern extraction only; no network")
    .option(
      "--model <ref>",
      "free model to use, for example ollama:qwen2.5-coder or groq:openai/gpt-oss-120b",
    )
    .option(
      "--fail-on <verdicts>",
      "exit 1 when any claim has one of these verdicts",
      parseVerdicts,
      [],
    )
    .option("--config <file>", "path to receipts.config.json")
    .option("--quiet", "print nothing unless there is an error", false)
    .addHelpText(
      "after",
      `\nExamples:\n  $ receipts check demo --no-llm\n  $ receipts check latest --base main --fail-on contradicted,stale\n  $ receipts check session.jsonl --diff changes.patch --format json\n\n${EXIT_CODE_HELP}`,
    )
    .action(async (target: string, opts: Omit<CheckOptions, "format"> & { format: Format }) => {
      state.exitCode = await runCheck(target, opts, {
        write: (text) => process.stdout.write(text),
        isTTY: process.stdout.isTTY,
        columns: process.stdout.columns || 100,
        env: process.env,
        cwd: process.cwd(),
      });
    });

  program
    .command("sessions")
    .description("List recent agent sessions on this machine")
    .addOption(
      new Option("--source <source>", "only one source").choices(["claude-code", "opencode"]),
    )
    .option("--limit <n>", "how many sessions to show", parsePositiveInt, 15)
    .option("--db <path>", "read this OpenCode-format database instead of discovering one")
    .addHelpText("after", "\nExample:\n  $ receipts sessions --source opencode --limit 5")
    .action(async (opts: { source?: SourceKind; limit: number; db?: string }) => {
      const rows = await discoverSessions({
        limit: opts.limit,
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.db ? { db: opts.db } : {}),
      });
      process.stdout.write(
        renderSessions(rows, colorsFor(process.stdout), process.stdout.columns || 100),
      );
    });

  program
    .command("explain")
    .description("Explain a verdict or a flag")
    .argument("<id>", "a verdict (stale, needs-review, ...) or a flag id (test-skipped, ...)")
    .addHelpText(
      "after",
      "\nExamples:\n  $ receipts explain stale\n  $ receipts explain test-skipped",
    )
    .action((id: string) => {
      process.stdout.write(explain(id));
    });

  program
    .command("doctor")
    .description("Show what Receipts can find and use on this machine")
    .addHelpText("after", "\nExample:\n  $ receipts doctor")
    .action(async () => {
      process.stdout.write(
        await doctor({
          cwd: process.cwd(),
          env: process.env,
          home: os.homedir(),
          colors: colorsFor(process.stdout),
        }),
      );
    });

  program
    .command("install-hook")
    .description("Install a git pre-push hook that runs receipts check on the latest session")
    .option("--fail-on <verdicts>", "verdicts that block the push", parseVerdicts, [
      "contradicted",
      "stale",
    ])
    .option("--force", "replace an existing pre-push hook without asking", false)
    .addHelpText("after", "\nExample:\n  $ receipts install-hook --fail-on contradicted,stale")
    .action(async (opts: { failOn: Verdict[]; force: boolean }) => {
      const message = await installHook({
        cwd: process.cwd(),
        failOn: opts.failOn.join(","),
        force: opts.force,
        ...(process.stdin.isTTY ? { confirm: ask } : {}),
      });
      process.stdout.write(message);
    });

  return program;
}

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(?:es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

function parseVerdicts(value: string): Verdict[] {
  const list = value
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((v) => !(VERDICTS as readonly string[]).includes(v));
  if (bad.length) {
    throw new InvalidArgumentError(
      `Unknown verdict ${bad.join(", ")}. Use: ${VERDICTS.join(", ")}.`,
    );
  }
  return list as Verdict[];
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new InvalidArgumentError("Expected a positive whole number.");
  return n;
}
