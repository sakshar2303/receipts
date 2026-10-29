import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FlagId, Verdict } from "../../src/types.js";
import { buildOpencodeDb, type FixtureSession, type FixtureTool } from "./opencode-fixture.js";

/** One step of a hand-written case. Exactly one of the action keys is set. */
export interface CaseStep {
  text?: string;
  user?: string;
  run?: string;
  /** Exit code of `run`; null means it never finished. */
  exit?: number | null;
  out?: string;
  /** A run the harness refused to execute. */
  denied?: boolean;
  edit?: string;
  add?: number;
  del?: number;
  write?: string;
  content?: string;
  /** Done by a sub-agent. */
  sub?: boolean;
}

export interface LabelledClaim {
  /** Exact text from the final message; the extracted claim must overlap it. */
  text: string;
  verdict: Verdict;
}

export interface EvalCase {
  name: string;
  format: "claude-code" | "opencode";
  title: string;
  /** What the case is about, in one sentence. */
  about: string;
  steps: CaseStep[];
  final: string;
  patch?: string;
  labels: { claims: LabelledClaim[]; flags: FlagId[] };
}

// npm scripts and tests run from the package root; the eval is built elsewhere, so
// paths are resolved from the working folder rather than this module.
export const CASES_DIR = path.join(process.cwd(), "eval", "fixtures");

// Fake credentials are assembled here so no file in the repository holds one.
const PLACEHOLDERS: Record<string, string> = {
  "{{FAKE_GITHUB_TOKEN}}": "gh" + "p_" + "Fx9Lm2Qa7Rt4Yu8Io1Pz6Wc3Vb5Nd0Ke2Hj7",
};
const fill = (s: string) =>
  Object.entries(PLACEHOLDERS).reduce((t, [k, v]) => t.split(k).join(v), s);

export function loadCases(dir = CASES_DIR): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as EvalCase);
}

export interface Materialised {
  /** A .jsonl path, or the session id inside `db`. */
  target: string;
  db?: string;
  diff?: string;
  dir: string;
}

/** Writes a case to disk in its format, plus its patch. */
export function materialise(c: EvalCase): Materialised {
  const dir = mkdtempSync(path.join(tmpdir(), `receipts-eval-${c.name}-`));
  const diff = c.patch ? path.join(dir, "changes.patch") : undefined;
  if (diff && c.patch) writeFileSync(diff, fill(c.patch));
  const extra = diff ? { diff } : {};
  if (c.format === "opencode") {
    return { target: `ses_${c.name}`, db: buildOpencodeDb([toOpencode(c)], dir), dir, ...extra };
  }
  const file = path.join(dir, `${c.name}.jsonl`);
  writeFileSync(
    file,
    toClaudeCode(c)
      .map((l) => JSON.stringify(l))
      .join("\n"),
  );
  return { target: file, dir, ...extra };
}

const lines = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join("\n");

function toClaudeCode(c: EvalCase): object[] {
  const cwd = `/work/${c.name}`;
  let t = Date.UTC(2026, 0, 10, 10, 0, 0);
  const at = () => new Date((t += 2000)).toISOString();
  const base = (sub?: boolean) => ({ sessionId: c.name, cwd, isSidechain: sub === true });
  const out: object[] = [{ type: "custom-title", customTitle: c.title, sessionId: c.name }];
  out.push({
    type: "user",
    ...base(),
    timestamp: at(),
    message: { role: "user", content: c.about },
  });
  let n = 0;
  for (const s of c.steps) {
    n++;
    if (s.user) {
      out.push({
        type: "user",
        ...base(),
        timestamp: at(),
        message: { role: "user", content: s.user },
      });
      continue;
    }
    const id = `toolu_${n}`;
    const content: object[] = s.text ? [{ type: "text", text: fill(s.text) }] : [];
    let input: Record<string, unknown> | null = null;
    let name = "";
    if (s.run !== undefined) [name, input] = ["Bash", { command: fill(s.run) }];
    else if (s.edit)
      [name, input] = [
        "Edit",
        {
          file_path: `${cwd}/${s.edit}`,
          old_string: lines(s.del ?? 0, "old"),
          new_string: lines(s.add ?? 1, "new"),
        },
      ];
    else if (s.write)
      [name, input] = [
        "Write",
        { file_path: `${cwd}/${s.write}`, content: fill(s.content ?? lines(s.add ?? 1, "new")) },
      ];
    if (input) content.push({ type: "tool_use", id, name, input });
    out.push({
      type: "assistant",
      ...base(s.sub),
      timestamp: at(),
      message: { id: `msg_${n}`, model: "eval-model", content },
    });
    if (!input) continue;

    const output = fill(s.out ?? "");
    let block: Record<string, unknown> = {
      type: "tool_result",
      tool_use_id: id,
      content: output || "ok",
    };
    let result: unknown = { stdout: output, stderr: "", interrupted: false };
    if (s.run !== undefined && s.denied) {
      block = {
        ...block,
        is_error: true,
        content: "Permission to use Bash with this command has been denied.",
      };
      result = "Error: Permission to use Bash with this command has been denied.";
    } else if (s.run !== undefined && s.exit === null) {
      result = { stdout: output, stderr: "", interrupted: true };
    } else if (s.run !== undefined && (s.exit ?? 0) !== 0) {
      block = { ...block, is_error: true, content: `Exit code ${s.exit}\n${output}` };
      result = `Error: Exit code ${s.exit}\n${output}`;
    }
    out.push({
      type: "user",
      ...base(s.sub),
      timestamp: at(),
      toolUseResult: result,
      message: { role: "user", content: [block] },
    });
  }
  out.push({
    type: "assistant",
    ...base(),
    timestamp: at(),
    message: {
      id: "msg_final",
      model: "eval-model",
      content: [{ type: "text", text: fill(c.final) }],
    },
  });
  return out;
}

function toOpencode(c: EvalCase): FixtureSession {
  const cwd = `/work/${c.name}`;
  const main: FixtureSession["messages"] = [{ role: "user", text: c.about }];
  const sub: FixtureSession["messages"] = [{ role: "user", text: "Sub-agent task" }];
  for (const s of c.steps) {
    if (s.user) {
      main.push({ role: "user", text: s.user });
      continue;
    }
    const tools: FixtureTool[] = [];
    if (s.run !== undefined) {
      const exit = s.exit === undefined ? 0 : s.exit;
      tools.push({
        tool: "bash",
        input: { command: fill(s.run) },
        output: fill(s.out ?? ""),
        ...(s.denied ? { status: "error" as const } : {}),
        metadata: { exit, output: fill(s.out ?? ""), truncated: false },
      });
    } else if (s.edit) {
      tools.push({
        tool: "edit",
        input: { filePath: `${cwd}/${s.edit}`, oldString: "a", newString: "b" },
        output: "Edit applied.",
        metadata: {
          filediff: { file: `${cwd}/${s.edit}`, additions: s.add ?? 1, deletions: s.del ?? 0 },
        },
      });
    } else if (s.write) {
      tools.push({
        tool: "write",
        input: {
          filePath: `${cwd}/${s.write}`,
          content: fill(s.content ?? lines(s.add ?? 1, "new")),
        },
        metadata: { exists: false },
      });
    }
    const step = { ...(s.text ? { text: fill(s.text) } : {}), tools };
    (s.sub ? sub : main).push({ role: "assistant", model: "local/eval-model", steps: [step] });
  }
  main.push({ role: "assistant", model: "local/eval-model", steps: [{ text: fill(c.final) }] });
  const session: FixtureSession = {
    id: `ses_${c.name}`,
    title: c.title,
    directory: cwd,
    messages: main,
  };
  if (sub.length > 1)
    session.children = [
      { id: `ses_${c.name}_sub`, title: "Sub-agent", directory: cwd, messages: sub },
    ];
  return session;
}
