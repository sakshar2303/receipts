import type { DatabaseSync } from "node:sqlite";
import type { Session, SessionSummary, Step } from "../types.js";
import { findFinalMessage, orderSteps } from "./build.js";
import { asRecord, asString, parseJson, type JsonRecord } from "./json.js";
import { toolCallsFromPart } from "./opencode-tools.js";
import { openDbCopy } from "./sqlite.js";
import { toTitle } from "./text.js";

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

interface DataRow {
  id: string;
  message_id?: string;
  time_created: number;
  data: string;
}

// Only these three tables are ever queried. The database also stores accounts
// and credentials, which Receipts has no reason to read.

export async function listOpencodeSessions(
  dbPath: string,
  sourceLabel: string,
): Promise<SessionSummary[]> {
  const handle = await openDbCopy(dbPath);
  try {
    const rows = handle.db
      .prepare(
        "SELECT id, title, directory, time_created, time_updated FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC",
      )
      .all() as unknown as SessionRow[];
    return rows.map((row) => ({
      id: row.id,
      source: "opencode",
      sourceLabel,
      title: toTitle(row.title) || "Untitled session",
      cwd: row.directory,
      updatedAt: new Date(row.time_updated).toISOString(),
      location: dbPath,
    }));
  } finally {
    handle.close();
  }
}

/** Returns null when the database has no session with this id. */
export async function readOpencodeSession(
  dbPath: string,
  sessionId: string,
): Promise<Session | null> {
  const handle = await openDbCopy(dbPath);
  try {
    const row = handle.db
      .prepare("SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?")
      .get(sessionId) as SessionRow | undefined;
    if (!row) return null;
    const steps = readSteps(handle.db, row.id, row.directory, false);
    // Sub-agent sessions point at their parent; their evidence counts too.
    const children = handle.db
      .prepare("SELECT id FROM session WHERE parent_id = ?")
      .all(row.id) as unknown as { id: string }[];
    for (const child of children)
      steps.push(...readSteps(handle.db, child.id, row.directory, true));
    const ordered = orderSteps(steps);
    return {
      id: row.id,
      source: "opencode",
      title: toTitle(row.title) || "Untitled session",
      cwd: row.directory,
      startedAt: new Date(row.time_created).toISOString(),
      steps: ordered,
      finalMessage: findFinalMessage(ordered),
    };
  } finally {
    handle.close();
  }
}

function readSteps(db: DatabaseSync, sessionId: string, cwd: string, isSidechain: boolean): Step[] {
  const messages = db
    .prepare(
      "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id",
    )
    .all(sessionId) as unknown as DataRow[];
  const parts = db
    .prepare(
      "SELECT id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id",
    )
    .all(sessionId) as unknown as DataRow[];
  const partsByMessage = new Map<string, DataRow[]>();
  for (const part of parts) {
    const list = partsByMessage.get(part.message_id ?? "") ?? [];
    list.push(part);
    partsByMessage.set(part.message_id ?? "", list);
  }

  const steps: Step[] = [];
  let pendingUserText = "";
  for (const message of messages) {
    const data = asRecord(parseJson(message.data)) ?? {};
    const messageParts = partsByMessage.get(message.id) ?? [];
    if (data.role === "user") {
      const text = textOf(messageParts);
      if (text) pendingUserText = pendingUserText ? `${pendingUserText}\n\n${text}` : text;
      continue;
    }
    if (data.role !== "assistant") continue;
    const model = [asString(data.providerID), asString(data.modelID)].filter(Boolean).join("/");
    let step: Step | undefined;
    for (const partRow of messageParts) {
      const part = asRecord(parseJson(partRow.data)) ?? {};
      // Each step-start ... step-finish segment is one step. Parts before any
      // step-start still belong to a step, so open one implicitly.
      if (part.type === "step-start" || !step) {
        step = {
          index: 0,
          at: new Date(partRow.time_created).toISOString(),
          model,
          isSidechain,
          text: "",
          userText: pendingUserText,
          tools: [],
        };
        pendingUserText = "";
        steps.push(step);
        if (part.type === "step-start") continue;
      }
      if (part.type === "text" && part.synthetic !== true) {
        const text = asString(part.text) ?? "";
        step.text = step.text ? `${step.text}\n\n${text}` : text;
      } else if (part.type === "tool") {
        step.tools.push(...toolCallsFromPart(part, cwd));
      }
    }
  }
  return steps;
}

function textOf(parts: readonly DataRow[]): string {
  return parts
    .map((row) => asRecord(parseJson(row.data)))
    .filter((p): p is JsonRecord => p?.type === "text" && p.synthetic !== true)
    .map((p) => asString(p.text) ?? "")
    .join("\n")
    .trim();
}
