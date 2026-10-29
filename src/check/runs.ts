import type { CheckResult, Claim, EvidenceRef } from "../types.js";
import {
  describeWrite,
  runRef,
  shortCommand,
  stepLabel,
  writeRef,
  type Activity,
} from "./activity.js";
import { isFilteredTestRun, type CheckKind } from "./commands.js";
import type { CheckContext } from "./context.js";

const LABEL: Record<CheckKind, string> = {
  test: "test",
  build: "build",
  typecheck: "typecheck",
  lint: "lint",
};

/**
 * The shared logic for tests-pass, build-passes, typecheck-passes and
 * lint-passes: take the last run of that check, read its outcome, then make
 * sure no code changed after it.
 */
export function checkLastRun(kind: CheckKind, claim: Claim, ctx: CheckContext): CheckResult {
  const { activity } = ctx;
  const label = LABEL[kind];
  if (activity.toolCount === 0) {
    return { verdict: "unverified", evidence: [], reason: "No tools ran in this session." };
  }
  const runs = activity.runsOf(kind);
  const last = runs.at(-1);
  if (!last) {
    return {
      verdict: "unverified",
      evidence: [],
      reason: `No ${label} command ran in this session.`,
    };
  }

  const by = last.isSidechain ? " by a sub-agent" : "";
  const where = `${stepLabel(last.stepIndex)}${by}, ${shortCommand(last.result.segment)}`;
  const evidence: EvidenceRef[] = [runRef(last)];
  const { outcome, why } = last.result;

  if (outcome === "fail") {
    return { verdict: "contradicted", evidence, reason: `Last ${label} run (${where}) ${why}.` };
  }
  if (outcome === "no-tests") {
    return {
      verdict: "contradicted",
      evidence,
      reason: `Last test run (${where}) reported that no tests ran.`,
    };
  }
  if (outcome !== "pass") {
    return { verdict: "unverified", evidence, reason: `Last ${label} run (${where}) ${why}.` };
  }
  if (
    kind === "test" &&
    isFilteredTestRun(last.result.segment) &&
    /\b(?:all|every|whole|full|suite)\b/i.test(claim.text)
  ) {
    return {
      verdict: "unverified",
      evidence,
      reason: `Last test run (${where}) ran only part of the suite.`,
    };
  }

  const later = activity.codeWritesAfter(last.order, { ignoreTests: kind === "build" });
  const first = later[0];
  if (first) {
    evidence.push(...later.slice(0, 3).map(writeRef));
    return {
      verdict: "stale",
      evidence,
      reason: `Last ${label} run passed at ${stepLabel(last.stepIndex)}, but ${describeWrite(first)} after it${later.length > 1 ? ` (${later.length} changes in all)` : ""}.`,
    };
  }
  return {
    verdict: "verified",
    evidence,
    reason: `Last ${label} run (${where}) ${why}${afterLastCodeEdit(activity, last.order)}.`,
  };
}

function afterLastCodeEdit(activity: Activity, before: number): string {
  const last = activity
    .codeWritesAfter(-1)
    .filter((w) => w.order < before)
    .at(-1);
  return last ? `, after the last code edit at ${stepLabel(last.stepIndex)}` : "";
}

const COMMAND_SUBJECTS: [RegExp, RegExp][] = [
  [/^git push$/, /^git\s+(?:-[Cc]\s+\S+\s+)*push\b/],
  [/^git commit$/, /^git\s+(?:-[Cc]\s+\S+\s+)*commit\b/],
  [/migrat/i, /migrat|db:migrate|alembic\s+upgrade|prisma\s+(?:migrate|db\s+push)/i],
  [/seed/i, /\bseed/i],
  [/formatter/i, /prettier|black|gofmt|cargo\s+fmt|ruff\s+format|\bformat\b/i],
  [/codegen/i, /codegen|generate/i],
];

/** command-ran: a matching command exists, and the verdict follows its outcome. */
export function checkCommandRan(claim: Claim, ctx: CheckContext): CheckResult {
  const subject = claim.subject.trim().replace(/^npx\s+/, "");
  const match =
    COMMAND_SUBJECTS.find(([s]) => s.test(subject))?.[1] ??
    ((segment: string) =>
      segment === subject || segment.startsWith(`${subject} `) || subject.startsWith(segment));
  const test = match instanceof RegExp ? (s: string) => match.test(s) : match;
  const runs = ctx.activity.runsMatching(test);
  const last = runs.at(-1);
  if (!last) {
    return {
      verdict: "unverified",
      evidence: [],
      reason: `No command matching "${shortCommand(subject)}" appears in the transcript.`,
    };
  }
  const where = `${stepLabel(last.stepIndex)}${last.isSidechain ? " by a sub-agent" : ""}`;
  const evidence = [runRef(last)];
  const cmd = shortCommand(last.result.segment);
  const { outcome, why } = last.result;
  if (outcome === "pass")
    return { verdict: "verified", evidence, reason: `${cmd} ran at ${where} and ${why}.` };
  if (outcome === "fail")
    return { verdict: "contradicted", evidence, reason: `${cmd} ran at ${where} and ${why}.` };
  return { verdict: "unverified", evidence, reason: `${cmd} ran at ${where} but ${why}.` };
}

/** no-errors: any failing command after the last edit contradicts it; a passing check supports it. */
export function checkNoErrors(_claim: Claim, ctx: CheckContext): CheckResult {
  const { activity } = ctx;
  const after = activity.lastWrite()?.order ?? -1;
  const failed = activity.runs.find(
    (r) => r.order > after && r.call.exitCode !== null && r.call.exitCode !== 0,
  );
  if (failed) {
    const cmd =
      typeof failed.call.input.command === "string" ? failed.call.input.command : failed.call.name;
    return {
      verdict: "contradicted",
      evidence: [runRef(failed)],
      reason: `${shortCommand(cmd)} exited ${failed.call.exitCode} at ${stepLabel(failed.stepIndex)}, after the last edit.`,
    };
  }
  for (const kind of ["test", "build", "typecheck"] as const) {
    const pass = activity
      .runsOf(kind)
      .filter((r) => r.order > after && r.result.outcome === "pass")
      .at(-1);
    if (pass) {
      return {
        verdict: "verified",
        evidence: [runRef(pass)],
        reason: `No command failed after the last edit, and the ${kind} run at ${stepLabel(pass.stepIndex)} passed.`,
      };
    }
  }
  return {
    verdict: "unverified",
    evidence: [],
    reason: "No check ran after the last edit, so nothing shows the absence of errors.",
  };
}
