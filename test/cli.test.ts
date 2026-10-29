import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { ExitCode } from "../src/exit-codes.js";

describe("cli", () => {
  it("documents examples and exit codes in --help", () => {
    const help = renderHelp();
    expect(help).toContain("Usage: receipts");
    expect(help).toContain("receipts check latest --fail-on contradicted,stale");
    expect(help).toContain("2  Usage error");
  });

  it("keeps exit code values stable", () => {
    expect(ExitCode).toEqual({
      Ok: 0,
      FailOnMatched: 1,
      Usage: 2,
      InputNotFound: 3,
      Internal: 4,
    });
  });
});

function renderHelp(): string {
  let out = "";
  const program = createProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (s) => {
        out += s;
      },
    });
  try {
    program.parse(["--help"], { from: "user" });
  } catch {
    // --help always throws under exitOverride; the output is what we want.
  }
  return out;
}
