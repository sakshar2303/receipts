import { describe, expect, it } from "vitest";
import { extractClaims } from "../../src/extract/index.js";
import { isReported } from "../../src/extract/voice.js";

const texts = async (message: string) =>
  (await extractClaims(message, { noLlm: true, env: {} })).claims.map((c) => c.text);

const spanOf = (message: string, text: string) => {
  const start = message.indexOf(text);
  return { start, end: start + text.length };
};

describe("claims in the agent's own voice", () => {
  it("skips wording the agent is quoting", async () => {
    const msg =
      'Agents write commands, not check names: "`npm test` 263/263 passing" and "pushed to `main`". All tests pass.';
    expect(await texts(msg)).toEqual(["All tests pass"]);
  });

  it("keeps a claim that only contains a quotation", async () => {
    expect(await texts('Added "Built by Ana" as a footer credit.')).toEqual([
      'Added "Built by Ana" as a footer credit',
    ]);
  });

  it("skips a drafted text in a blockquote", async () => {
    expect(await texts("Here is the post:\n> We fixed the login loop and all tests pass.")).toEqual(
      [],
    );
  });

  it("rejects a model claim in a sentence that announces the next step", () => {
    const msg = "Let me verify the build and CLI help before writing docs.";
    expect(isReported(msg, spanOf(msg, "verify the build"))).toBe(false);
    const done = "I verified the build before writing docs.";
    expect(isReported(done, spanOf(done, "verified the build"))).toBe(true);
  });

  it("rejects a model claim in a conditional sentence", () => {
    const msg = "When it's pushed, tell me and I will review it.";
    expect(isReported(msg, spanOf(msg, "pushed"))).toBe(false);
  });
});
