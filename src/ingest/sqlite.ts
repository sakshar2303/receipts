import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { inputNotFound } from "../errors.js";

export interface DbHandle {
  db: DatabaseSync;
  close(): void;
}

/**
 * Opens a private copy of a SQLite database. The agent may be writing to the
 * live file, so we copy the database with its -wal and -shm sidecars (the WAL
 * holds the newest rows) and never touch the original. The copy also holds
 * tables Receipts must not read, such as stored credentials, so it is deleted
 * as soon as the caller closes it.
 */
export async function openDbCopy(dbPath: string): Promise<DbHandle> {
  if (!existsSync(dbPath)) throw inputNotFound(`Database not found: ${dbPath}`);
  const { DatabaseSync } = await loadSqlite();
  const dir = mkdtempSync(path.join(tmpdir(), "receipts-db-"));
  const copy = path.join(dir, "session.db");
  try {
    copyFileSync(dbPath, copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix);
    }
    // Not read-only: SQLite must be able to fold the copied WAL into the copy.
    const db = new DatabaseSync(copy);
    return {
      db,
      close() {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

let sqlite: Promise<typeof import("node:sqlite")> | undefined;

/**
 * node:sqlite prints an ExperimentalWarning on first import in some Node versions.
 * Silence exactly that warning so CLI output stays clean.
 */
function loadSqlite(): Promise<typeof import("node:sqlite")> {
  sqlite ??= (async () => {
    const original = process.emitWarning.bind(process);
    process.emitWarning = (warning: string | Error, ...rest: unknown[]) => {
      const text = typeof warning === "string" ? warning : warning.message;
      if (/sqlite/i.test(text)) return;
      original(warning, ...(rest as []));
    };
    try {
      return await import("node:sqlite");
    } finally {
      process.emitWarning = original;
    }
  })();
  return sqlite;
}
