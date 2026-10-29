import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildReceiptFor, type CheckOptions, type Io } from "../../src/commands/check.js";
import { readClaudeCodeSession } from "../../src/ingest/claude-code.js";
import { discoverSessions } from "../../src/ingest/discover.js";
import { readOpencodeSession } from "../../src/ingest/opencode.js";
import { selectTurns } from "../../src/ingest/turns.js";
import type { Receipt } from "../../src/report/schema.js";
import type { Verdict } from "../../src/types.js";

/**
 * The unit of the real-data eval is one turn: a human request and the work up
 * to the agent's reply. Long sessions hold many requests, each ending in a
 * message that reports what was done, so each is checked on its own.
 */
export interface Unit {
  key: string;
  source: "claude-code" | "opencode";
  title: string;
  /** A .jsonl path, or the session id inside `db`. */
  target: string;
  db?: string;
  turn: number;
  turns: number;
}

export interface LabelledUnit {
  key: string;
  claims: { start: number; end: number; text: string; truth: Verdict | "not-a-claim" }[];
  /** Real claims in the message that Receipts did not extract. */
  missed: number;
}

export interface LabelFile {
  version: 1;
  units: LabelledUnit[];
}

export const PRIVATE_DIR = path.join(process.cwd(), "eval", "private");
export const LABELS_FILE = path.join(PRIVATE_DIR, "labels.json");

export function readLabels(): LabelFile {
  if (!existsSync(LABELS_FILE)) return { version: 1, units: [] };
  return JSON.parse(readFileSync(LABELS_FILE, "utf8")) as LabelFile;
}

export function writeLabels(labels: LabelFile): void {
  mkdirSync(PRIVATE_DIR, { recursive: true });
  writeFileSync(LABELS_FILE, `${JSON.stringify(labels, null, 2)}\n`);
}

/** Every turn on this machine that ran at least one tool and ended with a message. */
export async function realUnits(): Promise<Unit[]> {
  const units: Unit[] = [];
  for (const row of await discoverSessions({ limit: 200 })) {
    const session =
      row.source === "claude-code"
        ? await readClaudeCodeSession(row.location)
        : await readOpencodeSession(row.location, row.id);
    if (!session) continue;
    // Turn numbers follow selectTurns, which also counts a leading turn
    // that starts without a human message.
    let turns = 0;
    const parts = [];
    for (let turn = 1; ; turn++) {
      try {
        parts.push(selectTurns(session, String(turn)));
        turns = turn;
      } catch {
        break;
      }
    }
    for (const [i, part] of parts.entries()) {
      const turn = i + 1;
      if (!part.finalMessage || !part.steps.some((s) => s.tools.length > 0)) continue;
      units.push({
        key: `${row.source}:${row.id}:${turn}`,
        source: row.source,
        title: session.title,
        target: row.source === "claude-code" ? row.location : row.id,
        ...(row.source === "opencode" ? { db: row.location } : {}),
        turn,
        turns,
      });
    }
  }
  return units;
}

/** The receipt for one unit. A model, when given, must be a local Ollama model. */
export async function receiptForUnit(unit: Unit, io: Io, model: string | null): Promise<Receipt> {
  if (model && !model.startsWith("ollama:"))
    throw new Error("Real sessions are only sent to a local model.");
  const options: CheckOptions = {
    format: "json",
    out: io.cwd,
    llm: model !== null,
    failOn: [],
    quiet: true,
    turns: String(unit.turn),
    ...(unit.db ? { db: unit.db } : {}),
    ...(model ? { model } : {}),
  };
  return buildReceiptFor(unit.target, options, io);
}
