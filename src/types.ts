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

export const CLAIM_TYPES = [
  "tests-pass",
  "tests-added",
  "build-passes",
  "typecheck-passes",
  "lint-passes",
  "file-changed",
  "file-created",
  "file-deleted",
  "dependency-added",
  "dependency-removed",
  "command-ran",
  "no-errors",
  "bug-fixed",
  "feature-done",
  "behaviour",
  "scope",
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

/** Character offsets into the final message; end is exclusive. */
export interface Span {
  start: number;
  end: number;
}

export interface Claim {
  id: number;
  /** The claim as written in the final message (the text under span). */
  text: string;
  type: ClaimType;
  /** What the claim is about, normalised: a path, a package, a command, or a phrase. */
  subject: string;
  span: Span;
  extractedBy: "pattern" | "llm" | "both";
}

export const VERDICTS = [
  "verified",
  "contradicted",
  "stale",
  "unverified",
  "needs-review",
] as const;

export type Verdict = (typeof VERDICTS)[number];

/** A pointer to the hard evidence behind a verdict. */
export type EvidenceRef =
  | {
      kind: "run";
      stepIndex: number;
      toolId: string;
      command: string;
      exitCode: number | null;
      isSidechain: boolean;
    }
  | { kind: "edit"; stepIndex: number; toolId: string; path: string; isSidechain: boolean }
  | {
      kind: "diff";
      path: string;
      status: FileDiff["status"];
      added: number;
      removed: number;
    };

export interface CheckResult {
  verdict: Verdict;
  evidence: EvidenceRef[];
  /** One plain sentence a reviewer can read. */
  reason: string;
}

export type CheckedClaim = Claim & CheckResult;

export const FLAG_IDS = [
  "test-file-modified",
  "test-skipped",
  "assertion-weakened",
  "coverage-threshold-lowered",
  "sensitive-file",
  "secret-in-diff",
  "dangerous-command",
  "lockfile-churn",
  "unmentioned-change",
  "large-diff",
  "failing-command-ignored",
] as const;

export type FlagId = (typeof FLAG_IDS)[number];

export type Severity = "high" | "medium" | "low";

/** A changed line worth showing under a flag, with its file. */
export interface FlagLine {
  path: string;
  line: DiffLine;
}

/** A risk in the agent's work, whether or not the agent claimed anything about it. */
export interface Flag {
  id: FlagId;
  severity: Severity;
  title: string;
  /** One plain sentence with the specifics. */
  detail: string;
  files: string[];
  evidence: EvidenceRef[];
  /** The changed lines that triggered the flag, already redacted. */
  lines: FlagLine[];
  /** True for detectors that guess (assertion-weakened); the report says so. */
  heuristic: boolean;
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
