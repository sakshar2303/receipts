import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inputNotFound } from "../errors.js";
import { readClaudeCodeSession } from "../ingest/claude-code.js";
import { discoverSessions } from "../ingest/discover.js";
import { readOpencodeSession } from "../ingest/opencode.js";
import type { Session, SessionSummary, SourceKind } from "../types.js";

export interface ResolvedTarget {
  session: Session;
  /** The demo ships its own patch, so it needs no git repository. */
  diffFile?: string;
}

export interface TargetOptions {
  db?: string;
  /** Prefer sessions that worked in this folder when picking "latest". */
  repo?: string;
  /** Only sessions in repo count; set when the user named the repository. */
  strictRepo?: boolean;
}

/** The bundled demo, found relative to this module in both the source tree and the built CLI. */
export function demoDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, "demo");
    if (existsSync(path.join(candidate, "claude-code-session.jsonl"))) return candidate;
    dir = path.dirname(dir);
  }
  throw inputNotFound("The bundled demo is missing from this installation.");
}

/**
 * Turns a target into a session: "demo", "latest", "latest:claude-code",
 * "latest:opencode", a JSONL path, or a session id (with --db, from that database).
 */
export async function resolveTarget(
  target: string,
  options: TargetOptions,
): Promise<ResolvedTarget> {
  if (target === "demo") {
    const dir = demoDir();
    return {
      session: await readClaudeCodeSession(path.join(dir, "claude-code-session.jsonl")),
      diffFile: path.join(dir, "changes.patch"),
    };
  }
  if (target.endsWith(".jsonl") || (target.includes("/") && !target.startsWith("latest"))) {
    if (!existsSync(target)) throw inputNotFound(`Transcript not found: ${target}`);
    return { session: await readClaudeCodeSession(target) };
  }

  const latest = /^latest(?::(claude-code|opencode))?$/.exec(target);
  const source = latest?.[1] as SourceKind | undefined;
  const rows = await discoverSessions({
    limit: latest ? 50 : 500,
    ...(source ? { source } : {}),
    ...(options.db ? { db: options.db } : {}),
  });
  const pick = latest
    ? pickLatest(rows, options.repo, options.strictRepo === true)
    : findById(rows, target);
  if (!pick) {
    throw inputNotFound(
      latest
        ? options.strictRepo && options.repo
          ? `No ${source ?? "agent"} session worked in ${options.repo}.`
          : `No ${source ?? "agent"} sessions found. Run "receipts sessions" to see what Receipts can find, or pass --db or a .jsonl path.`
        : `No session with id "${target}". Run "receipts sessions" to list ids.`,
    );
  }
  return { session: await readSummary(pick) };
}

function pickLatest(
  rows: SessionSummary[],
  repo: string | undefined,
  strict: boolean,
): SessionSummary | undefined {
  if (repo) {
    const root = real(repo);
    const here = rows.find(
      (r) => r.cwd && (real(r.cwd) === root || real(r.cwd).startsWith(`${root}${path.sep}`)),
    );
    if (here || strict) return here;
  }
  return rows[0];
}

function findById(rows: SessionSummary[], id: string): SessionSummary | undefined {
  return (
    rows.find((r) => r.id === id) ??
    (id.length >= 6 ? rows.find((r) => r.id.startsWith(id)) : undefined)
  );
}

async function readSummary(row: SessionSummary): Promise<Session> {
  if (row.source === "claude-code") return readClaudeCodeSession(row.location);
  const session = await readOpencodeSession(row.location, row.id);
  if (!session) throw inputNotFound(`Session ${row.id} disappeared from ${row.location}.`);
  return session;
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
