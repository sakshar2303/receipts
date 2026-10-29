import { readFileSync } from "node:fs";
import { inputNotFound } from "../errors.js";
import type { DiffHunk, FileDiff } from "../types.js";

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Reads a patch file. Bytes that are not valid UTF-8 become U+FFFD instead of failing. */
export function readPatchFile(file: string): FileDiff[] {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    throw inputNotFound(`Patch file not found or unreadable: ${file}`);
  }
  return parseUnifiedDiff(decodeUtf8(bytes));
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Parses `git diff` output and plain `diff -u` patches. Handles new, deleted,
 * renamed and binary files, quoted paths, and CRLF line endings.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  const start = (path: string): FileDiff => {
    file = {
      path,
      oldPath: path,
      status: "modified",
      binary: false,
      added: 0,
      removed: 0,
      hunks: [],
    };
    hunk = undefined;
    files.push(file);
    return file;
  };

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line.startsWith("diff --git ")) {
      const [a, b] = splitGitHeader(line.slice("diff --git ".length));
      const current = start(b);
      current.oldPath = a;
      continue;
    }
    // Inside a hunk, body lines win over header-looking lines ("--- x" can be a removed line).
    if (
      file &&
      hunk &&
      (oldLine < hunk.oldStart + hunk.oldLines || newLine < hunk.newStart + hunk.newLines)
    ) {
      if (line.startsWith("+")) {
        hunk.lines.push({ kind: "add", text: line.slice(1), oldLine: null, newLine: newLine++ });
        file.added++;
        continue;
      }
      if (line.startsWith("-")) {
        hunk.lines.push({ kind: "del", text: line.slice(1), oldLine: oldLine++, newLine: null });
        file.removed++;
        continue;
      }
      if (line.startsWith(" ") || line === "") {
        hunk.lines.push({
          kind: "context",
          text: line.slice(1),
          oldLine: oldLine++,
          newLine: newLine++,
        });
        continue;
      }
    }
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"

    if (line.startsWith("--- ")) {
      const path = stripPrefix(line.slice(4));
      // A plain `diff -u` patch has no "diff --git" line; "---" starts a new file.
      const current = file && !file.hunks.length && !hunk ? file : start(path ?? "");
      if (path === null) current.status = "added";
      else current.oldPath = path;
      continue;
    }
    if (line.startsWith("+++ ") && file) {
      const path = stripPrefix(line.slice(4));
      if (path === null) file.status = "deleted";
      else file.path = path;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) {
      file.oldPath = unquote(line.slice("rename from ".length));
      file.status = "renamed";
    } else if (line.startsWith("rename to ")) {
      file.path = unquote(line.slice("rename to ".length));
      file.status = "renamed";
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      file.binary = true;
    } else {
      const m = HUNK.exec(line);
      if (m) {
        hunk = {
          header: line,
          oldStart: Number(m[1]),
          oldLines: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newLines: m[4] === undefined ? 1 : Number(m[4]),
          lines: [],
        };
        oldLine = hunk.oldStart;
        newLine = hunk.newStart;
        file.hunks.push(hunk);
      }
    }
  }
  for (const f of files) {
    if (f.status === "deleted") f.path = f.oldPath;
    if (f.status === "added") f.oldPath = f.path;
  }
  return files.filter((f) => f.path !== "");
}

/** "/dev/null" means the file does not exist on that side. */
function stripPrefix(spec: string): string | null {
  const path = unquote(spec.split("\t")[0] ?? "");
  if (path === "/dev/null") return null;
  return path.replace(/^[ab]\//, "");
}

function splitGitHeader(rest: string): [string, string] {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1);
    return [stripPrefix(rest.slice(0, end + 1)) ?? "", stripPrefix(rest.slice(end + 2)) ?? ""];
  }
  // Without quotes the two paths are the same length when the file was not renamed.
  const mid = rest.indexOf(" b/");
  return [stripPrefix(rest.slice(0, mid)) ?? "", stripPrefix(rest.slice(mid + 1)) ?? ""];
}

/** Git quotes paths with special characters and escapes them C-style, including octal bytes. */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  const bytes: number[] = [];
  const body = path.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? "";
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = body[++i] ?? "";
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(
        ({ n: 10, t: 9, '"': 34, "\\": 92 } as Record<string, number>)[next] ?? next.charCodeAt(0),
      );
    }
  }
  return decodeUtf8(Uint8Array.from(bytes));
}
