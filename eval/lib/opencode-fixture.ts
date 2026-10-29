import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A compact, hand-writable description of an OpenCode-format session. */
export interface FixtureSession {
  id: string;
  title: string;
  directory: string;
  messages: FixtureMessage[];
  children?: FixtureSession[];
}

export type FixtureMessage =
  { role: "user"; text: string } | { role: "assistant"; model?: string; steps: FixtureStep[] };

export interface FixtureStep {
  text?: string;
  tools?: FixtureTool[];
}

export interface FixtureTool {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status?: "completed" | "error" | "running";
  metadata?: Record<string, unknown>;
}

const SCHEMA = `
CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text NOT NULL,
  directory text NOT NULL, title text NOT NULL, version text NOT NULL, time_created integer NOT NULL,
  time_updated integer NOT NULL);
CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL,
  time_updated integer NOT NULL, data text NOT NULL);
CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
  time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
CREATE TABLE account (id text PRIMARY KEY, access_token text NOT NULL);
INSERT INTO account VALUES ('acc', 'fixture-token-never-read');
`;

/** Builds a database file from fixture sessions and returns its path. */
export function buildOpencodeDb(sessions: FixtureSession[], dir?: string): string {
  const target = path.join(
    dir ?? mkdtempSync(path.join(tmpdir(), "receipts-fixture-")),
    "opencode.db",
  );
  const db = new DatabaseSync(target);
  db.exec(SCHEMA);
  const clock = { now: Date.UTC(2026, 0, 10, 10, 0, 0) };
  for (const session of sessions) insertSession(db, session, null, clock);
  db.close();
  return target;
}

function insertSession(
  db: DatabaseSync,
  s: FixtureSession,
  parent: string | null,
  clock: { now: number },
): void {
  const created = clock.now;
  let seq = 0;
  const id = (kind: string) => `${kind}_${s.id}_${String(seq++).padStart(4, "0")}`;
  const tick = () => (clock.now += 1000);
  const insertMessage = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
  const insertPart = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)");
  const part = (messageId: string, data: unknown) => {
    const t = tick();
    insertPart.run(id("prt"), messageId, s.id, t, t, JSON.stringify(data));
  };

  for (const m of s.messages) {
    const messageId = id("msg");
    const t = tick();
    if (m.role === "user") {
      insertMessage.run(
        messageId,
        s.id,
        t,
        t,
        JSON.stringify({ role: "user", time: { created: t } }),
      );
      part(messageId, { type: "text", text: m.text });
      continue;
    }
    const [providerID, modelID] = (m.model ?? "local/model-a").split("/");
    insertMessage.run(
      messageId,
      s.id,
      t,
      t,
      JSON.stringify({ role: "assistant", providerID, modelID, agent: "build", mode: "build" }),
    );
    for (const step of m.steps) {
      part(messageId, { type: "step-start" });
      if (step.text !== undefined) part(messageId, { type: "text", text: step.text });
      for (const [i, tool] of (step.tools ?? []).entries()) {
        part(messageId, {
          type: "tool",
          tool: tool.tool,
          callID: `call_${s.id}_${seq}_${i}`,
          state: {
            status: tool.status ?? "completed",
            input: tool.input,
            output: tool.output ?? "",
            metadata: tool.metadata ?? {},
            title: "",
            time: { start: clock.now, end: clock.now },
          },
        });
      }
      part(messageId, {
        type: "step-finish",
        reason: step.tools?.length ? "tool-calls" : "stop",
        cost: 0,
      });
    }
  }
  db.prepare("INSERT INTO session VALUES (?, 'proj', ?, ?, ?, ?, '1', ?, ?)").run(
    s.id,
    parent,
    s.id,
    s.directory,
    s.title,
    created,
    clock.now,
  );
  for (const child of s.children ?? []) insertSession(db, child, s.id, clock);
}
