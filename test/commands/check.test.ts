import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMessage, runCheck } from "../../src/commands/check.js";
import { explain } from "../../src/commands/explain.js";
import { loadConfig } from "../../src/config-load.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { ReceiptsError } from "../../src/errors.js";
import { readClaudeCodeSession } from "../../src/ingest/claude-code.js";
import { selectTurns } from "../../src/ingest/turns.js";
import { captureIo, checkOptions } from "../helpers/io.js";

const tmp = () => mkdtempSync(path.join(tmpdir(), "receipts-cmd-"));

async function exitOf(promise: Promise<unknown>): Promise<number> {
  try {
    return (await promise) as number;
  } catch (error) {
    if (error instanceof ReceiptsError) return error.exitCode;
    throw error;
  }
}

describe("check", () => {
  it("exits 1 only when a claim matches --fail-on", async () => {
    const io = () => captureIo(tmp());
    expect(await runCheck("demo", checkOptions(), io())).toBe(0);
    expect(await runCheck("demo", checkOptions({ failOn: ["contradicted", "stale"] }), io())).toBe(
      1,
    );
    expect(await runCheck("demo", checkOptions({ failOn: ["unverified"] }), io())).toBe(1);
  });

  it("prints JSON or Markdown to stdout, and writes files for --format all", async () => {
    const json = captureIo(tmp());
    await runCheck("demo", checkOptions({ format: "json" }), json);
    expect((JSON.parse(json.text()) as { schemaVersion: string }).schemaVersion).toBe("1.0");
    const md = captureIo(tmp());
    await runCheck("demo", checkOptions({ format: "md" }), md);
    expect(md.text()).toMatch(/^### Receipts: /);
    const dir = tmp();
    const all = captureIo(dir);
    await runCheck("demo", checkOptions({ format: "all", out: path.join(dir, "r") }), all);
    expect(all.text()).toContain(`Report  ${path.join(dir, "r", "report.html")}`);
  });

  it("opens the HTML report only when asked", async () => {
    const dir = tmp();
    const opened: string[] = [];
    const io = { ...captureIo(dir), openFile: (f: string) => opened.push(f) };
    await runCheck("demo", checkOptions({ format: "html", out: path.join(dir, "r") }), io);
    expect(opened).toEqual([]);
    await runCheck(
      "demo",
      checkOptions({ format: "html", out: path.join(dir, "r"), open: true }),
      io,
    );
    expect(opened).toEqual([path.join(dir, "r", "report.html")]);
  });

  it("prints nothing with --quiet but keeps the exit code", async () => {
    const io = captureIo(tmp());
    const code = await runCheck(
      "demo",
      checkOptions({ format: "terminal", quiet: true, failOn: ["stale"] }),
      io,
    );
    expect([code, io.text()]).toEqual([1, ""]);
  });

  it("exits 3 for a missing transcript or a session with no final message", async () => {
    expect(await exitOf(runCheck("nope/missing.jsonl", checkOptions(), captureIo(tmp())))).toBe(3);
    const dir = tmp();
    const file = path.join(dir, "empty.jsonl");
    writeFileSync(
      file,
      JSON.stringify({
        type: "user",
        sessionId: "e",
        cwd: dir,
        message: { role: "user", content: "hi" },
      }),
    );
    expect(await exitOf(runCheck(file, checkOptions(), captureIo(dir)))).toBe(3);
  });

  it("exits 2 for a base ref that does not exist", async () => {
    expect(
      await exitOf(runCheck("demo", checkOptions({ repo: tmp(), base: "main" }), captureIo(tmp()))),
    ).toBe(2);
  });

  it("checks only the chosen turns", async () => {
    const io = captureIo(tmp());
    await runCheck("demo", checkOptions({ turns: "1..1" }), io);
    expect((JSON.parse(io.text()) as { session: { turns: string } }).session.turns).toBe("1..1");
  });

  it("checks a draft reply passed with --message against the same evidence", async () => {
    const io = captureIo(tmp());
    const message = "Updated src/parser.ts. All tests pass. The build succeeds.";
    await runCheck("demo", checkOptions({ format: "json", message, turns: "last" }), io);
    const receipt = JSON.parse(io.text()) as {
      finalMessage: { text: string };
      claims: { text: string; verdict: string }[];
    };
    expect(receipt.finalMessage.text).toBe(message);
    expect(receipt.claims.map((c) => [c.text, c.verdict])).toEqual([
      ["Updated src/parser.ts", "verified"],
      ["All tests pass", "stale"],
      ["The build succeeds", "contradicted"],
    ]);
  });

  it("exits 3 when the message file cannot be read", () => {
    expect(() => readMessage(path.join(tmp(), "missing.md"))).toThrow(/Cannot read the message/);
  });
});

describe("turns", () => {
  it("splits a session at human messages and rejects ranges outside it", async () => {
    const session = await readClaudeCodeSession(
      path.join(import.meta.dirname, "../../demo/claude-code-session.jsonl"),
    );
    expect(selectTurns(session, "1").steps).toHaveLength(session.steps.length);
    expect(selectTurns(session, "last").steps).toHaveLength(session.steps.length);
    expect(() => selectTurns(session, "2..3")).toThrow(/outside this session, which has 1 turn/);
    expect(() => selectTurns(session, "abc")).toThrow(/takes a range like/);
  });
});

describe("config", () => {
  it("returns defaults when there is no file", () => {
    expect(loadConfig(undefined, [tmp()])).toEqual({ config: DEFAULT_CONFIG, file: null });
  });

  it("overrides keys and merges command lists one kind at a time", () => {
    const dir = tmp();
    writeFileSync(
      path.join(dir, "receipts.config.json"),
      JSON.stringify({ $schema: "x", largeDiffLines: 50, commands: { test: ["^make test"] } }),
    );
    const { config } = loadConfig(undefined, [dir]);
    expect(config.largeDiffLines).toBe(50);
    expect(config.commands.test).toEqual(["^make test"]);
    expect(config.commands.build).toEqual(DEFAULT_CONFIG.commands.build);
  });

  it("explains unknown keys, bad values, bad JSON and bad patterns", () => {
    const dir = tmp();
    const file = path.join(dir, "c.json");
    const message = (content: string) => {
      writeFileSync(file, content);
      try {
        loadConfig(file, []);
      } catch (error) {
        return (error as ReceiptsError).message;
      }
      return "";
    };
    expect(message(JSON.stringify({ testGlobs: [] }))).toMatch(
      /Unknown key "testGlobs"\. Valid keys: commands, testFiles/,
    );
    expect(message(JSON.stringify({ commands: { tests: [] } }))).toMatch(
      /Unknown key "tests" in commands\. Valid keys: test, build/,
    );
    expect(message(JSON.stringify({ largeDiffLines: -1 }))).toMatch(/largeDiffLines:/);
    expect(message("{ nope")).toMatch(/is not valid JSON/);
    expect(message(JSON.stringify({ commands: { test: ["("] } }))).toMatch(
      /invalid regular expression/,
    );
    expect(() => loadConfig(path.join(dir, "missing.json"), [])).toThrow(/Config file not found/);
  });
});

describe("explain", () => {
  it("explains verdicts and flags, and lists both for unknown ids", () => {
    expect(explain("stale")).toMatch(/^stale\n\nThe claim was true at some point/);
    expect(explain("needs review")).toMatch(/^needs-review/);
    expect(explain("test-skipped")).toMatch(
      /^test-skipped \(high\)\nA test was skipped or focused/,
    );
    expect(() => explain("nope")).toThrow(/Verdicts: verified, contradicted/);
  });
});
