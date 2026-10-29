import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { claudeCodeProjectsDir, findClaudeCodeFiles, findOpencodeDbs } from "../ingest/discover.js";
import { DEFAULT_CACHE_DIR } from "../providers/cache.js";
import type { Fetch } from "../providers/client.js";
import { loadProviderEnv } from "../providers/env.js";
import { baseUrl, formatModelRef } from "../providers/models.js";
import { chooseDefaultModel, pickOllamaModel } from "../providers/select.js";
import type { Colors } from "../report/colors.js";

interface Line {
  status: "ok" | "warn" | "info";
  text: string;
}

export interface DoctorOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  colors: Colors;
  fetchImpl?: Fetch;
}

/**
 * What Receipts can see and use on this machine. Read-only, and it never
 * contacts a hosted provider; it only checks whether a key is set.
 */
export async function doctor(options: DoctorOptions): Promise<string> {
  const lines: Line[] = [];
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  lines.push({
    status: nodeOk ? "ok" : "warn",
    text: `Node ${process.versions.node} (needs 22.13 or newer)`,
  });

  try {
    const version = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
    lines.push({ status: "ok", text: version });
  } catch {
    lines.push({
      status: "warn",
      text: "git not found; diffs fall back to the agent's edit records",
    });
  }

  const projects = claudeCodeProjectsDir(options.home, options.env);
  const transcripts = findClaudeCodeFiles(projects).length;
  lines.push({
    status: transcripts ? "ok" : "info",
    text: `${transcripts} Claude Code transcript${transcripts === 1 ? "" : "s"} in ${tilde(projects, options.home)}`,
  });
  const dbs = findOpencodeDbs(options.home, options.env);
  lines.push({
    status: dbs.length ? "ok" : "info",
    text: dbs.length
      ? `${dbs.length} OpenCode-format database${dbs.length === 1 ? "" : "s"}: ${dbs.map((d) => d.label).join(", ")}`
      : "No OpenCode-format database found (use --db to point at one)",
  });

  const env = loadProviderEnv(options.cwd, options.env);
  const local = await pickOllamaModel(env, options.fetchImpl);
  lines.push({
    status: local ? "ok" : "info",
    text: local
      ? `Ollama is running at ${baseUrl("ollama", env)}`
      : `Ollama is not reachable at ${baseUrl("ollama", env)}`,
  });
  lines.push({
    status: env.GROQ_API_KEY ? "ok" : "info",
    text: `GROQ_API_KEY ${env.GROQ_API_KEY ? "is set" : "is not set"}`,
  });
  lines.push({
    status: env.OPENROUTER_API_KEY ? "ok" : "info",
    text: `OPENROUTER_API_KEY ${env.OPENROUTER_API_KEY ? "is set" : "is not set"}`,
  });
  const model = await chooseDefaultModel(env, options.fetchImpl);
  lines.push({
    status: model ? "ok" : "info",
    text: model
      ? `Claim extraction will use ${formatModelRef(model)} (free) plus patterns`
      : "No free model reachable; claim extraction uses patterns only",
  });

  const cache = path.join(options.cwd, DEFAULT_CACHE_DIR);
  try {
    mkdirSync(cache, { recursive: true });
    accessSync(cache, constants.W_OK);
    lines.push({ status: "ok", text: `Cache folder ${DEFAULT_CACHE_DIR} is writable` });
  } catch {
    lines.push({
      status: "warn",
      text: `Cache folder ${cache} is not writable; LLM answers will not be cached`,
    });
  }
  if (!existsSync(path.join(options.cwd, ".git"))) {
    lines.push({ status: "info", text: "This folder is not the root of a git repository" });
  }

  const c = options.colors;
  const tag = { ok: c.green("ok  "), warn: c.yellow("warn"), info: c.dim("--  ") };
  return `${lines.map((l) => `  ${tag[l.status]}  ${l.text}`).join("\n")}\n`;
}

function tilde(p: string, home: string): string {
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}
