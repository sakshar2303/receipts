import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderSessions } from "../../src/commands/sessions.js";
import { discoverSessions, findOpencodeDbs } from "../../src/ingest/discover.js";
import { colorsFor } from "../../src/report/colors.js";
import { buildOpencodeDb, type FixtureSession } from "../helpers/opencode-fixture.js";

const root = path.join(import.meta.dirname, "../../fixtures");
const ocFixture = JSON.parse(
  readFileSync(path.join(root, "opencode/basic.json"), "utf8"),
) as FixtureSession;

function fakeHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "receipts-home-"));
  const project = path.join(home, ".claude/projects/-work-app");
  mkdirSync(project, { recursive: true });
  copyFileSync(path.join(root, "claude-code/basic.jsonl"), path.join(project, "cc-basic.jsonl"));
  const embedded = path.join(home, ".some-app/engine/share/opencode");
  mkdirSync(embedded, { recursive: true });
  buildOpencodeDb([ocFixture], embedded);
  const cached = path.join(home, ".cache/x/share/opencode");
  mkdirSync(cached, { recursive: true });
  buildOpencodeDb([ocFixture], cached);
  return home;
}

describe("discovery", () => {
  const home = fakeHome();

  it("finds embedded OpenCode databases under dot-folders and skips caches", () => {
    const dbs = findOpencodeDbs(home, {});
    expect(dbs.map((d) => d.label)).toEqual(["~/.some-app"]);
  });

  it("lists sessions from both sources, newest first", async () => {
    const rows = await discoverSessions({ limit: 10, home, env: {} });
    expect(rows.map((r) => [r.source, r.id, r.sourceLabel]).sort()).toEqual([
      ["claude-code", "cc-basic", "claude-code"],
      ["opencode", "ses_basic", "~/.some-app"],
    ]);
  });

  it("filters by source and respects the limit", async () => {
    const rows = await discoverSessions({ limit: 1, source: "claude-code", home, env: {} });
    expect(rows.map((r) => r.title)).toEqual(["Parser empty input fix"]);
  });

  it("renders an aligned table and a sentence when empty", () => {
    const c = colorsFor({ isTTY: false });
    const table = renderSessions(
      [
        {
          id: "ses_basic",
          source: "opencode",
          sourceLabel: "~/.some-app",
          title: "Add empty-input guard to tokenizer",
          cwd: "/work/app",
          updatedAt: "2026-01-10T10:00:00.000Z",
          location: "x",
        },
      ],
      c,
    );
    const [header, row] = table.split("\n");
    expect(header?.indexOf("TITLE")).toBe(row?.indexOf("Add empty-input"));
    expect(renderSessions([], c)).toMatch(/^No sessions found\./);
  });
});
