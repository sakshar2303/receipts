// The normalised session model. Every reader produces this shape, and everything
// downstream (diff, extraction, checks, flags, reports) reads only this shape.

export type SourceKind = "claude-code" | "opencode";

export type ToolKind = "read" | "search" | "list" | "edit" | "write" | "run" | "web" | "other";

export type ToolStatus = "ok" | "error" | "interrupted";

export interface FileEdit {
  /** Relative to the session cwd, forward slashes. Used for display and matching. */
  path: string;
  /** Absolute path as the agent wrote it, forward slashes. */
  absPath: string;
  kind: "edit" | "write" | "delete";
  added: number;
  removed: number;
}

export interface ToolCall {
  id: string;
  name: string;
  canonical: ToolKind;
  input: Record<string, unknown>;
  /** Clipped to keep memory bounded on huge sessions; head and tail are kept. */
  output: string;
  /** Only known for commands that actually ran to completion. */
  exitCode: number | null;
  status: ToolStatus;
  /** Why the status is what it is, when the transcript does not make it obvious. */
  note?: string;
  /** Set when this call was made inside another tool call (for example a code-mode script). */
  parentId?: string;
  edits: FileEdit[];
}

export interface Step {
  index: number;
  /** ISO 8601 timestamp of the first record of this step. */
  at: string;
  model: string;
  isSidechain: boolean;
  text: string;
  /** The human message that preceded this step, if any. */
  userText: string;
  tools: ToolCall[];
}

export interface FinalMessage {
  text: string;
  stepIndex: number;
}

export interface Session {
  id: string;
  source: SourceKind;
  title: string;
  cwd: string;
  startedAt: string;
  steps: Step[];
  finalMessage: FinalMessage | null;
}

export interface DiffLine {
  kind: "add" | "del" | "context";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Path after the change, relative to the repo root, forward slashes. */
  path: string;
  /** Path before the change, for renames; otherwise equal to path. */
  oldPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  binary: boolean;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

/** Everything the agent changed, from the best source available. */
export interface ChangeSet {
  source: "git" | "patch" | "transcript";
  /** Human-readable compared refs, for example "main...HEAD" or "HEAD...working tree". */
  label: string;
  files: FileDiff[];
  /** Shown to the reader when the source is weaker than a real diff. */
  notice?: string;
}

/** One file change taken from the transcript, in timeline order. */
export interface EditEvent {
  stepIndex: number;
  toolId: string;
  path: string;
  kind: FileEdit["kind"];
  added: number;
  removed: number;
  isSidechain: boolean;
}

/** A row in `receipts sessions`: cheap to compute, no full parse. */
export interface SessionSummary {
  id: string;
  source: SourceKind;
  /** Where the session came from, for display: a project folder or a database's home folder. */
  sourceLabel: string;
  title: string;
  cwd: string;
  updatedAt: string;
  /** JSONL file or database path the session lives in. */
  location: string;
}
