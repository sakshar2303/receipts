import type { FileEdit, ToolCall } from "../types.js";
import { asArray, asRecord, asString, type JsonRecord } from "./json.js";
import { relativeToCwd, toPosix } from "./paths.js";
import { clipOutput, countLines, lineChangeStats, patchLineStats } from "./text.js";

const EXIT_CODE = /^(?:Error: )?Exit code (\d+)/;

export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return asArray(content)
    .map((block) => asString(asRecord(block)?.text) ?? "")
    .join("\n");
}

/**
 * Applies a tool_result to its call. Claude Code has no exit-code field: a failed
 * command is an is_error result whose text starts with "Exit code N", and a
 * successful one is a plain result. Everything else is spelled out below.
 */
export function applyResult(
  call: ToolCall,
  block: JsonRecord,
  toolUseResult: unknown,
  cwd: string,
): void {
  const text = resultText(block.content);
  const meta = asRecord(toolUseResult);
  const isError = block.is_error === true;

  if (call.canonical === "run") {
    const stdout = asString(meta?.stdout);
    const stderr = asString(meta?.stderr);
    call.output = clipOutput(
      stdout !== undefined ? [stdout, stderr].filter(Boolean).join("\n") : text,
    );
    const exit = EXIT_CODE.exec(text);
    if (isError && exit?.[1]) {
      call.exitCode = Number(exit[1]);
      call.status = "error";
    } else if (isError) {
      // Denied, blocked or malformed calls fail before any command runs.
      call.status = "error";
      call.note = "the command did not run";
    } else if (meta?.interrupted === true) {
      call.status = "interrupted";
      call.note = "interrupted before it finished";
    } else if (asString(meta?.backgroundTaskId) !== undefined) {
      call.status = "interrupted";
      call.note = "ran in the background; its result is not in the transcript";
    } else if (meta?.timedOutAfterMs !== undefined) {
      call.status = "interrupted";
      call.note = "timed out";
    } else if (asString(meta?.returnCodeInterpretation) !== undefined) {
      // A non-zero exit the harness chose not to treat as failure (grep with no matches).
      call.status = "ok";
      call.note = asString(meta?.returnCodeInterpretation) ?? "";
    } else {
      call.exitCode = 0;
      call.status = "ok";
    }
    return;
  }

  call.output = clipOutput(text);
  call.status = isError ? "error" : "ok";
  if (!isError) call.edits = editsFor(call, meta, cwd);
}

function editsFor(call: ToolCall, meta: JsonRecord | undefined, cwd: string): FileEdit[] {
  if (call.canonical !== "edit" && call.canonical !== "write") return [];
  const file = asString(call.input.file_path);
  if (!file) return [];
  const absPath = toPosix(file);
  const path = relativeToCwd(absPath, cwd);
  const kind = call.canonical === "write" ? "write" : "edit";

  const patch = asArray(meta?.structuredPatch);
  if (patch.length > 0) {
    const lines = patch.flatMap((hunk) => asArray(asRecord(hunk)?.lines).map(String));
    return [{ path, absPath, kind, ...patchLineStats(lines) }];
  }
  if (call.canonical === "write") {
    return [
      { path, absPath, kind, added: countLines(asString(call.input.content) ?? ""), removed: 0 },
    ];
  }
  const pairs = call.input.edits !== undefined ? asArray(call.input.edits) : [call.input];
  let added = 0;
  let removed = 0;
  for (const pair of pairs) {
    const rec = asRecord(pair);
    const stats = lineChangeStats(asString(rec?.old_string) ?? "", asString(rec?.new_string) ?? "");
    added += stats.added;
    removed += stats.removed;
  }
  return [{ path, absPath, kind, added, removed }];
}
