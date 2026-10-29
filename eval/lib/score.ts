import type { Receipt } from "../../src/report/schema.js";
import { VERDICTS, type Span, type Verdict } from "../../src/types.js";

/** A claim a person (or a case file) says is really in the message, with its true verdict. */
export interface TruthClaim {
  span: Span;
  verdict: Verdict;
}

/** One final message to score: what is true, and what Receipts produced. */
export interface ScoredUnit {
  truth: TruthClaim[];
  /** Claims a person said Receipts missed, beyond the labelled ones. */
  missed: number;
  predicted: Receipt["claims"];
}

export interface Pair {
  truth: Verdict;
  predicted: Verdict;
}

export interface Scores {
  units: number;
  truthClaims: number;
  predictedClaims: number;
  found: number;
  extractionPrecision: number;
  extractionRecall: number;
  pairs: Pair[];
  verdictAccuracy: number;
  /** Claims marked verified whose true verdict is anything else, over all claims marked verified. */
  falseVerifiedRate: number;
  falseVerified: number;
  markedVerified: number;
  perVerdict: Record<
    Verdict,
    { precision: number; recall: number; predicted: number; actual: number }
  >;
  /** Units with at least one true contradicted, stale or unverified claim. */
  unitsWithProblems: number;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
const ratio = (n: number, d: number) => (d === 0 ? Number.NaN : n / d);

/** Matches predicted claims to true ones one-to-one by overlapping spans. */
export function match(unit: ScoredUnit): {
  pairs: Pair[];
  foundTruth: number;
  matchedPredicted: number;
} {
  const used = new Set<number>();
  const pairs: Pair[] = [];
  for (const t of unit.truth) {
    const i = unit.predicted.findIndex((p, k) => !used.has(k) && overlaps(p.span, t.span));
    if (i < 0) continue;
    used.add(i);
    pairs.push({ truth: t.verdict, predicted: unit.predicted[i]?.verdict ?? "unverified" });
  }
  return { pairs, foundTruth: pairs.length, matchedPredicted: used.size };
}

export function score(units: readonly ScoredUnit[]): Scores {
  let truthClaims = 0;
  let predictedClaims = 0;
  let found = 0;
  let matchedPredicted = 0;
  let unitsWithProblems = 0;
  const pairs: Pair[] = [];
  for (const unit of units) {
    const m = match(unit);
    truthClaims += unit.truth.length + unit.missed;
    predictedClaims += unit.predicted.length;
    found += m.foundTruth;
    matchedPredicted += m.matchedPredicted;
    pairs.push(...m.pairs);
    if (
      unit.truth.some(
        (t) => t.verdict === "contradicted" || t.verdict === "stale" || t.verdict === "unverified",
      )
    ) {
      unitsWithProblems++;
    }
  }
  const correct = pairs.filter((p) => p.truth === p.predicted).length;
  const markedVerified = pairs.filter((p) => p.predicted === "verified").length;
  const falseVerified = pairs.filter(
    (p) => p.predicted === "verified" && p.truth !== "verified",
  ).length;
  const perVerdict = Object.fromEntries(
    VERDICTS.map((v) => {
      const predicted = pairs.filter((p) => p.predicted === v).length;
      const actual = pairs.filter((p) => p.truth === v).length;
      const hit = pairs.filter((p) => p.predicted === v && p.truth === v).length;
      return [
        v,
        { precision: ratio(hit, predicted), recall: ratio(hit, actual), predicted, actual },
      ];
    }),
  ) as Scores["perVerdict"];
  return {
    units: units.length,
    truthClaims,
    predictedClaims,
    found,
    extractionPrecision: ratio(matchedPredicted, predictedClaims),
    extractionRecall: ratio(found, truthClaims),
    pairs,
    verdictAccuracy: ratio(correct, pairs.length),
    falseVerifiedRate: ratio(falseVerified, markedVerified),
    falseVerified,
    markedVerified,
    perVerdict,
    unitsWithProblems,
  };
}

export function pct(x: number): string {
  return Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`;
}
