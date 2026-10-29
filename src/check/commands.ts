import type { Config } from "../config.js";

export type CheckKind = "test" | "build" | "typecheck" | "lint";
export const CHECK_KINDS: readonly CheckKind[] = ["test", "build", "typecheck", "lint"];

/** One command in a chain, and the operator that joined it to the one before. */
export interface Segment {
  text: string;
  /** "" for the first segment. */
  joinedBy: "" | "&&" | "||" | ";" | "|";
}

/**
 * Splits a shell command on &&, ||, ;, | and newlines, outside quotes and
 * outside heredoc bodies. Never executes anything.
 */
export function splitChain(command: string): Segment[] {
  const segments: Segment[] = [];
  let current = "";
  let joinedBy: Segment["joinedBy"] = "";
  let quote: string | null = null;
  const lines = stripHeredocs(command);
  for (let i = 0; i < lines.length; i++) {
    const ch = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (quote) {
      if (ch === "\\" && quote === '"') {
        current += ch + next;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    let op: Segment["joinedBy"] | null = null;
    if (ch === "&" && next === "&") op = "&&";
    else if (ch === "|" && next === "|") op = "||";
    else if (ch === "|" && lines[i - 1] !== ">" && next !== "&") op = "|";
    else if (ch === ";" || ch === "\n") op = ";";
    if (op === null) {
      current += ch;
      continue;
    }
    if (op.length === 2) i++;
    if (current.trim()) segments.push({ text: current.trim(), joinedBy });
    current = "";
    joinedBy = op;
  }
  if (current.trim()) segments.push({ text: current.trim(), joinedBy });
  return segments;
}

/** Heredoc bodies are data, not commands: "cat <<EOF ... EOF" keeps only its first line. */
function stripHeredocs(command: string): string {
  return command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, "<<$2$3");
}

/**
 * Removes noise that does not change what runs: leading env assignments,
 * `npx`, `pnpm exec`, `time`, `timeout N`, output redirections and `2>&1`.
 */
export function normaliseSegment(segment: string): string {
  let s = segment.trim();
  for (;;) {
    const before = s;
    s = s
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+/, "")
      .replace(
        /^(?:npx|bunx|pnpm\s+exec|pnpm\s+dlx|yarn\s+dlx|time|command|exec)\s+(?:--yes\s+|-y\s+)?/,
        "",
      )
      .replace(/^timeout\s+\S+\s+/, "");
    if (s === before) break;
  }
  return s
    .replace(/\s*\d?>>?\s*&?\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function compileKinds(config: Config): Record<CheckKind | "composite", RegExp[]> {
  const compile = (sources: string[]) => sources.map((s) => new RegExp(s, "i"));
  return {
    test: compile(config.commands.test),
    build: compile(config.commands.build),
    typecheck: compile(config.commands.typecheck),
    lint: compile(config.commands.lint),
    composite: compile(config.commands.composite),
  };
}

/** Which checks a normalised segment runs. A composite script ("npm run check") runs all four. */
export function kindsOf(
  segment: string,
  kinds: Record<CheckKind | "composite", RegExp[]>,
): CheckKind[] {
  if (kinds.composite.some((re) => re.test(segment))) return [...CHECK_KINDS];
  return CHECK_KINDS.filter((kind) => kinds[kind].some((re) => re.test(segment)));
}

const TEST_FILTER_FLAGS =
  /\s(?:-t|--testNamePattern|--grep|-g|-k|--filter|--run\s+\S+|-run|--only|--spec|--project)\b/;

/**
 * True when a test command runs only part of the suite: a name filter, or a
 * path argument ("vitest run test/parser"). "All tests pass" needs the whole suite.
 */
export function isFilteredTestRun(segment: string): boolean {
  if (TEST_FILTER_FLAGS.test(segment)) return true;
  // Only a known runner's own arguments can narrow the suite; composite scripts cannot.
  const runner =
    /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?\s*(?:--\s*)?|(?:vitest|jest|mocha|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test|bun\s+test|deno\s+test|node\s+--test)\s*)/.exec(
      segment,
    );
  if (!runner) return false;
  const args = segment
    .slice(runner[0].length)
    .replace(/^run\b\s*/, "")
    .split(/\s+/)
    .filter((a) => a && !a.startsWith("-"));
  // "go test ./..." and "cargo test" with no args are the whole suite.
  return args.some(
    (a) =>
      a !== "./..." &&
      a !== "." &&
      !/^\d+$/.test(a) &&
      !/^(?:\.\/)?(?:tests?|spec|__tests__)\/?$/.test(a),
  );
}
