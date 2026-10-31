import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_SESSION_TOOL, handleMcp } from "../../src/commands/mcp.js";
import { captureIo } from "../helpers/io.js";

const io = () => captureIo(mkdtempSync(path.join(tmpdir(), "receipts-mcp-")));
const call = (args: Record<string, unknown>, id = 3) =>
  handleMcp(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "check_session", arguments: args },
    },
    io(),
  );

interface ToolResult {
  isError: boolean;
  content: { type: string; text: string }[];
  structuredContent?: {
    counts: Record<string, number>;
    claims: { text: string; verdict: string; reason: string }[];
    flags: { id: string }[];
  };
}

describe("MCP server", () => {
  it("answers initialize with the asked protocol version and lists one tool", async () => {
    const init = await handleMcp(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      io(),
    );
    expect(init).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
    });
    const list = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, io());
    expect(list).toMatchObject({ result: { tools: [{ name: "check_session" }] } });
    expect(CHECK_SESSION_TOOL.inputSchema.additionalProperties).toBe(false);
  });

  it("sends no reply to a notification", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, io())).toBe(
      null,
    );
  });

  it("checks a draft reply and returns verdicts without the transcript", async () => {
    const res = await call({ target: "demo", message: "All tests pass. The build succeeds." });
    const result = (res as { result: ToolResult }).result;
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.claims.map((c) => [c.text, c.verdict])).toEqual([
      ["All tests pass", "stale"],
      ["The build succeeds", "contradicted"],
    ]);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
    expect(result.content[0]?.text).not.toContain('"steps"');
  });

  it("reports a missing session as a tool error and bad arguments as a protocol error", async () => {
    const missing = (await call({ target: "/nowhere/session.jsonl" })) as { result: ToolResult };
    expect(missing.result.isError).toBe(true);
    expect(await call({ target: "demo", colour: "red" })).toMatchObject({
      error: { code: -32602 },
    });
    expect(
      await handleMcp({ jsonrpc: "2.0", id: 9, method: "resources/list" }, io()),
    ).toMatchObject({ id: 9, error: { code: -32601 } });
  });
});
