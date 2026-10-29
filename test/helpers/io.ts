import type { CheckOptions, Io } from "../../src/commands/check.js";

export function captureIo(cwd: string, env: NodeJS.ProcessEnv = {}): Io & { text(): string } {
  let out = "";
  return {
    write: (s) => {
      out += s;
    },
    isTTY: false,
    columns: 100,
    env,
    cwd,
    text: () => out,
  };
}

export function checkOptions(extra: Partial<CheckOptions> = {}): CheckOptions {
  return { format: "json", out: "receipts-report", llm: false, failOn: [], quiet: false, ...extra };
}
