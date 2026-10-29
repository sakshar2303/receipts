import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { ProviderEnv } from "./models.js";

const KEYS = ["OLLAMA_HOST", "GROQ_API_KEY", "OPENROUTER_API_KEY"] as const;

/**
 * Provider settings from the environment, then from a .env file in the given
 * folder. Only these three keys are read from .env; the rest of the file (which
 * may be a project's own secrets) is never loaded into the process.
 */
export function loadProviderEnv(dir = process.cwd(), env = process.env): ProviderEnv {
  const file = path.join(dir, ".env");
  let fromFile: Record<string, string | undefined> = {};
  if (existsSync(file)) {
    try {
      fromFile = parseEnv(readFileSync(file, "utf8"));
    } catch {
      fromFile = {};
    }
  }
  const out: ProviderEnv = {};
  for (const key of KEYS) {
    const value = env[key] ?? fromFile[key];
    if (value) out[key] = value;
  }
  return out;
}
