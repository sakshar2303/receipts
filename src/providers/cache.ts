import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_CACHE_DIR = path.join(".receipts", "cache");

export function cacheKey(model: string, prompt: string): string {
  return createHash("sha256").update(model).update("\0").update(prompt).digest("hex");
}

export function readCache(dir: string, key: string): string | null {
  try {
    return readFileSync(path.join(dir, `${key}.json`), "utf8");
  } catch {
    return null;
  }
}

/** Best effort: a read-only folder must not fail a check. */
export function writeCache(dir: string, key: string, value: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${key}.json`), value);
  } catch {
    // Caching is an optimisation only.
  }
}
