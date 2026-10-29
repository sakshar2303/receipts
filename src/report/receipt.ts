import path from "node:path";
import { CHECK_KINDS } from "../check/commands.js";
import type { Activity } from "../check/activity.js";
import { matchPaths } from "../check/paths.js";
import { redactSecrets } from "../flags/secrets.js";
import { clipOutput } from "../ingest/text.js";
import {
  VERDICTS,
  type ChangeSet,
  type CheckedClaim,
  type ClaimType,
  type Flag,
  type FlagId,
  type Session,
  type Verdict,
} from "../types.js";
import { VERSION } from "../version.js";
import { SCHEMA_VERSION, type Receipt, type ReceiptFile, type ReceiptStep } from "./schema.js";

const DISPLAY_OUTPUT = 8 * 1024;
const DISPLAY_TEXT = 2 * 1024;
const MAX_LINES_PER_FILE = 400;

export interface ReceiptInput {
  session: Session;
  activity: Activity;
  changes: ChangeSet;
  claims: CheckedClaim[];
  flags: Flag[];
  llm: { model: string | null; notice: string | null };
  turns: string | null;
}

/** Assembles everything into one report object, then redacts every string in it. */
export function buildReceipt(input: ReceiptInput): Receipt {
  const { session, changes, claims, flags } = input;
  const final = session.finalMessage ?? { text: "", stepIndex: 0 };
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const c of claims) counts[c.verdict]++;

  const notices = [changes.notice, input.llm.notice].filter((n): n is string => Boolean(n));
  const receipt: Receipt = {
    schemaVersion: SCHEMA_VERSION,
    receiptsVersion: VERSION,
    generatedAt: new Date().toISOString(),
    session: {
      id: session.id,
      source: session.source,
      title: session.title,
      repo: path.basename(session.cwd) || session.cwd,
      model: mainModel(session),
      startedAt: session.startedAt,
      stepCount: session.steps.length,
      turns: input.turns,
    },
    changes: {
      source: changes.source,
      label: changes.label,
      notice: changes.notice ?? null,
      files: changes.files.map((f) => receiptFile(f, claims, flags, final.text)),
    },
    finalMessage: final,
    claims,
    counts,
    summary: summarise(claims),
    flags,
    llm: input.llm,
    notices,
    steps: receiptSteps(input),
  };
  return redactDeep(receipt);
}

function mainModel(session: Session): string {
  const seen = new Map<string, number>();
  for (const s of session.steps)
    if (!s.isSidechain && s.model) seen.set(s.model, (seen.get(s.model) ?? 0) + 1);
  return [...seen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}

function receiptFile(
  file: ChangeSet["files"][number],
  claims: CheckedClaim[],
  flags: Flag[],
  message: string,
): ReceiptFile {
  let budget = MAX_LINES_PER_FILE;
  const hunks = [];
  for (const hunk of file.hunks) {
    if (budget <= 0) break;
    hunks.push({ ...hunk, lines: hunk.lines.slice(0, budget) });
    budget -= hunk.lines.length;
  }
  const mentioned =
    message.includes(file.path) ||
    message.includes(path.posix.basename(file.path)) ||
    claims.some((c) => /^file-/.test(c.type) && matchPaths(c.subject, [file.path]).length > 0);
  const flagIds: FlagId[] = flags.filter((f) => f.files.includes(file.path)).map((f) => f.id);
  return { ...file, hunks, truncated: budget < 0, mentioned, flags: flagIds };
}

/**
 * Only the tool calls a reader can open from a claim or flag (and failures)
 * keep their output. Every other call keeps its shape for the timeline.
 */
function receiptSteps({ session, activity, claims, flags }: ReceiptInput): ReceiptStep[] {
  const wanted = new Set<string>();
  for (const e of [...claims.flatMap((c) => c.evidence), ...flags.flatMap((f) => f.evidence)]) {
    if (e.kind === "run" || e.kind === "edit") wanted.add(e.toolId);
  }
  // One pass per check kind; looking each call up separately would be quadratic.
  const checks = new Map<string, ReceiptStep["tools"][number]["checks"]>();
  for (const kind of CHECK_KINDS) {
    for (const run of activity.runsOf(kind)) {
      const outcome = run.result.outcome === "not-run" ? "unknown" : run.result.outcome;
      checks.set(run.call.id, [...(checks.get(run.call.id) ?? []), { kind, outcome }]);
    }
  }
  return session.steps.map((step) => ({
    index: step.index,
    at: step.at,
    model: step.model,
    isSidechain: step.isSidechain,
    text: clipOutput(step.text, DISPLAY_TEXT),
    tools: step.tools.map((call) => {
      const command = typeof call.input.command === "string" ? call.input.command : null;
      const keep = wanted.has(call.id) || call.status === "error";
      return {
        id: call.id,
        name: call.name,
        canonical: call.canonical,
        command,
        exitCode: call.exitCode,
        status: call.status,
        note: call.note ?? null,
        output: keep ? clipOutput(call.output, DISPLAY_OUTPUT) : "",
        paths: call.edits.map((e) => e.path),
        checks: checks.get(call.id) ?? [],
      };
    }),
  }));
}

const TYPE_LABEL: Partial<Record<ClaimType, string>> = {
  "tests-pass": "test claim",
  "build-passes": "build claim",
  "typecheck-passes": "typecheck claim",
  "lint-passes": "lint claim",
  "tests-added": "claim about new tests",
  "no-errors": "no-errors claim",
};

const PRIORITY: Verdict[] = ["contradicted", "stale", "unverified", "needs-review"];

/**
 * One honest sentence, or two, from the counts: how many claims hold, then the
 * worst problem in plain words.
 */
export function summarise(claims: readonly CheckedClaim[]): string {
  if (claims.length === 0) return "The final message makes no claims Receipts can check.";
  const verified = claims.filter((c) => c.verdict === "verified").length;
  const first =
    verified === claims.length
      ? claims.length === 1
        ? "The one claim is proven."
        : `All ${claims.length} claims are proven.`
      : `${verified} of ${claims.length} claim${claims.length > 1 ? "s are" : " is"} proven.`;
  for (const verdict of PRIORITY) {
    const worst = claims.find((c) => c.verdict === verdict);
    if (!worst) continue;
    const what = TYPE_LABEL[worst.type] ?? `claim "${worst.text}"`;
    const reason = worst.reason.charAt(0).toLowerCase() + worst.reason.slice(1);
    const label = verdict === "needs-review" ? "needs a person to review it" : `is ${verdict}`;
    return verdict === "needs-review"
      ? `${first} The ${what} ${label}.`
      : `${first} The ${what} ${label}: ${reason}`;
  }
  return first;
}

function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
