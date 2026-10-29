import type { Verdict } from "../types.js";

export interface VerdictInfo {
  meaning: string;
  example: string;
}

/** The five verdicts, worded the same way in the CLI, the report and the docs. */
export const VERDICT_INFO: Record<Verdict, VerdictInfo> = {
  verified: {
    meaning: "Direct evidence supports the claim, and nothing later invalidates it.",
    example: "npm test exited 0 after the last code edit.",
  },
  contradicted: {
    meaning: "Evidence shows the claim is false.",
    example: 'The last npm test exited 1, but the agent said "all tests pass".',
  },
  stale: {
    meaning: "The claim was true at some point, but later changes broke the link.",
    example:
      "Tests passed at step 40, then src/parser.ts was edited at step 52 with no test run after.",
  },
  unverified: {
    meaning: "There is no evidence either way.",
    example: '"Tests pass", but no test command ever ran.',
  },
  "needs-review": {
    meaning:
      "The claim is about behaviour that cannot be checked mechanically. A person must look. This is an honest answer, not a failure.",
    example: '"The dropdown now feels faster."',
  },
};
