import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReceiptFor } from "../../src/commands/check.js";
import { clientApp } from "../../src/report/html/client.js";
import { esc, scriptJson } from "../../src/report/html/escape.js";
import { renderHtml } from "../../src/report/html/template.js";
import { renderMarkdown } from "../../src/report/markdown.js";
import type { Receipt } from "../../src/report/schema.js";
import { captureIo, checkOptions } from "../helpers/io.js";

const tmp = () => mkdtempSync(path.join(tmpdir(), "receipts-html-"));
const EXTERNAL = /https?:\/\/|<link\b|<img\s+src="http/i;

function dataOf(html: string): { receipt: Receipt; markdown: string } {
  const m = /<script type="application\/json" id="receipt-data">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m?.[1] ?? "null") as { receipt: Receipt; markdown: string };
}

/** A session whose text is hostile: markup, a script close tag, and URLs. */
function hostileSession(dir: string): string {
  const evil = `<script>alert(1)</script> </script><img src=x onerror=alert(2)> see https://example.com/x`;
  const lines = [
    { type: "custom-title", customTitle: `Title ${evil}`, sessionId: "h" },
    {
      type: "user",
      sessionId: "h",
      cwd: dir,
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: evil },
    },
    {
      type: "assistant",
      sessionId: "h",
      cwd: dir,
      timestamp: "2026-01-01T00:00:01Z",
      message: {
        id: "m1",
        model: "x",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: `curl https://example.com && npm test` },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "h",
      cwd: dir,
      timestamp: "2026-01-01T00:00:02Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: `Exit code 1\n${evil}`,
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId: "h",
      cwd: dir,
      timestamp: "2026-01-01T00:00:03Z",
      message: {
        id: "m2",
        model: "x",
        content: [{ type: "text", text: `All tests pass. ${evil}` }],
      },
    },
  ];
  const file = path.join(dir, "hostile.jsonl");
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
  return file;
}

describe("HTML report", async () => {
  const receipt = await buildReceiptFor("demo", checkOptions(), captureIo(tmp()));
  const html = renderHtml(receipt, renderMarkdown(receipt));

  it("makes no external requests", () => {
    expect(html).not.toMatch(EXTERNAL);
  });

  it("has a semantic, accessible structure", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<nav class="strip"/g)).toHaveLength(1);
    expect(html.match(/class="counter"[^>]*aria-pressed="false"/g)).toHaveLength(5);
    expect(html.match(/<table class="ledger">/g)).toHaveLength(2);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<script\b/g)).toHaveLength(2);
    expect(html.match(/class="claim-head" aria-expanded="false"/g)).toHaveLength(
      receipt.claims.length,
    );
    expect(html).toContain("Generated locally. Nothing left your machine.");
  });

  it("embeds the receipt and the exact Markdown that --format md prints", () => {
    const data = dataOf(html);
    expect(data.receipt).toEqual(receipt);
    expect(data.markdown).toBe(renderMarkdown(receipt));
  });

  it("underlines every claim in the final message", () => {
    expect(html.match(/<mark class="span"/g)).toHaveLength(receipt.claims.length);
  });

  it("ships a self-contained client script", () => {
    const source = clientApp.toString();
    expect(source).not.toMatch(/\brequire\(|\bimport\(|__name|innerHTML/);
  });
});

describe("escaping", () => {
  it("escapes transcript text everywhere and keeps URLs inert", async () => {
    const dir = tmp();
    const receipt = await buildReceiptFor(hostileSession(dir), checkOptions(), captureIo(dir));
    const html = renderHtml(receipt, renderMarkdown(receipt));
    expect(html).not.toMatch(EXTERNAL);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(dataOf(html).receipt.finalMessage.text).toContain("https://example.com/x");
  });

  it("escapes HTML metacharacters and defangs URLs", () => {
    expect(esc(`<a href="x">&'</a> http://h`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt; http&#58;//h",
    );
    expect(scriptJson({ s: "</script><!-- https://h  " })).toBe(
      '{"s":"\\u003c\\/script\\u003e\\u003c!-- https:\\/\\/h \\u2028"}',
    );
  });
});

describe("large sessions", () => {
  it("renders 2,000 steps quickly, with outputs only where they are evidence", async () => {
    const dir = tmp();
    const lines: unknown[] = [
      {
        type: "user",
        sessionId: "big",
        cwd: dir,
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "go" },
      },
    ];
    for (let i = 0; i < 2000; i++) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      lines.push(
        {
          type: "assistant",
          sessionId: "big",
          cwd: dir,
          timestamp: at,
          message: {
            id: `m${i}`,
            model: "x",
            content: [
              {
                type: "tool_use",
                id: `t${i}`,
                name: "Bash",
                input: { command: i % 50 === 0 ? "npm test" : `cat file${i}.txt` },
              },
            ],
          },
        },
        {
          type: "user",
          sessionId: "big",
          cwd: dir,
          timestamp: at,
          toolUseResult: { stdout: "x".repeat(4000), stderr: "", interrupted: false },
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "x".repeat(4000) }],
          },
        },
      );
    }
    lines.push({
      type: "assistant",
      sessionId: "big",
      cwd: dir,
      timestamp: "2026-01-02T00:00:00Z",
      message: { id: "end", model: "x", content: [{ type: "text", text: "All tests pass." }] },
    });
    const file = path.join(dir, "big.jsonl");
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));

    const started = performance.now();
    const receipt = await buildReceiptFor(file, checkOptions(), captureIo(dir));
    const html = renderHtml(receipt, renderMarkdown(receipt));
    expect(performance.now() - started).toBeLessThan(5000);
    expect(receipt.steps).toHaveLength(2001);
    expect(html.length).toBeLessThan(1_500_000);
  });
});
