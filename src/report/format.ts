import type { EvidenceRef, Verdict } from "../types.js";
import type { Receipt } from "./schema.js";

/** Report order: the problems first, proven claims last. */
export const VERDICT_ORDER: Verdict[] = [
  "contradicted",
  "stale",
  "unverified",
  "needs-review",
  "verified",
];

export const VERDICT_LABEL: Record<Verdict, string> = {
  verified: "verified",
  contradicted: "contradicted",
  stale: "stale",
  unverified: "unverified",
  "needs-review": "needs review",
};

export function sortedClaims(receipt: Receipt): Receipt["claims"] {
  return [...receipt.claims].sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.id - b.id,
  );
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat;
}

/** "step 14 · npm run build · exit 2", "diff · src/parser.ts". Steps count from 1. */
export function evidenceLabel(e: EvidenceRef | undefined): string {
  if (!e) return "none";
  if (e.kind === "run") {
    const exit = e.exitCode === null ? "no exit code" : `exit ${e.exitCode}`;
    const what = e.segment ?? e.command.split("\n")[0] ?? "";
    return `step ${e.stepIndex + 1} · ${oneLine(what, 28)} · ${exit}`;
  }
  if (e.kind === "edit") return `step ${e.stepIndex + 1} · ${e.path}`;
  return `diff · ${e.path}`;
}
