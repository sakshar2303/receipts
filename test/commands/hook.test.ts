import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hookScript, installHook } from "../../src/commands/hook.js";
import { TempRepo } from "../helpers/git-repo.js";

const hookOf = (dir: string) => path.join(dir, ".git", "hooks", "pre-push");

describe("install-hook", () => {
  it("writes an executable pre-push hook and updates its own hook without asking", async () => {
    const repo = new TempRepo();
    expect(
      await installHook({ cwd: repo.dir, failOn: "contradicted,stale", force: false }),
    ).toMatch(/^Installed a pre-push hook/);
    expect(statSync(hookOf(repo.dir)).mode & 0o111).not.toBe(0);
    expect(readFileSync(hookOf(repo.dir), "utf8")).toBe(hookScript("contradicted,stale"));
    await installHook({ cwd: repo.dir, failOn: "contradicted", force: false });
    expect(readFileSync(hookOf(repo.dir), "utf8")).toContain("--fail-on contradicted\n");
  });

  it("asks before replacing someone else's hook, and refuses without a terminal", async () => {
    const repo = new TempRepo();
    writeFileSync(hookOf(repo.dir), "#!/bin/sh\necho mine\n");
    await expect(installHook({ cwd: repo.dir, failOn: "stale", force: false })).rejects.toThrow(
      /Rerun with --force/,
    );
    const kept = await installHook({
      cwd: repo.dir,
      failOn: "stale",
      force: false,
      confirm: () => Promise.resolve(false),
    });
    expect(kept).toMatch(/unchanged/);
    expect(readFileSync(hookOf(repo.dir), "utf8")).toContain("echo mine");
    await installHook({
      cwd: repo.dir,
      failOn: "stale",
      force: false,
      confirm: () => Promise.resolve(true),
    });
    expect(readFileSync(hookOf(repo.dir), "utf8")).toContain("Installed by Receipts");
  });

  it("is valid shell", () => {
    expect(() => execFileSync("sh", ["-n", "-c", hookScript("contradicted,stale")])).not.toThrow();
  });

  it("refuses outside a git repository", async () => {
    await expect(installHook({ cwd: "/", failOn: "stale", force: false })).rejects.toThrow(
      /not a git repository/,
    );
  });
});
