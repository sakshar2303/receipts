import { z } from "zod";
import { CLAIM_TYPES, FLAG_IDS, VERDICTS } from "../types.js";

/**
 * The published shape of report.json. schema/receipt.schema.json is generated
 * from this, and a test keeps the two in step. Bump SCHEMA_VERSION on any
 * change that could break a consumer.
 */
export const SCHEMA_VERSION = "1.0";

const Span = z.object({ start: z.number().int(), end: z.number().int() });

const DiffLine = z.object({
  kind: z.enum(["add", "del", "context"]),
  text: z.string(),
  oldLine: z.number().int().nullable(),
  newLine: z.number().int().nullable(),
});

const Evidence = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("run"),
    stepIndex: z.number().int(),
    toolId: z.string(),
    command: z.string(),
    segment: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    isSidechain: z.boolean(),
  }),
  z.object({
    kind: z.literal("edit"),
    stepIndex: z.number().int(),
    toolId: z.string(),
    path: z.string(),
    isSidechain: z.boolean(),
  }),
  z.object({
    kind: z.literal("diff"),
    path: z.string(),
    status: z.enum(["added", "deleted", "modified", "renamed"]),
    added: z.number().int(),
    removed: z.number().int(),
  }),
]);

const Verdict = z.enum(VERDICTS);

export const ReceiptSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  receiptsVersion: z.string(),
  generatedAt: z.string(),
  session: z.object({
    id: z.string(),
    source: z.enum(["claude-code", "opencode"]),
    title: z.string(),
    repo: z.string(),
    model: z.string(),
    startedAt: z.string(),
    stepCount: z.number().int(),
    turns: z.string().nullable(),
  }),
  changes: z.object({
    source: z.enum(["git", "patch", "transcript"]),
    label: z.string(),
    notice: z.string().nullable(),
    files: z.array(
      z.object({
        path: z.string(),
        oldPath: z.string(),
        status: z.enum(["added", "deleted", "modified", "renamed"]),
        binary: z.boolean(),
        added: z.number().int(),
        removed: z.number().int(),
        hunks: z.array(
          z.object({
            header: z.string(),
            oldStart: z.number().int(),
            oldLines: z.number().int(),
            newStart: z.number().int(),
            newLines: z.number().int(),
            lines: z.array(DiffLine),
          }),
        ),
        truncated: z.boolean(),
        mentioned: z.boolean(),
        flags: z.array(z.enum(FLAG_IDS)),
      }),
    ),
  }),
  finalMessage: z.object({ text: z.string(), stepIndex: z.number().int() }),
  claims: z.array(
    z.object({
      id: z.number().int(),
      text: z.string(),
      type: z.enum(CLAIM_TYPES),
      subject: z.string(),
      span: Span,
      extractedBy: z.enum(["pattern", "llm", "both"]),
      verdict: Verdict,
      evidence: z.array(Evidence),
      reason: z.string(),
    }),
  ),
  counts: z.record(Verdict, z.number().int()),
  summary: z.string(),
  flags: z.array(
    z.object({
      id: z.enum(FLAG_IDS),
      severity: z.enum(["high", "medium", "low"]),
      title: z.string(),
      detail: z.string(),
      files: z.array(z.string()),
      evidence: z.array(Evidence),
      lines: z.array(z.object({ path: z.string(), line: DiffLine })),
      heuristic: z.boolean(),
    }),
  ),
  llm: z.object({ model: z.string().nullable(), notice: z.string().nullable() }),
  notices: z.array(z.string()),
  steps: z.array(
    z.object({
      index: z.number().int(),
      at: z.string(),
      model: z.string(),
      isSidechain: z.boolean(),
      text: z.string(),
      tools: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          canonical: z.enum(["read", "search", "list", "edit", "write", "run", "web", "other"]),
          command: z.string().nullable(),
          exitCode: z.number().int().nullable(),
          status: z.enum(["ok", "error", "interrupted"]),
          note: z.string().nullable(),
          output: z.string(),
          paths: z.array(z.string()),
          /** Which check kinds this call ran and how each came out, for timeline markers. */
          checks: z.array(
            z.object({
              kind: z.enum(["test", "build", "typecheck", "lint"]),
              outcome: z.enum(["pass", "fail", "no-tests", "unknown"]),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type Receipt = z.infer<typeof ReceiptSchema>;
export type ReceiptStep = Receipt["steps"][number];
export type ReceiptFile = Receipt["changes"]["files"][number];

export function receiptJsonSchema(): unknown {
  return {
    $id: "https://github.com/sakshar2303/receipts/schema/receipt.schema.json",
    title: "Receipt",
    ...z.toJSONSchema(ReceiptSchema),
  };
}
