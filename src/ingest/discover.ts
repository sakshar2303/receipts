import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionSummary, SourceKind } from "../types.js";
import { summariseClaudeCodeFile } from "./claude-code.js";
import { listOpencodeSessions } from "./opencode.js";

export interface OpencodeDb {
  path: string;
  /** The folder the database belongs to, for display ("opencode" or "~/.some-app"). */
  label: string;
}

export interface DiscoverOptions {
  source?: SourceKind;
  limit: number;
  /** Use this OpenCode-format database instead of discovering one. */
  db?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export function claudeCodeProjectsDir(home = os.homedir(), env = process.env): string {
  return path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"), "projects");
}

/** Top-level transcripts only: sub-agent transcripts are read with their parent. */
export function findClaudeCodeFiles(projectsDir: string): { file: string; mtimeMs: number }[] {
  if (!existsSync(projectsDir)) return [];
  const files: { file: string; mtimeMs: number }[] = [];
  for (const project of safeReaddir(projectsDir)) {
    if (!project.isDirectory()) continue;
    const dir = path.join(projectsDir, project.name);
    for (const entry of safeReaddir(dir)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(dir, entry.name);
      files.push({ file, mtimeMs: statSync(file).mtimeMs });
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// Folders that are large, never hold an agent database, and would blow the time budget.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "cache",
  "caches",
  "Cache",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".bun",
  ".cargo",
  ".rustup",
  ".gradle",
  ".m2",
  ".nvm",
  ".ollama",
  ".Trash",
  ".docker",
  ".vscode",
  ".cursor",
  ".claude",
  ".pyenv",
  ".rbenv",
  ".conda",
  ".venv",
  "venv",
  "logs",
]);
const MAX_DEPTH = 6;

/**
 * Finds OpenCode-format databases: the standard locations, plus any desktop app
 * that embeds the engine under its own dot-folder (`~/.*\/**\/share/opencode/opencode.db`).
 * No vendor names are hardcoded; the scan stops when the time budget runs out.
 */
export function findOpencodeDbs(
  home = os.homedir(),
  env = process.env,
  budgetMs = 1500,
): OpencodeDb[] {
  const found = new Map<string, OpencodeDb>();
  const add = (file: string, label: string) => {
    if (existsSync(file) && !found.has(file)) found.set(file, { path: file, label });
  };
  if (env.XDG_DATA_HOME) add(path.join(env.XDG_DATA_HOME, "opencode", "opencode.db"), "opencode");
  add(path.join(home, ".local", "share", "opencode", "opencode.db"), "opencode");

  const deadline = Date.now() + budgetMs;
  const walk = (dir: string, depth: number, label: string) => {
    if (depth > MAX_DEPTH || Date.now() > deadline) return;
    for (const entry of safeReaddir(dir)) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (entry.name === "opencode" && path.basename(dir) === "share") {
        add(path.join(child, "opencode.db"), label);
      } else {
        walk(child, depth + 1, label);
      }
    }
  };
  for (const entry of safeReaddir(home)) {
    if (!entry.isDirectory() || !entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    walk(path.join(home, entry.name), 2, `~/${entry.name}`);
  }
  return [...found.values()];
}

export async function discoverSessions(options: DiscoverOptions): Promise<SessionSummary[]> {
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const summaries: SessionSummary[] = [];

  if (options.source !== "opencode" && !options.db) {
    const files = findClaudeCodeFiles(claudeCodeProjectsDir(home, env)).slice(0, options.limit);
    for (const { file, mtimeMs } of files) {
      const summary = await summariseClaudeCodeFile(file);
      summaries.push({ ...summary, updatedAt: new Date(mtimeMs).toISOString() });
    }
  }
  if (options.source !== "claude-code") {
    const dbs = options.db
      ? [{ path: options.db, label: path.basename(options.db) }]
      : findOpencodeDbs(home, env);
    for (const db of dbs) summaries.push(...(await listOpencodeSessions(db.path, db.label)));
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, options.limit);
}

function safeReaddir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
