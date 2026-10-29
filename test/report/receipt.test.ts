import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReceiptFor, runCheck } from "../../src/commands/check.js";
import { renderMarkdown } from "../../src/report/markdown.js";
import { receiptJsonSchema, ReceiptSchema, type Receipt } from "../../src/report/schema.js";
import { renderTerminal } from "../../src/report/terminal.js";
import { colorsFor } from "../../src/report/colors.js";
import { captureIo, checkOptions } from "../helpers/io.js";

const SCHEMA_FILE = path.join(import.meta.dirname, "../../schema/receipt.schema.json");
const tmp = () => mkdtempSync(path.join(tmpdir(), "receipts-out-"));

/** generatedAt changes every run; pin it so snapshots are stable. */
function pinned(receipt: Receipt): Receipt {
  return { ...receipt, generatedAt: "2026-03-14T10:00:00.000Z", receiptsVersion: "0.0.0-test" };
}

describe("the demo receipt", async () => {
  const receipt = pinned(await buildReceiptFor("demo", checkOptions(), captureIo(tmp())));

  it("matches the published schema", () => {
    expect(() => ReceiptSchema.parse(receipt)).not.toThrow();
  });

  it("covers every verdict but one and both test flags", () => {
    expect(receipt.counts).toEqual({
      verified: 2,
      contradicted: 2,
      stale: 2,
      unverified: 1,
      "needs-review": 2,
    });
    expect(receipt.flags.map((f) => f.id)).toEqual(["test-file-modified", "test-skipped"]);
    expect(receipt.summary).toBe(
      '2 of 9 claims are proven. The claim "Updated src/format.ts" is contradicted: src/format.ts does not appear in the diff.',
    );
  });

  it("keeps output only for evidence and failures, and marks check outcomes", () => {
    const tools = receipt.steps.flatMap((s) => s.tools);
    const reads = tools.filter((t) => t.canonical === "read");
    expect(reads.every((t) => t.output === "")).toBe(true);
    const build = tools.find((t) => t.command === "npm run build");
    expect(build?.output).toContain("error TS2322");
    expect(tools.find((t) => t.command === "npm test" && t.exitCode === 0)?.checks).toEqual([
      { kind: "test", outcome: "pass" },
    ]);
  });

  it("marks which changed files the message mentions and which carry flags", () => {
    expect(receipt.changes.files.map((f) => [f.path, f.mentioned, f.flags])).toEqual([
      ["src/parser.ts", true, []],
      ["test/parser.test.ts", true, ["test-file-modified", "test-skipped"]],
    ]);
  });

  it("renders the terminal summary", async () => {
    const text = renderTerminal(receipt, {
      colors: colorsFor({ isTTY: false }),
      width: 100,
      reportPath: "receipts-report/report.html",
    });
    await expect(text).toMatchFileSnapshot("__snapshots__/demo.terminal.txt");
  });

  it("renders Markdown for a pull request", async () => {
    await expect(renderMarkdown(receipt)).toMatchFileSnapshot("__snapshots__/demo.md");
  });
});

describe("JSON schema file", () => {
  it("is generated from the receipt schema", () => {
    const generated = `${JSON.stringify(receiptJsonSchema(), null, 2)}\n`;
    if (process.env.UPDATE_SCHEMA) writeFileSync(SCHEMA_FILE, generated);
    expect(readFileSync(SCHEMA_FILE, "utf8")).toBe(generated);
  });
});

describe("redaction", () => {
  it("never prints a secret from the transcript, in any format", async () => {
    const secret = "gh" + "p_" + "Q7w8E9r0T1y2U3i4O5p6A7s8D9f0G1h2J3k4";
    const dir = tmp();
    const file = path.join(dir, "session.jsonl");
    const lines = [
      {
        type: "user",
        sessionId: "s",
        cwd: dir,
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: `use token ${secret}` },
      },
      {
        type: "assistant",
        sessionId: "s",
        cwd: dir,
        timestamp: "2026-01-01T00:00:01Z",
        message: {
          id: "m1",
          model: "x",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Bash",
              input: { command: `curl -H "Authorization: token ${secret}" api` },
            },
          ],
        },
      },
      {
        type: "user",
        sessionId: "s",
        cwd: dir,
        timestamp: "2026-01-01T00:00:02Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              is_error: true,
              content: `Exit code 1\nbad token ${secret}`,
            },
          ],
        },
      },
      {
        type: "assistant",
        sessionId: "s",
        cwd: dir,
        timestamp: "2026-01-01T00:00:03Z",
        message: {
          id: "m2",
          model: "x",
          content: [{ type: "text", text: `Set the token to ${secret}. All tests pass.` }],
        },
      },
    ];
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
    for (const format of ["json", "md", "all"] as const) {
      const io = captureIo(dir);
      await runCheck(file, checkOptions({ format, out: path.join(dir, "out") }), io);
      expect(io.text()).not.toContain(secret);
    }
    expect(readFileSync(path.join(dir, "out", "report.json"), "utf8")).not.toContain(secret);
    expect(readFileSync(path.join(dir, "out", "report.md"), "utf8")).not.toContain(secret);
  });
});
