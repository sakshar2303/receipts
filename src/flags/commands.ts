import path from "node:path";
import { runRef, stepLabel, type RunEvent } from "../check/activity.js";
import { kindsOf, normaliseSegment, splitChain } from "../check/commands.js";
import { INLINE_SCRIPT, WRITE_API } from "../check/shell-writes.js";
import { toPosix } from "../ingest/paths.js";
import type { Flag } from "../types.js";
import { makeFlag, type FlagContext } from "./context.js";
import { redactSecrets } from "./secrets.js";

const commandOf = (run: RunEvent) =>
  typeof run.call.input.command === "string" ? run.call.input.command : "";
const ran = (run: RunEvent) => !(run.call.status === "error" && run.call.exitCode === null);

/** Why a single command is dangerous, or null. `next` is the command it pipes into. */
function danger(
  segment: string,
  next: { joinedBy: string; text: string } | undefined,
  cwd: string,
): string | null {
  const s = normaliseSegment(segment);
  const words = s.split(/\s+/);
  if (words[0] === "rm" || (words[0] === "sudo" && words[1] === "rm")) {
    const flags = words.filter((w) => w.startsWith("-")).join("");
    const recursive = /r|R|--recursive/.test(flags);
    const force = /f|--force/.test(flags);
    const targets = words.slice(1).filter((w) => !w.startsWith("-") && w !== "rm");
    const outside = targets.find((t) => {
      const clean = t.replace(/^['"]|['"]$/g, "");
      // The home folder, the root, a parent folder or a bare glob are never the project.
      if (/^(?:\/\*?|~.*|\$HOME.*|\.\.(?:\/.*)?|\*)$/.test(clean)) return true;
      const abs = toPosix(clean);
      return (
        path.posix.isAbsolute(abs) &&
        cwd !== "" &&
        !`${abs}/`.startsWith(`${toPosix(cwd).replace(/\/+$/, "")}/`) &&
        !abs.startsWith("/tmp/") &&
        !abs.startsWith("/private/tmp/") &&
        !abs.startsWith("/var/folders/")
      );
    });
    if (recursive && force && outside) return `rm -rf on ${outside}`;
  }
  if (
    /^git\s+(?:-C\s+\S+\s+)*push\b/.test(s) &&
    /\s(?:--force(?!-with-lease)|-f)\b|\s\+\S+/.test(s)
  )
    return "git push --force";
  if (/^git\s+(?:-C\s+\S+\s+)*reset\b.*\s--hard\b/.test(s)) return "git reset --hard";
  if (/^git\b.*\s--no-verify\b/.test(s)) return "--no-verify";
  if (/^(?:sudo\s+)?chmod\b(?=.*\s-R\b)(?=.*\b777\b)/.test(s)) return "chmod -R 777";
  if (
    /^(?:curl|wget)\b/.test(s) &&
    next?.joinedBy === "|" &&
    /^(?:sudo\s+)?(?:ba|z|da)?sh\b/.test(next.text.trim())
  ) {
    return "a download piped into a shell";
  }
  return null;
}

/** dangerous-command: a destructive or safety-bypassing command actually ran. */
export function dangerousCommand(ctx: FlagContext): Flag | null {
  const found: { run: RunEvent; what: string }[] = [];
  for (const run of ctx.activity.runs.filter(ran)) {
    const segments = splitChain(commandOf(run));
    segments.forEach((seg, i) => {
      const what = danger(seg.text, segments[i + 1], ctx.activity.session.cwd);
      if (what) found.push({ run, what });
    });
  }
  if (found.length === 0) return null;
  const listed = found
    .slice(0, 3)
    .map((f) => `${f.what} at ${stepLabel(f.run.stepIndex)}`)
    .join(", ");
  return makeFlag(
    "dangerous-command",
    `The agent ran ${listed}${found.length > 3 ? ` and ${found.length - 3} more` : ""}.`,
    {
      evidence: found.map((f) => runRef(f.run)),
    },
  );
}

// Commands whose non-zero exit is an answer, not a failure.
const BENIGN =
  /^(?:grep|egrep|fgrep|rg|ag|test|\[|diff|cmp|which|command|type|pgrep|ls|find|stat|false|git\s+(?:diff|rev-parse|show-ref|ls-files|check-ignore|merge-base|symbolic-ref|grep))\b|--exit-code|--quiet/;
// Commands that only look at things. A failed look (a missing file, a typo in a
// query) is not work the agent left broken.
const INSPECTION =
  /^(?:cat|head|tail|less|more|echo|printf|sed\s+-n|wc|tree|du|df|file|pwd|env|printenv|nl|jq|awk|sort|uniq|cut|tr|basename|dirname|realpath|readlink|date|whoami|uname|sleep|git\s+(?:status|log|show|branch|remote|config\s+--get|blame|describe|tag\s+-l))\b/;
const isInspection = (segment: string, command: string) =>
  INSPECTION.test(segment) || (INLINE_SCRIPT.test(segment) && !WRITE_API.test(command));

const DENIES_FAILURE =
  /\b(?:no|zero|0|without(?:\s+any)?)\s+(?:errors?|failures?|issues|problems|warnings)\b|\berror[- ]free\b/gi;
const MENTIONS_FAILURE =
  /\bfail|\berror|\bexit(?:ed)?\s+(?:code\s+)?\d|\bbroke|\bdidn'?t\b|\bdid not\b|\bnot (?:pass|work)|\bissue|\bproblem|\bwarning|\bcrash/i;

/**
 * failing-command-ignored: a command failed, and the agent neither ran it
 * again nor said anything about a failure in its next few messages.
 */
export function failingCommandIgnored(ctx: FlagContext): Flag | null {
  const { activity } = ctx;
  const steps = activity.session.steps;
  const ignored: RunEvent[] = [];
  for (const run of activity.runs) {
    const exit = run.call.exitCode;
    if (exit === null || exit === 0) continue;
    const chain = splitChain(commandOf(run));
    const segments = chain.map((s) => normaliseSegment(s.text));
    const main = segments.filter((s) => !/^cd\b/.test(s));
    const command = commandOf(run);
    const quiet = (s: string) => BENIGN.test(s) || isInspection(s, command);
    if (main.length === 0 || main.every(quiet)) continue;
    // After ";" or "|" the exit code is the last command's; if that one only
    // looked at something, the failure is its answer, not broken work.
    const lastJoin = chain.at(-1)?.joinedBy ?? "";
    if (lastJoin !== "&&" && lastJoin !== "||" && quiet(segments.at(-1) ?? "")) continue;
    const head = main.find((s) => !quiet(s)) ?? "";
    const headKinds = kindsOf(head, activity.kinds);

    const retried = activity.runs.some((later) => {
      if (later.order <= run.order) return false;
      return splitChain(commandOf(later)).some((s) => {
        const seg = normaliseSegment(s.text);
        return seg === head || kindsOf(seg, activity.kinds).some((k) => headKinds.includes(k));
      });
    });
    if (retried) continue;

    // Naming the command is not acknowledging it failed ("the build succeeds"),
    // so only failure words count, and denials ("no errors") are removed first.
    const nextTexts = steps
      .filter((s) => s.index > run.stepIndex && s.isSidechain === run.isSidechain && s.text.trim())
      .slice(0, 3)
      .map((s) => s.text);
    const mentioned = nextTexts.some((t) => MENTIONS_FAILURE.test(t.replace(DENIES_FAILURE, "")));
    if (!mentioned) ignored.push(run);
  }
  if (ignored.length === 0) return null;
  const listed = ignored
    .slice(0, 3)
    .map(
      (r) =>
        `${redactSecrets(shorten(commandOf(r)))} (exit ${r.call.exitCode}, ${stepLabel(r.stepIndex)})`,
    )
    .join("; ");
  return makeFlag(
    "failing-command-ignored",
    `Not followed up: ${listed}${ignored.length > 3 ? `; and ${ignored.length - 3} more` : ""}.`,
    {
      evidence: ignored.map(runRef),
    },
  );
}

function shorten(command: string): string {
  const first = command.split("\n")[0] ?? "";
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}
