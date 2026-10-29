import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listOpencodeSessions, readOpencodeSession } from "../../src/ingest/opencode.js";
import { buildOpencodeDb, type FixtureSession } from "../helpers/opencode-fixture.js";

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../../fixtures/opencode/basic.json"), "utf8"),
) as FixtureSession;

describe("OpenCode reader", async () => {
  const dbPath = buildOpencodeDb([fixture]);
  const session = await readOpencodeSession(dbPath, "ses_basic");
  const tools = session?.steps.flatMap((s) => s.tools) ?? [];

  it("lists only top-level sessions", async () => {
    const list = await listOpencodeSessions(dbPath, "opencode");
    expect(list.map((s) => s.id)).toEqual(["ses_basic"]);
    expect(list[0]).toMatchObject({
      source: "opencode",
      cwd: "/work/app",
      sourceLabel: "opencode",
    });
  });

  it("returns null for an unknown session id", async () => {
    expect(await readOpencodeSession(dbPath, "nope")).toBeNull();
  });

  it("splits assistant messages into steps at step-start", () => {
    const main = session?.steps.filter((s) => !s.isSidechain) ?? [];
    expect(main).toHaveLength(4);
    expect(main[0]).toMatchObject({ model: "local/model-a", text: "Let me run the tests." });
    expect(main[0]?.userText).toBe("The tokenizer crashes on empty input. Fix it.");
  });

  it("reads bash exit codes and treats a null exit as interrupted", () => {
    const runs = tools.filter((t) => t.canonical === "run" && !t.parentId);
    expect(runs.map((t) => [t.input.command, t.exitCode, t.status])).toEqual([
      ["npm test", 1, "error"],
      ["npm test", 0, "ok"],
      ["npm run e2e", null, "interrupted"],
      ["npm run lint", 0, "ok"],
    ]);
  });

  it("records edits from filediff, relative writes, and no edit for failed calls", () => {
    const edits = tools.flatMap((t) => t.edits);
    expect(edits).toEqual([
      {
        path: "src/tokenizer.ts",
        absPath: "/work/app/src/tokenizer.ts",
        kind: "edit",
        added: 3,
        removed: 1,
      },
      {
        path: "test/tokenizer.test.ts",
        absPath: "/work/app/test/tokenizer.test.ts",
        kind: "write",
        added: 3,
        removed: 0,
      },
    ]);
  });

  it("expands nested code-mode calls once, from the richest array", () => {
    const nested = tools.filter((t) => t.parentId);
    expect(nested.map((t) => [t.name, t.output])).toEqual([
      ["list_things", "a,b"],
      ["run_thing", "ok"],
    ]);
  });

  it("includes child sessions as sidechain steps", () => {
    const sub = session?.steps.filter((s) => s.isSidechain) ?? [];
    expect(sub).toHaveLength(1);
    expect(sub[0]?.model).toBe("local/model-b");
  });

  it("takes the final message from the last assistant text", () => {
    expect(session?.finalMessage?.text).toBe(
      "Fixed the tokenizer and added tests in test/tokenizer.test.ts. All tests pass.",
    );
  });
});
