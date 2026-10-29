import path from "node:path";
import { describe, expect, it } from "vitest";
import { readClaudeCodeSession } from "../../src/ingest/claude-code.js";

const FIXTURE = path.join(import.meta.dirname, "../../fixtures/claude-code/basic.jsonl");

describe("Claude Code reader", async () => {
  const session = await readClaudeCodeSession(FIXTURE);
  const tools = session.steps.flatMap((s) => s.tools);
  const byId = (id: string) => tools.find((t) => t.id === id);

  it("uses the last custom title and the session cwd", () => {
    expect(session.id).toBe("cc-basic");
    expect(session.title).toBe("Parser empty input fix");
    expect(session.cwd).toBe("/work/app");
    expect(session.source).toBe("claude-code");
  });

  it("merges lines that share message.id into one step and skips synthetic messages", () => {
    const main = session.steps.filter((s) => !s.isSidechain);
    expect(main).toHaveLength(5);
    expect(main[0]?.text).toBe("Running the tests first.");
    expect(main[0]?.tools.map((t) => t.id)).toEqual(["tu_1"]);
    expect(session.steps.some((s) => s.text.includes("No response requested"))).toBe(false);
  });

  it("ignores request-blob records that repeat content", () => {
    expect(byId("tu_dup")).toBeUndefined();
  });

  it("strips injected tags from human text and skips meta lines", () => {
    expect(session.steps[0]?.userText).toBe("Fix the parser so empty input does not crash");
  });

  it("parses exit codes from failed results and treats plain results as exit 0", () => {
    expect(byId("tu_1")).toMatchObject({ canonical: "run", exitCode: 1, status: "error" });
    expect(byId("tu_3")).toMatchObject({
      exitCode: 0,
      status: "ok",
      output: "Tests  12 passed (12)",
    });
  });

  it("never treats a denied or backgrounded command as a completed run", () => {
    expect(byId("tu_4")).toMatchObject({
      exitCode: null,
      status: "error",
      note: "the command did not run",
    });
    expect(byId("tu_5")).toMatchObject({ exitCode: null, status: "interrupted" });
  });

  it("records edits relative to the cwd with line counts from the structured patch", () => {
    expect(byId("tu_2")?.edits).toEqual([
      {
        path: "src/parser.ts",
        absPath: "/work/app/src/parser.ts",
        kind: "edit",
        added: 1,
        removed: 0,
      },
    ]);
  });

  it("merges sub-agent steps in time order and labels them", () => {
    const sub = session.steps.find((s) => s.isSidechain);
    expect(sub?.model).toBe("model-b");
    expect(sub?.tools[0]).toMatchObject({ status: "interrupted", exitCode: null });
    const indexOfSub = session.steps.findIndex((s) => s.isSidechain);
    expect(session.steps[indexOfSub - 1]?.tools[0]?.id).toBe("tu_3");
    expect(session.steps.map((s) => s.index)).toEqual(session.steps.map((_s, i) => i));
  });

  it("takes the final message from the last main-thread text", () => {
    expect(session.finalMessage?.text).toContain("All tests pass.");
    expect(session.finalMessage?.stepIndex).toBe(session.steps.length - 1);
  });
});
