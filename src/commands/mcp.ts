import { createInterface } from "node:readline";
import { z } from "zod";
import { ReceiptsError } from "../errors.js";
import type { Receipt } from "../report/schema.js";
import { VERSION } from "../version.js";
import { buildReceiptFor, type Io } from "./check.js";

/**
 * A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0 with one tool,
 * check_session. It is small enough to speak the protocol directly, so it adds
 * no dependency. Nothing but protocol messages may go to stdout.
 */

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const Args = z
  .object({
    target: z.string().default("latest"),
    repo: z.string().optional(),
    turns: z.string().default("last"),
    message: z.string().optional(),
    db: z.string().optional(),
    llm: z.boolean().default(false),
  })
  .strict();

export const CHECK_SESSION_TOOL = {
  name: "check_session",
  description:
    "Check the claims in a coding-agent reply against the session transcript and the git diff. " +
    "Call it with your draft reply as `message` before telling the user you are done, then fix " +
    "every contradicted or stale claim and say which claims are unverified.",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          'Which session: "latest" (default), "latest:claude-code", "latest:opencode", a .jsonl path or a session id.',
      },
      repo: {
        type: "string",
        description: "The project folder to diff. Defaults to the folder the server runs in.",
      },
      turns: {
        type: "string",
        description: 'Which turns to check: "last" (default), "3..5", "4.." or "..2".',
      },
      message: {
        type: "string",
        description: "Your draft reply. Without it, the last message in the transcript is checked.",
      },
      db: { type: "string", description: "Path to an OpenCode-format database." },
      llm: {
        type: "boolean",
        description:
          "Also extract claims with a free model. Off by default, so nothing leaves the machine.",
      },
    },
    additionalProperties: false,
  },
} as const;

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Response =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const ok = (id: Request["id"], result: unknown): Response => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});
const fail = (id: Request["id"], code: number, message: string): Response => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** What the tool returns: the verdicts and flags, without the transcript itself. */
export function toolResult(receipt: Receipt) {
  return {
    session: {
      title: receipt.session.title,
      source: receipt.session.source,
      turns: receipt.session.turns,
    },
    summary: receipt.summary,
    counts: receipt.counts,
    claims: receipt.claims.map((c) => ({
      text: c.text,
      type: c.type,
      verdict: c.verdict,
      reason: c.reason,
    })),
    flags: receipt.flags.map((f) => ({ id: f.id, severity: f.severity, detail: f.detail })),
    notices: receipt.notices,
  };
}

/** Handles one message. Returns null for notifications, which get no reply. */
export async function handleMcp(raw: unknown, io: Io): Promise<Response | null> {
  if (typeof raw !== "object" || raw === null || typeof (raw as Request).method !== "string") {
    return fail(null, -32600, "Invalid request.");
  }
  const req = raw as Request;
  if (req.id === undefined) return null;

  switch (req.method) {
    case "initialize": {
      const asked = req.params?.protocolVersion;
      const version =
        typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
          ? asked
          : PROTOCOL_VERSIONS[0];
      return ok(req.id, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: "receipts", version: VERSION },
      });
    }
    case "ping":
      return ok(req.id, {});
    case "tools/list":
      return ok(req.id, { tools: [CHECK_SESSION_TOOL] });
    case "tools/call": {
      if (req.params?.name !== CHECK_SESSION_TOOL.name) {
        return fail(req.id, -32602, `Unknown tool "${String(req.params?.name)}".`);
      }
      const parsed = Args.safeParse(req.params.arguments ?? {});
      if (!parsed.success) {
        return fail(req.id, -32602, `Invalid arguments: ${z.prettifyError(parsed.error)}`);
      }
      const a = parsed.data;
      try {
        const receipt = await buildReceiptFor(
          a.target,
          {
            ...(a.repo ? { repo: a.repo } : {}),
            turns: a.turns,
            ...(a.message ? { message: a.message } : {}),
            ...(a.db ? { db: a.db } : {}),
            format: "json",
            out: io.cwd,
            llm: a.llm,
            failOn: [],
            quiet: true,
          },
          io,
        );
        const result = toolResult(receipt);
        return ok(req.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        if (!(error instanceof ReceiptsError)) throw error;
        return ok(req.id, { content: [{ type: "text", text: error.message }], isError: true });
      }
    }
    default:
      return fail(req.id, -32601, `Method "${req.method}" is not supported.`);
  }
}

/** Serves MCP on stdin and stdout until stdin closes. */
export async function serveMcp(io: Io): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: unknown;
    let response: Response | null;
    try {
      message = JSON.parse(line);
      response = await handleMcp(message, io);
    } catch (error) {
      const id = (message as Request | undefined)?.id ?? null;
      response =
        message === undefined
          ? fail(null, -32700, "Parse error.")
          : fail(id, -32603, error instanceof Error ? error.message : "Internal error.");
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
