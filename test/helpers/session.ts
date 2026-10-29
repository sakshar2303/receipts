import type { Session, Step, ToolCall } from "../../src/types.js";

/** A minimal hand-built session for unit tests that don't need a transcript file. */
export function makeSession(
  cwd: string,
  steps: Partial<Step>[] = [],
  startedAt = "2026-01-10T10:00:00.000Z",
): Session {
  const full: Step[] = steps.map((s, index) => ({
    index,
    at: s.at ?? startedAt,
    model: "model-a",
    isSidechain: false,
    text: "",
    userText: "",
    tools: [],
    ...s,
  }));
  return {
    id: "test-session",
    source: "claude-code",
    title: "Test session",
    cwd,
    startedAt,
    steps: full,
    finalMessage: null,
  };
}

export function runCall(command: string, exitCode: number | null, output = ""): ToolCall {
  return {
    id: `run-${command}`,
    name: "Bash",
    canonical: "run",
    input: { command },
    output,
    exitCode,
    status: exitCode === 0 ? "ok" : exitCode === null ? "interrupted" : "error",
    edits: [],
  };
}

export function editCall(file: string, added = 1, removed = 0, cwd = "/work/app"): ToolCall {
  return {
    id: `edit-${file}-${added}-${removed}`,
    name: "Edit",
    canonical: "edit",
    input: { file_path: `${cwd}/${file}` },
    output: "",
    exitCode: null,
    status: "ok",
    edits: [{ path: file, absPath: `${cwd}/${file}`, kind: "edit", added, removed }],
  };
}
