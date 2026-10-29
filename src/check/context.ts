import type { ChangeSet, CheckResult, Claim, EvidenceRef, FileDiff } from "../types.js";
import type { Activity } from "./activity.js";

export interface CheckContext {
  activity: Activity;
  changes: ChangeSet;
}

export type Checker = (claim: Claim, ctx: CheckContext) => CheckResult;

export function diffRef(file: FileDiff): EvidenceRef {
  return {
    kind: "diff",
    path: file.path,
    status: file.status,
    added: file.added,
    removed: file.removed,
  };
}

/**
 * Absence from a real diff is evidence; absence from the agent's own edit
 * records, or from a range we had to guess, is not.
 */
export function absent(
  ctx: CheckContext,
  contradiction: string,
  gap: string,
  evidence: EvidenceRef[] = [],
): CheckResult {
  const trustworthy = ctx.changes.source !== "transcript" && !ctx.changes.notice;
  return trustworthy
    ? { verdict: "contradicted", evidence, reason: contradiction }
    : { verdict: "unverified", evidence, reason: gap };
}

export function listPaths(paths: readonly string[], max = 3): string {
  const shown = paths.slice(0, max).join(", ");
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}
