import { renameSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LATER_COMMITS_NOTICE,
  loadChangeSet,
  MOVED_ON_NOTICE,
  NO_GIT_NOTICE,
} from "../../src/diff/index.js";
import { agentCommitted, buildEditTimeline } from "../../src/diff/timeline.js";
import { ReceiptsError } from "../../src/errors.js";
import { readClaudeCodeSession } from "../../src/ingest/claude-code.js";
import { TempRepo } from "../helpers/git-repo.js";
import { makeSession, runCall } from "../helpers/session.js";

const CC_FIXTURE = path.join(import.meta.dirname, "../../fixtures/claude-code/basic.jsonl");

async function expectUsageError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ReceiptsError);
  expect((caught as ReceiptsError).exitCode).toBe(2);
  expect((caught as ReceiptsError).message).toMatch(pattern);
}

describe("change set from git", () => {
  it("compares HEAD to the working tree, including untracked, renamed, binary and non-UTF-8 files", async () => {
    const repo = new TempRepo();
    repo.write("src/parser.ts", "export const a = 1;\n");
    repo.write("src/old-name.ts", "export const keep = true;\nexport const more = 2;\n");
    repo.write("data.txt", "plain\n");
    repo.commit("initial");

    repo.write("src/parser.ts", "export const a = 2;\nexport const b = 3;\n");
    repo.git("mv", "src/old-name.ts", "src/new-name.ts");
    repo.write("src/created.ts", "export const fresh = 1;\n");
    repo.write("logo.bin", Uint8Array.from([0, 1, 2, 0, 255]));
    repo.write("data.txt", Buffer.from([0x70, 0xff, 0x0a]));

    const set = await loadChangeSet(makeSession(repo.dir));
    expect(set.source).toBe("git");
    expect(set.label).toBe("HEAD...working tree");
    const summary = Object.fromEntries(
      set.files.map((f) => [f.path, [f.status, f.added, f.removed, f.binary]]),
    );
    expect(summary).toEqual({
      "src/parser.ts": ["modified", 2, 1, false],
      "src/new-name.ts": ["renamed", 0, 0, false],
      "src/created.ts": ["added", 1, 0, false],
      "logo.bin": ["added", 0, 0, true],
      "data.txt": ["modified", 1, 1, false],
    });
    expect(set.files.find((f) => f.path === "src/new-name.ts")?.oldPath).toBe("src/old-name.ts");
  });

  it("diffs explicit --base and --head refs", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "one\n");
    repo.commit("one");
    repo.git("tag", "v1");
    repo.write("a.txt", "one\ntwo\n");
    repo.commit("two");
    repo.write("a.txt", "uncommitted\n");

    const set = await loadChangeSet(makeSession(repo.dir), { base: "v1", head: "HEAD" });
    expect(set.label).toBe("v1...HEAD");
    expect(set.files.map((f) => [f.path, f.added, f.removed])).toEqual([["a.txt", 1, 0]]);
  });

  it("rejects a base ref that does not exist with a hint", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "one\n");
    repo.commit("one");
    await expectUsageError(loadChangeSet(makeSession(repo.dir), { base: "nope" }), /--base main/);
    await expectUsageError(
      loadChangeSet(makeSession(repo.dir), { head: "HEAD" }),
      /--head needs --base/,
    );
  });

  it("uses the merge-base with the default branch when the agent committed on a feature branch", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "base\n");
    repo.commit("base");
    repo.git("checkout", "-q", "-b", "feature");
    repo.write("a.txt", "base\nagent work\n");
    repo.commit("agent work");

    const session = makeSession(repo.dir, [{ tools: [runCall('git commit -m "work"', 0)] }]);
    const set = await loadChangeSet(session);
    expect(set.label).toBe("main...working tree");
    expect(set.files.map((f) => [f.path, f.added])).toEqual([["a.txt", 1]]);
  });

  it("uses the commit before the session started when the agent committed on the default branch", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "old\n");
    repo.commit("before session", "2026-01-01T09:00:00Z");
    repo.write("a.txt", "old\nnew\n");
    repo.commit("during session", "2026-01-10T10:05:00Z");

    const session = makeSession(
      repo.dir,
      [{ at: "2026-01-10T10:10:00.000Z", tools: [runCall("git add -A && git commit -m x", 0)] }],
      "2026-01-10T10:00:00.000Z",
    );
    const set = await loadChangeSet(session);
    expect(set.label).toBe("session start...working tree");
    expect(set.files.map((f) => [f.path, f.added])).toEqual([["a.txt", 1]]);
  });

  it("handles a repository whose only commit is the agent's", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "first\n");
    repo.commit("first", "2026-01-10T10:05:00Z");
    const session = makeSession(repo.dir, [
      { at: "2026-01-10T10:10:00.000Z", tools: [runCall("git commit -m first", 0)] },
    ]);
    const set = await loadChangeSet(session);
    expect(set.files.map((f) => [f.path, f.status])).toEqual([["a.txt", "added"]]);
  });

  it("stops at the session end when the repository moved on after a committing session", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "old\n");
    repo.commit("before session", "2026-01-01T09:00:00Z");
    repo.write("a.txt", "old\nnew\n");
    repo.commit("during session", "2026-01-10T10:05:00Z");
    repo.write("later.txt", "someone else\n");
    repo.commit("after session", "2026-01-11T09:00:00Z");
    repo.write("uncommitted.txt", "also later\n");

    const session = makeSession(repo.dir, [
      { at: "2026-01-10T10:10:00.000Z", tools: [runCall("git commit -m x", 0)] },
    ]);
    const set = await loadChangeSet(session);
    expect(set.label).toBe("session start...session end");
    expect(set.notice).toBe(LATER_COMMITS_NOTICE);
    expect(set.files.map((f) => f.path)).toEqual(["a.txt"]);
  });

  it("warns when a session that did not commit is older than the latest commit", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "old\n");
    repo.commit("later", "2026-01-11T09:00:00Z");
    const set = await loadChangeSet(makeSession(repo.dir, [{ at: "2026-01-10T10:10:00.000Z" }]));
    expect(set.label).toBe("HEAD...working tree");
    expect(set.notice).toBe(MOVED_ON_NOTICE);
  });

  it("handles a repository with no commits yet", async () => {
    const repo = new TempRepo();
    repo.write("a.txt", "first\n");
    const set = await loadChangeSet(makeSession(repo.dir));
    expect(set.label).toBe("empty repository...working tree");
    expect(set.files.map((f) => [f.path, f.status])).toEqual([["a.txt", "added"]]);
  });

  it("reads a --diff patch instead of git", async () => {
    const set = await loadChangeSet(makeSession("/nowhere"), {
      diffFile: path.join(import.meta.dirname, "../../fixtures/patches/basic.patch"),
    });
    expect(set.source).toBe("patch");
    expect(set.files.map((f) => f.path)).toEqual(["src/parser.ts"]);
  });
});

describe("change set without git", () => {
  it("falls back to the agent's own edit records with a visible notice", async () => {
    const session = await readClaudeCodeSession(CC_FIXTURE);
    const set = await loadChangeSet(session);
    expect(set).toMatchObject({ source: "transcript", notice: NO_GIT_NOTICE });
    expect(set.files).toHaveLength(1);
    expect(set.files[0]).toMatchObject({
      path: "src/parser.ts",
      status: "modified",
      added: 1,
      removed: 0,
    });
    expect(set.files[0]?.hunks[0]?.lines.map((l) => l.kind)).toEqual(["del", "add", "add"]);
  });

  it("refuses --base outside a git repository", async () => {
    await expectUsageError(
      loadChangeSet(makeSession("/nowhere"), { base: "main" }),
      /not a git repository/,
    );
  });

  it("ignores a renamed temp folder that no longer exists", async () => {
    const repo = new TempRepo();
    const moved = `${repo.dir}-moved`;
    renameSync(repo.dir, moved);
    const set = await loadChangeSet(makeSession(repo.dir));
    expect(set.source).toBe("transcript");
  });
});

describe("edit timeline", () => {
  it("lists edits in step order and labels sub-agent edits", async () => {
    const session = await readClaudeCodeSession(CC_FIXTURE);
    expect(buildEditTimeline(session)).toEqual([
      {
        stepIndex: 1,
        toolId: "tu_2",
        path: "src/parser.ts",
        kind: "edit",
        added: 1,
        removed: 0,
        isSidechain: false,
      },
    ]);
  });

  it("detects successful commits only", () => {
    expect(agentCommitted(makeSession("/x", [{ tools: [runCall("git commit -m x", 1)] }]))).toBe(
      false,
    );
    expect(
      agentCommitted(makeSession("/x", [{ tools: [runCall("git -C repo commit -am x", 0)] }])),
    ).toBe(true);
    expect(
      agentCommitted(makeSession("/x", [{ tools: [runCall("echo git commit-tree", 0)] }])),
    ).toBe(false);
  });
});
