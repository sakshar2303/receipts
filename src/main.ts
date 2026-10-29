import { CommanderError } from "commander";
import { createProgram } from "./cli.js";
import { ReceiptsError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

async function main(argv: readonly string[]): Promise<number> {
  const state = { exitCode: ExitCode.Ok as number };
  const program = createProgram(state);
  try {
    await program.parseAsync(argv);
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander uses 1 for parse errors; 1 is reserved for --fail-on matches.
      return error.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage;
    }
    if (error instanceof ReceiptsError) {
      process.stderr.write(`receipts: ${error.message}\n`);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`receipts: internal error: ${message}\n`);
    return ExitCode.Internal;
  }
}

process.exitCode = await main(process.argv);
