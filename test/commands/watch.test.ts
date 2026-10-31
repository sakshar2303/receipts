import { appendFileSync, copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoDir } from "../../src/commands/target.js";
import { watchCheck } from "../../src/commands/watch.js";
import { captureIo, checkOptions } from "../helpers/io.js";

describe("check --watch", () => {
  it("checks again when the transcript changes, and stops on abort", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "receipts-watch-"));
    const transcript = path.join(dir, "session.jsonl");
    copyFileSync(path.join(demoDir(), "claude-code-session.jsonl"), transcript);
    const io = captureIo(dir);
    const stop = new AbortController();
    let runs = 0;
    const done = watchCheck(
      transcript,
      checkOptions({ format: "md", diff: path.join(demoDir(), "changes.patch") }),
      io,
      {
        interval: 20,
        signal: stop.signal,
        onRun: () => {
          runs++;
          // Touch the transcript once, after the first check.
          if (runs === 1)
            setTimeout(() => {
              appendFileSync(transcript, "\n");
            }, 50);
          if (runs === 2) stop.abort();
        },
      },
    );
    await done;
    expect(runs).toBe(2);
    expect(io.text()).toContain("Session changed at");
    expect(io.text().match(/Watching .*session\.jsonl/g)).toHaveLength(2);
    expect(readFileSync(transcript, "utf8").endsWith("\n\n")).toBe(true);
  });
});
