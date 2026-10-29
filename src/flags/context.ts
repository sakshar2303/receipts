import type { Activity } from "../check/activity.js";
import type { ChangeSet, Claim, EvidenceRef, Flag, FlagId, FlagLine } from "../types.js";
import { FLAG_INFO } from "./info.js";
import { redactSecrets } from "./secrets.js";

export interface FlagContext {
  activity: Activity;
  changes: ChangeSet;
  claims: readonly Claim[];
}

export type Detector = (ctx: FlagContext) => Flag | null;

const MAX_LINES = 40;

export function makeFlag(
  id: FlagId,
  detail: string,
  parts: {
    files?: string[];
    evidence?: EvidenceRef[];
    lines?: FlagLine[];
    heuristic?: boolean;
  } = {},
): Flag {
  const info = FLAG_INFO[id];
  return {
    id,
    severity: info.severity,
    title: info.title,
    detail,
    files: [...new Set(parts.files ?? [])],
    evidence: parts.evidence ?? [],
    lines: (parts.lines ?? []).slice(0, MAX_LINES).map((l) => ({
      path: l.path,
      line: { ...l.line, text: redactSecrets(l.line.text) },
    })),
    heuristic: parts.heuristic ?? false,
  };
}
