import { DEFAULT_CONFIG, type Config } from "../../src/config.js";
import { buildContext, checkClaims } from "../../src/check/index.js";
import type {
  ChangeSet,
  CheckedClaim,
  ClaimType,
  DiffLine,
  FileDiff,
  Session,
  Step,
} from "../../src/types.js";
import { makeSession } from "./session.js";

export function claim(type: ClaimType, subject = "", text = "All tests pass") {
  return {
    id: 1,
    type,
    subject,
    text,
    span: { start: 0, end: text.length },
    extractedBy: "pattern" as const,
  };
}

export function file(
  path: string,
  status: FileDiff["status"] = "modified",
  added = 1,
  removed = 0,
  lines: DiffLine[] = [],
): FileDiff {
  return {
    path,
    oldPath: path,
    status,
    binary: false,
    added,
    removed,
    hunks: lines.length
      ? [{ header: "@@", oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines }]
      : [],
  };
}

export const add = (text: string): DiffLine => ({ kind: "add", text, oldLine: null, newLine: 1 });
export const del = (text: string): DiffLine => ({ kind: "del", text, oldLine: 1, newLine: null });

export function gitChanges(files: FileDiff[] = [], extra: Partial<ChangeSet> = {}): ChangeSet {
  return { source: "git", label: "HEAD...working tree", files, ...extra };
}

/** Runs one claim through its checker against hand-built steps and changes. */
export function check(
  type: ClaimType,
  steps: Partial<Step>[],
  options: {
    subject?: string;
    text?: string;
    changes?: ChangeSet;
    config?: Config;
    session?: Session;
  } = {},
): CheckedClaim {
  const session = options.session ?? makeSession("/work/app", steps);
  const ctx = buildContext(
    session,
    options.changes ?? gitChanges(),
    options.config ?? DEFAULT_CONFIG,
  );
  const [result] = checkClaims(
    [claim(type, options.subject ?? "", options.text ?? "All tests pass")],
    ctx,
  );
  if (!result) throw new Error("claim was dropped");
  return result;
}
