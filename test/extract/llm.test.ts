import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractClaims } from "../../src/extract/index.js";
import { mergeClaims } from "../../src/extract/merge.js";
import { extractPatternClaims } from "../../src/extract/patterns.js";
import { ReceiptsError } from "../../src/errors.js";
import type { Fetch } from "../../src/providers/client.js";
import { loadProviderEnv } from "../../src/providers/env.js";
import { pickOllamaModel } from "../../src/providers/select.js";

const MESSAGE =
  "Fixed the redirect bug and updated src/auth.ts. All tests pass. The page now loads instantly.";

type Reply = { status?: number; body: unknown; headers?: Record<string, string> } | Error;

/** A fake fetch that answers Ollama's tag list and then the queued chat replies in order. */
function fakeFetch(replies: Reply[], tags: unknown = { models: [{ name: "model-a", size: 1 }] }) {
  const requests: { url: string; body: unknown }[] = [];
  const impl: Fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/api/tags")) return Promise.resolve(Response.json(tags));
    requests.push({
      url,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "null") as unknown,
    });
    const reply = replies.shift();
    if (!reply || reply instanceof Error) return Promise.reject(reply ?? new Error("no reply"));
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return Promise.resolve(
      new Response(text, { status: reply.status ?? 200, headers: reply.headers ?? {} }),
    );
  };
  return { impl, requests };
}

const chatReply = (content: string): Reply => ({ body: { choices: [{ message: { content } }] } });
const claimsJson = (claims: unknown[]) => JSON.stringify({ claims });

function options(fetchImpl: Fetch, extra: Partial<Parameters<typeof extractClaims>[1]> = {}) {
  const waits: number[] = [];
  return {
    waits,
    opts: {
      env: {},
      cacheDir: mkdtempSync(path.join(tmpdir(), "receipts-cache-")),
      fetchImpl,
      sleep: (ms: number) => {
        if (ms > 0) waits.push(ms);
        return Promise.resolve();
      },
      ...extra,
    },
  };
}

describe("LLM extraction", () => {
  it("sends only the final message and grounds every claim in it", async () => {
    const { impl, requests } = fakeFetch([
      chatReply(
        claimsJson([
          { text: "The page now loads instantly", type: "behaviour", subject: "page load" },
          { text: "Deployed to production", type: "command-ran", subject: "deploy" },
          { text: "All tests pass", type: "tests-pass", subject: "tests" },
          { text: "updated src/auth.ts", type: "made-up-type", subject: "src/auth.ts" },
        ]),
      ),
    ]);
    const { opts } = options(impl);
    const result = await extractClaims(MESSAGE, opts);

    const sent = requests[0]?.body as { messages: { role: string; content: string }[] };
    expect(sent.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(sent.messages[1]?.content).toBe(MESSAGE);
    expect(result.model).toBe("ollama:model-a");
    expect(result.claims.map((c) => [c.type, c.extractedBy])).toEqual([
      ["bug-fixed", "pattern"],
      ["file-changed", "pattern"],
      ["behaviour", "llm"],
      ["tests-pass", "both"],
      ["behaviour", "both"],
    ]);
    expect(result.claims.some((c) => c.text.includes("Deployed"))).toBe(false);
    expect(result.claims.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drops model claims whose text has no cue for their type", async () => {
    const message = "Skills: Redis, Agile/Scrum. Updated src/a.ts.";
    const { impl } = fakeFetch([
      chatReply(
        claimsJson([
          { text: "Redis", type: "dependency-added", subject: "redis" },
          { text: "Agile/Scrum", type: "scope", subject: "agile" },
          { text: "Updated src/a.ts", type: "file-changed", subject: "src/a.ts" },
        ]),
      ),
    ]);
    const { opts } = options(impl);
    const result = await extractClaims(message, opts);
    expect(result.claims.map((c) => [c.type, c.extractedBy])).toEqual([["file-changed", "both"]]);
  });

  it("retries once on invalid JSON, then falls back to patterns with a notice", async () => {
    const { impl } = fakeFetch([chatReply("not json"), chatReply("still not json")]);
    const { opts } = options(impl);
    const result = await extractClaims(MESSAGE, opts);
    expect(result.model).toBeNull();
    expect(result.notice).toMatch(/did not return valid JSON.*patterns only/);
    expect(result.claims.every((c) => c.extractedBy === "pattern")).toBe(true);
  });

  it("accepts JSON wrapped in a code fence after a retry", async () => {
    const { impl } = fakeFetch([
      chatReply("oops"),
      chatReply("```json\n" + claimsJson([]) + "\n```"),
    ]);
    const { opts } = options(impl);
    expect((await extractClaims(MESSAGE, opts)).model).toBe("ollama:model-a");
  });

  it("waits for Retry-After on a rate limit and then succeeds", async () => {
    const { impl } = fakeFetch([
      { status: 429, body: "slow down", headers: { "retry-after": "2" } },
      chatReply(claimsJson([])),
    ]);
    const { opts, waits } = options(impl);
    const result = await extractClaims(MESSAGE, opts);
    expect(result.model).toBe("ollama:model-a");
    expect(waits).toContain(2000);
  });

  it("does not wait out a spent daily quota", async () => {
    const { impl } = fakeFetch([{ status: 429, body: "Rate limit reached: tokens per day (TPD)" }]);
    const { opts, waits } = options(impl);
    const result = await extractClaims(MESSAGE, opts);
    expect(result.notice).toMatch(/out of free quota/);
    expect(waits).toEqual([]);
  });

  it("never pays: a 402 ends the LLM attempt", async () => {
    const { impl } = fakeFetch([{ status: 402, body: "payment required" }]);
    const { opts } = options(impl);
    expect((await extractClaims(MESSAGE, opts)).notice).toMatch(/never pays/);
  });

  it("continues with patterns when the model is unreachable", async () => {
    const { impl } = fakeFetch([new Error("ECONNREFUSED")]);
    const { opts } = options(impl);
    const result = await extractClaims(MESSAGE, opts);
    expect(result.notice).toMatch(/not reachable/);
    expect(result.claims).toHaveLength(extractPatternClaims(MESSAGE).length);
  });

  it("caches answers on disk by model and prompt", async () => {
    const { impl, requests } = fakeFetch([chatReply(claimsJson([]))]);
    const { opts } = options(impl);
    await extractClaims(MESSAGE, opts);
    await extractClaims(MESSAGE, opts);
    expect(requests).toHaveLength(1);
  });

  it("reports when no free model is available", async () => {
    const { impl } = fakeFetch([], { models: [] });
    const { opts } = options(impl);
    const result = await extractClaims(MESSAGE, opts);
    expect(result.notice).toMatch(/No free model is reachable/);
  });

  it("makes no network calls with --no-llm", async () => {
    const { impl, requests } = fakeFetch([]);
    const { opts } = options(impl, { noLlm: true });
    const result = await extractClaims(MESSAGE, opts);
    expect(result).toMatchObject({ model: null });
    expect(result.notice).toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  it("refuses a paid OpenRouter model as a usage error", async () => {
    const { impl } = fakeFetch([]);
    const { opts } = options(impl, { model: "openrouter:some/paid-model" });
    await expect(extractClaims(MESSAGE, opts)).rejects.toBeInstanceOf(ReceiptsError);
  });

  it("needs a key for hosted providers", async () => {
    const { impl } = fakeFetch([]);
    const { opts } = options(impl, { model: "groq:openai/gpt-oss-120b" });
    expect((await extractClaims(MESSAGE, opts)).notice).toMatch(/No API key for groq/);
  });
});

describe("providers", () => {
  it("prefers a coder model, then the smallest, and skips embedding models", async () => {
    const tags = {
      models: [
        { name: "big-chat", size: 9 },
        { name: "nomic-embed-text", size: 1 },
        { name: "small-chat", size: 3 },
      ],
    };
    expect(await pickOllamaModel({}, fakeFetch([], tags).impl)).toBe("small-chat");
    tags.models.push({ name: "qwen2.5-coder:7b", size: 5 });
    expect(await pickOllamaModel({}, fakeFetch([], tags).impl)).toBe("qwen2.5-coder:7b");
  });

  it("reads only provider keys from .env", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "receipts-env-"));
    writeFileSync(path.join(dir, ".env"), "GROQ_API_KEY=fixture-key\nDATABASE_URL=secret\n");
    const env = loadProviderEnv(dir, {});
    expect(env).toEqual({ GROQ_API_KEY: "fixture-key" });
    expect(process.env.DATABASE_URL).toBeUndefined();
  });
});

describe("merge", () => {
  it("dedupes by type and subject, keeping the pattern span", () => {
    const pattern = extractPatternClaims("Updated src/auth.ts.");
    const merged = mergeClaims(pattern, [
      {
        text: "src/auth.ts",
        type: "file-changed",
        subject: "./SRC/auth.ts",
        span: { start: 8, end: 19 },
      },
    ]);
    expect(merged).toEqual([{ ...pattern[0], id: 1, extractedBy: "both" }]);
  });
});
