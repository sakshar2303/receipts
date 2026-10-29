import type { ToolCall } from "../types.js";
import { normaliseSegment, splitChain, type CheckKind } from "./commands.js";

export type Outcome = "pass" | "fail" | "no-tests" | "unknown" | "not-run";

export interface RunOutcome {
  outcome: Outcome;
  /** Why, in a clause that fits after "the run": "exited 1", "was piped to tail". */
  why: string;
  /** The segment that ran the check, normalised. */
  segment: string;
}

interface Summary {
  passed: number;
  failed: number;
}

const NO_TESTS =
  /\bno tests? (?:found|ran|collected|to run|were run)|\b0 tests? (?:ran|passed|run)|\bcollected 0 items|\bno test files found|^\s*Tests\s+0\b|\btests?:\s+0 total/im;

const COUNTERS: [RegExp, "passed" | "failed"][] = [
  [/(\d+)\s+(?:tests?\s+)?passed\b/gi, "passed"],
  [/(\d+)\s+passing\b/gi, "passed"],
  [/(\d+)\s+(?:tests?\s+)?failed\b/gi, "failed"],
  [/(\d+)\s+failing\b/gi, "failed"],
  [/(\d+)\s+errors?\s+during\s+collection/gi, "failed"],
  [/^#\s+pass\s+(\d+)/gim, "passed"],
  [/^#\s+fail\s+(\d+)/gim, "failed"],
];

/** Reads pass and fail counts from the summary lines of common test runners. */
export function parseTestSummary(output: string): Summary | "no-tests" | null {
  if (NO_TESTS.test(output)) return "no-tests";
  let passed = 0;
  let failed = 0;
  let found = false;
  for (const [re, field] of COUNTERS) {
    for (const m of output.matchAll(re)) {
      found = true;
      const n = Number(m[1]);
      if (field === "passed") passed = Math.max(passed, n);
      else failed = Math.max(failed, n);
    }
  }
  // Go and Rust print no counts on success, only "ok" lines.
  if (/^(?:FAIL|--- FAIL)\b|test result: FAILED/m.test(output))
    return { passed, failed: Math.max(failed, 1) };
  if (/^ok\s+\S+|test result: ok\./m.test(output)) return { passed: Math.max(passed, 1), failed };
  return found ? { passed, failed } : null;
}

const FAILURE_HINTS: Record<Exclude<CheckKind, "test"> | "command", RegExp> = {
  command: /\[rejected\]|failed to push|^fatal:|^error:/m,
  typecheck: /\berror TS\d+|\bFound [1-9]\d* errors?\b|^error:/m,
  lint: /✖\s*[1-9]\d* problems?|\bFound [1-9]\d* errors?\b|^\S+:\d+:\d+:?\s+(?:error|E\d+)/m,
  build: /\bBuild failed\b|\berror\[E\d+\]|^ERROR\b|\bnpm ERR!|ERR_PNPM/m,
};

// Output that shows a git push or commit went through, when the exit code was piped away.
const SUCCESS_HINTS =
  /\s\S+\s+->\s+\S+|Everything up-to-date|^\[[^\]\s]+(?: \([^)]*\))? [0-9a-f]{7,}\]/m;

/**
 * Decides whether a run of `kind` inside this tool call passed. The exit code
 * belongs to the last command in the chain, so it speaks for the check only
 * when the check is last. Otherwise the output decides: a test summary, printed
 * errors, or a clean tail. Without either the answer is unknown, never a pass.
 */
export function runOutcome(
  call: ToolCall,
  matches: (segment: string) => boolean,
  kind: CheckKind | "command",
): RunOutcome | null {
  const command = typeof call.input.command === "string" ? call.input.command : "";
  const segments = splitChain(command).map((s) => ({ ...s, text: normaliseSegment(s.text) }));
  let idx = -1;
  segments.forEach((s, i) => {
    if (matches(s.text)) idx = i;
  });
  if (idx < 0) return null;
  const segment = segments[idx]?.text ?? "";
  const base = { segment };

  if (call.status === "error" && call.exitCode === null) {
    return { ...base, outcome: "not-run", why: call.note ?? "did not run" };
  }
  if (call.status === "interrupted" || call.exitCode === null) {
    return { ...base, outcome: "unknown", why: call.note ?? "did not complete" };
  }

  const summary = kind === "test" ? parseTestSummary(call.output) : null;
  if (summary === "no-tests")
    return { ...base, outcome: "no-tests", why: "reported that no tests ran" };

  // The exit code is the last command's. It is the check's own when the check
  // is last and an earlier "||" could not have skipped it.
  const reliable =
    idx === segments.length - 1 && segments.slice(1, idx + 1).every((s) => s.joinedBy !== "||");

  if (reliable) {
    if (call.exitCode !== 0) return { ...base, outcome: "fail", why: `exited ${call.exitCode}` };
    if (summary && summary.failed > 0) {
      return { ...base, outcome: "fail", why: `exited 0 but reported ${summary.failed} failed` };
    }
    return { ...base, outcome: "pass", why: "exited 0" };
  }

  if (summary && summary.failed > 0) {
    return { ...base, outcome: "fail", why: `reported ${summary.failed} failed` };
  }
  if (kind !== "test" && FAILURE_HINTS[kind].test(call.output)) {
    return { ...base, outcome: "fail", why: "printed errors" };
  }
  // A failing command short-circuits "&&" and its code becomes the whole chain's.
  // So exit 0 proves the check passed when it is followed by "&&" and nothing
  // later ("||" or ";") could have replaced that code. Pipes bind tighter than
  // "&&", so "check && git push | tail" still counts.
  const later = segments[idx + 1];
  const joins = segments.slice(1).map((s) => s.joinedBy);
  const after = segments.slice(idx + 2).map((s) => s.joinedBy);
  if (
    call.exitCode === 0 &&
    later?.joinedBy === "&&" &&
    !joins.includes("||") &&
    !after.includes(";")
  ) {
    return { ...base, outcome: "pass", why: "exited 0 in an && chain" };
  }
  if (summary && summary.passed > 0) {
    return { ...base, outcome: "pass", why: `reported ${summary.passed} passed` };
  }

  const viewer =
    later?.joinedBy === "|" ? (/^(?:tail|head|cat|tee)\b/.exec(later.text)?.[0] ?? null) : null;
  // Piped into tail or head, the visible output is the check's own: compilers
  // and linters print their errors, so silence after the pipe means success.
  if (viewer && (kind === "typecheck" || kind === "lint" || kind === "build")) {
    return {
      ...base,
      outcome: "pass",
      why: `was piped to ${viewer}, and its output shows no errors`,
    };
  }
  if (viewer && kind === "command" && SUCCESS_HINTS.test(call.output)) {
    return {
      ...base,
      outcome: "pass",
      why: `was piped to ${viewer}, and its output shows it succeeded`,
    };
  }
  return { ...base, outcome: "unknown", why: unreliableWhy(later, call.exitCode) };
}

function unreliableWhy(
  later: { joinedBy: string; text: string } | undefined,
  exit: number,
): string {
  if (later?.joinedBy === "|") {
    return `was piped to ${later.text.split(" ")[0] ?? "another command"}, so the exit code is not its own`;
  }
  if (later?.joinedBy === "||") return "was followed by ||, which hides a failure";
  if (later?.joinedBy === ";")
    return "was followed by another command, so the exit code is not its own";
  if (later)
    return `was part of a chain that exited ${exit}, and it is unclear which command failed`;
  return "ran only if an earlier command failed, so the exit code may not be its own";
}
