import { ExitCode } from "./exit-codes.js";

/** An error the user can fix, with the exit code it maps to. Printed without a stack. */
export class ReceiptsError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
    this.name = "ReceiptsError";
  }
}

export function inputNotFound(message: string): ReceiptsError {
  return new ReceiptsError(message, ExitCode.InputNotFound);
}
