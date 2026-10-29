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
