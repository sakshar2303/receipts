import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A throwaway git repository with a fixed fixture identity, for diff tests. */
export class TempRepo {
  readonly dir = mkdtempSync(path.join(tmpdir(), "receipts-repo-"));

  constructor(branch = "main") {
    this.git("init", "-q", "-b", branch);
  }

  git(...args: string[]): string {
    return this.gitAt("2026-01-01T09:00:00Z", ...args);
  }

  /** Runs git with author and committer dates pinned, so --since queries are deterministic. */
  gitAt(isoDate: string, ...args: string[]): string {
    return execFileSync("git", ["-C", this.dir, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture Author",
        GIT_AUTHOR_EMAIL: "fixture@example.com",
        GIT_COMMITTER_NAME: "Fixture Author",
        GIT_COMMITTER_EMAIL: "fixture@example.com",
        GIT_AUTHOR_DATE: isoDate,
        GIT_COMMITTER_DATE: isoDate,
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    });
  }

  write(file: string, content: string | Uint8Array): void {
    const full = path.join(this.dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  commit(message: string, isoDate = "2026-01-01T09:00:00Z"): void {
    this.gitAt(isoDate, "add", "-A");
    this.gitAt(isoDate, "commit", "-q", "-m", message);
  }
}
