import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCases } from "../eval/lib/cases.js";
import { match } from "../eval/lib/score.js";
import { runSynthetic } from "../eval/lib/synthetic.js";
import { FLAG_IDS, VERDICTS } from "../src/types.js";
import { captureIo } from "./helpers/io.js";

describe("synthetic eval fixtures", async () => {
  const outcomes = await runSynthetic({
    llm: false,
    io: captureIo(mkdtempSync(path.join(tmpdir(), "receipts-ev-"))),
  });

  it("has at least 24 cases in both formats", () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(24);
    expect(new Set(cases.map((c) => c.format))).toEqual(new Set(["claude-code", "opencode"]));
  });

  it("covers every verdict and every flag", () => {
    const verdicts = new Set(loadCases().flatMap((c) => c.labels.claims.map((l) => l.verdict)));
    const flags = new Set(loadCases().flatMap((c) => c.labels.flags));
    expect([...verdicts].sort()).toEqual([...VERDICTS].sort());
    expect([...flags].sort()).toEqual([...FLAG_IDS].sort());
  });

  it.each(outcomes.map((o) => [o.case.name, o] as const))(
    "%s: finds each labelled claim with its verdict",
    (_name, o) => {
      const { pairs } = match(o.unit);
      expect(pairs.length).toBe(o.unit.truth.length);
      expect(pairs.map((p) => p.predicted)).toEqual(pairs.map((p) => p.truth));
      expect(o.unit.predicted.length).toBe(o.unit.truth.length);
    },
  );

  it.each(outcomes.map((o) => [o.case.name, o] as const))(
    "%s: raises exactly the labelled flags",
    (_name, o) => {
      expect(o.foundFlags).toEqual(o.expectedFlags);
    },
  );
});
