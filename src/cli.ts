import { Command } from "commander";
import { EXIT_CODE_HELP } from "./exit-codes.js";
import { VERSION } from "./version.js";

const EXAMPLES = `Examples:
  $ receipts check demo --no-llm
  $ receipts check latest --fail-on contradicted,stale`;

export function createProgram(): Command {
  const program = new Command();
  program
    .name("receipts")
    .description("Your agent says it's done. Check the receipts.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError()
    .addHelpText("after", `\n${EXAMPLES}\n\n${EXIT_CODE_HELP}`)
    .action(() => {
      program.help();
    });
  return program;
}
