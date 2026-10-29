import picomatch from "picomatch";
import type { Config } from "../config.js";
import type { EvidenceRef, Session, ToolCall } from "../types.js";
import { compileKinds, kindsOf, type CheckKind } from "./commands.js";
import { runOutcome, type RunOutcome } from "./outcome.js";
import { shellWrites } from "./shell-writes.js";

/** Position in the session: step first, then the call's place inside the step. */
export type Order = number;

export interface RunEvent {
  order: Order;
  stepIndex: number;
  call: ToolCall;
  isSidechain: boolean;
}

export interface WriteEvent {
  order: Order;
  stepIndex: number;
  toolId: string;
  /** null when a shell command changed files we cannot name. */
  path: string | null;
  via: "edit" | "shell";
  what: string;
  isSidechain: boolean;
}

/** Everything checkers need about what ran and what changed, in session order. */
export class Activity {
  readonly runs: RunEvent[] = [];
  readonly writes: WriteEvent[] = [];
  readonly kinds;
  readonly isTestFile: (p: string) => boolean;
  readonly isDocFile: (p: string) => boolean;
  readonly isManifest: (p: string) => boolean;
  readonly toolCount: number;

  constructor(
    readonly session: Session,
    readonly config: Config,
  ) {
    this.kinds = compileKinds(config);
    this.isTestFile = picomatch(config.testFiles, { dot: true });
    this.isDocFile = picomatch(config.docFiles, { dot: true, nocase: true });
    this.isManifest = picomatch(config.manifests, { dot: true });
    let count = 0;
    for (const step of session.steps) {
      step.tools.forEach((call, i) => {
        count++;
        const order = step.index * 10_000 + i;
        const base = { order, stepIndex: step.index, isSidechain: step.isSidechain };
        for (const edit of call.edits) {
          this.writes.push({
            ...base,
            toolId: call.id,
            path: edit.path,
            via: "edit",
            what: call.name,
          });
        }
        if (call.canonical !== "run") return;
        this.runs.push({ ...base, call });
        // A command that never started wrote nothing.
        if (call.status === "error" && call.exitCode === null) return;
        const command = typeof call.input.command === "string" ? call.input.command : "";
        for (const w of shellWrites(command, session.cwd)) {
          this.writes.push({ ...base, toolId: call.id, path: w.path, via: "shell", what: w.what });
        }
      });
    }
    this.toolCount = count;
  }

  /** Every run of a check kind, oldest first, with its outcome. Denied runs are left out. */
  runsOf(kind: CheckKind): (RunEvent & { result: RunOutcome })[] {
    return this.runs.flatMap((run) => {
      const result = runOutcome(run.call, (s) => kindsOf(s, this.kinds).includes(kind), kind);
      return result && result.outcome !== "not-run" ? [{ ...run, result }] : [];
    });
  }

  /** Every run with a segment the predicate accepts, oldest first, with its outcome. */
  runsMatching(match: (segment: string) => boolean): (RunEvent & { result: RunOutcome })[] {
    return this.runs.flatMap((run) => {
      const result = runOutcome(run.call, match, "command");
      return result && result.outcome !== "not-run" ? [{ ...run, result }] : [];
    });
  }

  /** Writes after a point that could change code. Docs never count; tests count unless excluded. */
  codeWritesAfter(order: Order, opts: { ignoreTests?: boolean } = {}): WriteEvent[] {
    return this.writes.filter(
      (w) =>
        w.order > order &&
        (w.path === null ||
          (!this.isDocFile(w.path) && !(opts.ignoreTests === true && this.isTestFile(w.path)))),
    );
  }

  lastWrite(): WriteEvent | undefined {
    return this.writes.at(-1);
  }
}

export function runRef(run: RunEvent & { result?: RunOutcome }): EvidenceRef {
  return {
    kind: "run",
    stepIndex: run.stepIndex,
    toolId: run.call.id,
    command: typeof run.call.input.command === "string" ? run.call.input.command : run.call.name,
    segment: run.result?.segment ?? null,
    exitCode: run.call.exitCode,
    isSidechain: run.isSidechain,
  };
}

export function writeRef(write: WriteEvent): EvidenceRef {
  return {
    kind: "edit",
    stepIndex: write.stepIndex,
    toolId: write.toolId,
    path: write.path ?? `(files changed by ${write.what})`,
    isSidechain: write.isSidechain,
  };
}

/** "step 48", counting from 1 the way people read a transcript. */
export const stepLabel = (stepIndex: number) => `step ${stepIndex + 1}`;

export function describeWrite(w: WriteEvent): string {
  const by = w.isSidechain ? " by a sub-agent" : "";
  return w.path === null
    ? `${w.what} at ${stepLabel(w.stepIndex)}${by} may have changed files`
    : `${w.path} was ${w.via === "shell" ? `changed by ${w.what}` : "edited"} at ${stepLabel(w.stepIndex)}${by}`;
}

export function shortCommand(segment: string): string {
  return segment.length > 48 ? `${segment.slice(0, 47)}…` : segment;
}
