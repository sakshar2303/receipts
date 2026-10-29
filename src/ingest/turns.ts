import { ReceiptsError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import type { Session } from "../types.js";
import { findFinalMessage } from "./build.js";

/**
 * Narrows a session to a range of turns. A turn starts at each human message,
 * so "3..5" is the third request through the work done for the fifth. Either
 * end may be left open ("4..", "..2"). Step numbers are kept as they were so
 * the receipt still points at the right place in the transcript.
 */
export function selectTurns(session: Session, spec: string): Session {
  const m = /^(\d*)\.\.(\d*)$/.exec(spec.trim()) ?? /^(\d+)()$/.exec(spec.trim());
  if (!m) throw usage(`--turns takes a range like 3..5, 4.. or ..2, not "${spec}".`);
  const starts = session.steps
    .filter((s) => !s.isSidechain && s.userText.trim() !== "")
    .map((s) => s.index);
  if (starts[0] !== session.steps[0]?.index) starts.unshift(session.steps[0]?.index ?? 0);
  const total = starts.length;
  const from = m[1] ? Number(m[1]) : 1;
  const to = m[2] ? Number(m[2]) : m[1] && spec.includes("..") ? total : from;
  if (from < 1 || to < from || to > total) {
    throw usage(
      `--turns ${spec} is outside this session, which has ${total} turn${total === 1 ? "" : "s"}.`,
    );
  }
  const first = starts[from - 1] ?? 0;
  const next = starts[to];
  const startAt = Date.parse(session.steps.find((s) => s.index === first)?.at ?? "");
  const endAt =
    next === undefined
      ? Infinity
      : Date.parse(session.steps.find((s) => s.index === next)?.at ?? "");
  // Sub-agent steps belong to a turn by time, since they have no human messages.
  const steps = session.steps.filter((s) => {
    if (!s.isSidechain) return s.index >= first && (next === undefined || s.index < next);
    const t = Date.parse(s.at);
    return t >= startAt && t < endAt;
  });
  return {
    ...session,
    startedAt: steps[0]?.at ?? session.startedAt,
    steps,
    finalMessage: findFinalMessage(steps),
  };
}

function usage(message: string): ReceiptsError {
  return new ReceiptsError(message, ExitCode.Usage);
}
