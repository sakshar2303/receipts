import type { DiffHunk, DiffLine, FileDiff, Session, ToolCall } from "../types.js";

/**
 * Rebuilds an approximate diff from the agent's own edit and write calls. Used
 * when there is no git repository. Line numbers are unknown, so hunks carry the
 * step instead, and a file is "added" only when its first change was a write.
 */
export function changeSetFromTranscript(session: Session): FileDiff[] {
  const files = new Map<string, FileDiff>();
  for (const step of session.steps) {
    for (const call of step.tools) {
      for (const edit of call.edits) {
        let file = files.get(edit.path);
        if (!file) {
          file = {
            path: edit.path,
            oldPath: edit.path,
            status:
              edit.kind === "write" ? "added" : edit.kind === "delete" ? "deleted" : "modified",
            binary: false,
            added: 0,
            removed: 0,
            hunks: [],
          };
          files.set(edit.path, file);
        }
        file.added += edit.added;
        file.removed += edit.removed;
        const hunk = hunkFromCall(call, step.index);
        if (hunk) file.hunks.push(hunk);
      }
    }
  }
  return [...files.values()];
}

function hunkFromCall(call: ToolCall, stepIndex: number): DiffHunk | null {
  const pairs = editPairs(call.input);
  if (pairs.length === 0) return null;
  const lines: DiffLine[] = [];
  for (const [before, after] of pairs) {
    for (const text of splitLines(before))
      lines.push({ kind: "del", text, oldLine: null, newLine: null });
    for (const text of splitLines(after))
      lines.push({ kind: "add", text, oldLine: null, newLine: null });
  }
  const removed = lines.filter((l) => l.kind === "del").length;
  return {
    header: `@@ step ${stepIndex} @@`,
    oldStart: 0,
    oldLines: removed,
    newStart: 0,
    newLines: lines.length - removed,
    lines,
  };
}

/** Before/after text pairs from the input shapes both formats use. */
function editPairs(input: Record<string, unknown>): [string, string][] {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (Array.isArray(input.edits)) {
    return input.edits.map((e: unknown) => {
      const rec = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
      return [str(rec.old_string), str(rec.new_string)];
    });
  }
  if ("content" in input) return [["", str(input.content)]];
  const before = str(input.old_string) || str(input.oldString);
  const after = str(input.new_string) || str(input.newString);
  return before || after ? [[before, after]] : [];
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
