import { Command, InvalidArgumentError, Option } from "commander";
import { renderSessions } from "./commands/sessions.js";
import { EXIT_CODE_HELP } from "./exit-codes.js";
import { discoverSessions } from "./ingest/discover.js";
import { colorsFor } from "./report/colors.js";
import type { SourceKind } from "./types.js";
import { VERSION } from "./version.js";

const EXAMPLES = `Examples:
  $ receipts sessions --limit 5
  $ receipts check demo --no-llm
  $ receipts check latest --fail-on contradicted,stale`;

export function createProgram(): Command {
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

  return program;
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new InvalidArgumentError("Expected a positive whole number.");
  return n;
}
