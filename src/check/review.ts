import type { CheckResult, Claim, EvidenceRef } from "../types.js";
import { runRef } from "./activity.js";
import { diffRef, type CheckContext } from "./context.js";
import { sharesToken, tokens } from "./paths.js";

const REASONS: Record<"bug-fixed" | "feature-done" | "behaviour", string> = {
  "bug-fixed":
    "Whether the bug is fixed cannot be checked mechanically; review the related changes.",
  "feature-done":
    "Whether the feature works cannot be checked mechanically; a person needs to try it.",
  behaviour: "Behaviour cannot be checked mechanically; a person needs to look.",
};

/**
 * bug-fixed, feature-done and behaviour are always needs-review. Never
 * verified, whatever a model says. The evidence is context for the reviewer:
 * changed files that share words with the claim, and the last test run.
 */
export function checkNeedsReview(
  kind: keyof typeof REASONS,
  claim: Claim,
  ctx: CheckContext,
): CheckResult {
  const words = tokens(`${claim.subject} ${claim.text}`);
  const related = ctx.changes.files.filter((f) => sharesToken(words, tokens(f.path))).slice(0, 3);
  const evidence: EvidenceRef[] = related.map(diffRef);
  const lastTest = ctx.activity.runsOf("test").at(-1);
  if (lastTest) evidence.push(runRef(lastTest));
  return { verdict: "needs-review", evidence, reason: REASONS[kind] };
}
