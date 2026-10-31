import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIM_TYPES, FLAG_IDS, VERDICTS } from "../src/types.js";

const root = path.join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("docs", () => {
  it("document every verdict, claim type and flag", () => {
    const verdicts = read("docs/verdicts.md");
    for (const v of VERDICTS) expect(verdicts).toContain(`| ${v}`);
    for (const t of CLAIM_TYPES) expect(verdicts).toContain(t);
    const flags = read("docs/flags.md");
    for (const f of FLAG_IDS) expect(flags).toContain(`\`${f}\``);
  });

  it("link only to files that exist", () => {
    for (const file of ["README.md", "CONTRIBUTING.md", "docs/verdicts.md", "docs/flags.md"]) {
      const text = read(file);
      const targets = [
        ...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g),
        ...text.matchAll(/<img src="([^"]+)"/g),
      ]
        .map((m) => m[1] ?? "")
        .filter((t) => !/^[a-z]+:/.test(t));
      for (const t of targets) {
        expect(existsSync(path.join(root, path.dirname(file), t)), `${file} -> ${t}`).toBe(true);
      }
    }
  });
});
