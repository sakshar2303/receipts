import { buildReceiptFor, type CheckOptions, type Io } from "../../src/commands/check.js";
import type { FlagId } from "../../src/types.js";
import { loadCases, materialise, type EvalCase } from "./cases.js";
import type { ScoredUnit, TruthClaim } from "./score.js";

export interface CaseOutcome {
  case: EvalCase;
  unit: ScoredUnit;
  expectedFlags: FlagId[];
  foundFlags: FlagId[];
}

/** Runs every hand-written case through the real pipeline. */
export async function runSynthetic(options: {
  llm: boolean;
  io: Io;
  model?: string;
}): Promise<CaseOutcome[]> {
  const outcomes: CaseOutcome[] = [];
  for (const c of loadCases()) {
    const m = materialise(c);
    const check: CheckOptions = {
      format: "json",
      out: m.dir,
      llm: options.llm,
      failOn: [],
      quiet: true,
      ...(m.db ? { db: m.db } : {}),
      ...(m.diff ? { diff: m.diff } : {}),
      ...(options.model ? { model: options.model } : {}),
    };
    const receipt = await buildReceiptFor(m.target, check, { ...options.io, cwd: m.dir });
    const text = receipt.finalMessage.text;
    const truth: TruthClaim[] = c.labels.claims.map((l) => {
      const start = text.indexOf(l.text);
      if (start < 0) throw new Error(`${c.name}: label "${l.text}" is not in the final message`);
      return { span: { start, end: start + l.text.length }, verdict: l.verdict };
    });
    outcomes.push({
      case: c,
      unit: { truth, missed: 0, predicted: receipt.claims },
      expectedFlags: [...c.labels.flags].sort(),
      foundFlags: receipt.flags.map((f) => f.id).sort(),
    });
  }
  return outcomes;
}

export function flagScores(outcomes: readonly CaseOutcome[]): {
  precision: number;
  recall: number;
  expected: number;
} {
  let tp = 0;
  let found = 0;
  let expected = 0;
  for (const o of outcomes) {
    found += o.foundFlags.length;
    expected += o.expectedFlags.length;
    tp += o.foundFlags.filter((f) => o.expectedFlags.includes(f)).length;
  }
  return {
    precision: found ? tp / found : Number.NaN,
    recall: expected ? tp / expected : Number.NaN,
    expected,
  };
}
