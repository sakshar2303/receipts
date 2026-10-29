import type { FileEdit, ToolCall } from "../types.js";
import { asArray, asNumber, asRecord, asString, type JsonRecord } from "./json.js";
import { relativeToCwd, resolveAgainstCwd } from "./paths.js";
import { canonicalTool } from "./tools.js";
import { clipOutput, countLines, lineChangeStats } from "./text.js";

/** Converts one OpenCode `tool` part, plus any calls nested inside it, into ToolCalls. */
export function toolCallsFromPart(part: JsonRecord, cwd: string): ToolCall[] {
  const state = asRecord(part.state) ?? {};
  const name = asString(part.tool) ?? "unknown";
  const call: ToolCall = {
    id: asString(part.callID) ?? asString(part.id) ?? "",
    name,
    canonical: canonicalTool(name),
    input: asRecord(state.input) ?? {},
    output: "",
    exitCode: null,
    status: "ok",
    edits: [],
  };
  const metadata = asRecord(state.metadata) ?? {};
  const status = asString(state.status);
  const output = asString(state.output) ?? asString(metadata.output) ?? asString(state.error) ?? "";
  call.output = clipOutput(output);

  if (status === "error") {
    call.status = "error";
  } else if (status !== "completed") {
    call.status = "interrupted";
    call.note = "the call never completed";
  } else if (call.canonical === "run") {
    const exit = asNumber(metadata.exit);
    if (exit === undefined) {
      // Seen on real data: a completed bash part with exit null (killed or timed out).
      call.status = "interrupted";
      call.note = "no exit code recorded";
    } else {
      call.exitCode = exit;
      call.status = exit === 0 ? "ok" : "error";
    }
  }
  if (call.status === "ok") call.edits = editsFor(call, metadata, cwd);

  return [call, ...nestedCalls(call.id, metadata, cwd)];
}

function editsFor(call: ToolCall, metadata: JsonRecord, cwd: string): FileEdit[] {
  if (call.canonical !== "edit" && call.canonical !== "write") return [];
  const file = asString(call.input.filePath) ?? asString(call.input.file_path);
  if (!file) return [];
  const absPath = resolveAgainstCwd(file, cwd);
  const path = relativeToCwd(absPath, cwd);
  if (call.canonical === "write") {
    return [
      {
        path,
        absPath,
        kind: "write",
        added: countLines(asString(call.input.content) ?? ""),
        removed: 0,
      },
    ];
  }
  const filediff = asRecord(metadata.filediff);
  const added = asNumber(filediff?.additions);
  const removed = asNumber(filediff?.deletions);
  if (added !== undefined && removed !== undefined) {
    return [{ path, absPath, kind: "edit", added, removed }];
  }
  const stats = lineChangeStats(
    asString(call.input.oldString) ?? "",
    asString(call.input.newString) ?? "",
  );
  return [{ path, absPath, kind: "edit", ...stats }];
}

/**
 * Some engines run a "code mode" script that makes several tool calls and
 * records them in metadata. Key names differ per engine, so we look for any
 * array of objects shaped like calls ({ tool, input | output }). Engines may
 * record the same calls twice under different keys; we keep the single richest
 * array instead of the union, so no call is counted twice.
 */
export function nestedCalls(parentId: string, metadata: JsonRecord, cwd: string): ToolCall[] {
  let best: JsonRecord[] = [];
  let bestScore = -1;
  for (const value of Object.values(metadata)) {
    const items = asArray(value).map(asRecord);
    if (items.length === 0) continue;
    if (!items.every((i) => i && asString(i.tool) !== undefined && ("input" in i || "output" in i)))
      continue;
    const calls = items as JsonRecord[];
    const score = calls.length * 10 + calls.filter((c) => "output" in c).length;
    if (score > bestScore) {
      best = calls;
      bestScore = score;
    }
  }
  return best.flatMap((item, i) => {
    const part: JsonRecord = {
      tool: item.tool,
      callID: asString(item.callId) ?? asString(item.callID) ?? `${parentId}#${i}`,
      state: {
        status: asString(item.status) ?? "completed",
        input: item.input,
        output:
          typeof item.output === "string" || item.output === undefined
            ? item.output
            : JSON.stringify(item.output),
        metadata: asRecord(item.metadata) ?? {},
      },
    };
    return toolCallsFromPart(part, cwd).map((c) => ({ ...c, parentId }));
  });
}
