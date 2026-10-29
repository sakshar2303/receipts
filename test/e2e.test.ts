import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Runs the built CLI, the way users and hooks run it. `npm run check` builds before testing.
const CLI = path.join(import.meta.dirname, "../dist/receipts.js");

function run(args: string[], cwd = mkdtempSync(path.join(tmpdir(), "receipts-e2e-"))) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", OLLAMA_HOST: "http://127.0.0.1:9" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, cwd };
}

describe.runIf(existsSync(CLI))("built CLI on the demo", () => {
  it("writes the report files and exits 0 without --fail-on", () => {
    const r = run(["check", "demo", "--no-llm"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 of 9 claims are proven.");
    const json = JSON.parse(
      readFileSync(path.join(r.cwd, "receipts-report", "report.json"), "utf8"),
    ) as {
      claims: unknown[];
    };
    expect(json.claims).toHaveLength(9);
  });

  it("exits 1 when a claim matches --fail-on", () => {
    expect(
      run(["check", "demo", "--no-llm", "--fail-on", "contradicted,stale", "--quiet"]).code,
    ).toBe(1);
  });

  it("exits 2 on usage errors", () => {
    expect(run(["check", "demo", "--fail-on", "wrong"]).code).toBe(2);
    expect(run(["check", "demo", "--format", "pdf"]).code).toBe(2);
    expect(run(["explain", "nope"]).code).toBe(2);
  });

  it("exits 3 when the input is missing", () => {
    const r = run(["check", "missing.jsonl", "--no-llm"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toBe("receipts: Transcript not found: missing.jsonl\n");
  });

  it("falls back to patterns when no free model is reachable, without changing the exit code", () => {
    const r = run(["check", "demo", "--format", "terminal"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No free model is reachable, so claims come from patterns only.");
  });

  it("exits 3 when there is no report to open", () => {
    expect(run(["open", "no-such-dir"]).code).toBe(3);
  });

  it("prints Markdown and explains", () => {
    expect(run(["check", "demo", "--no-llm", "--format", "md"]).stdout).toMatch(/^### Receipts: /);
    expect(run(["explain", "stale"]).stdout).toMatch(/^stale\n/);
  });
});
