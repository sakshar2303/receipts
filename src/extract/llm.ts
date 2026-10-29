import { z } from "zod";
import { cacheKey, readCache, writeCache } from "../providers/cache.js";
import { chat, LlmUnavailable, type ChatMessage, type Fetch } from "../providers/client.js";
import { formatModelRef, type ModelRef, type ProviderEnv } from "../providers/models.js";
import { CLAIM_TYPES, type ClaimType, type Span } from "../types.js";
import { hasTypeCue } from "./cues.js";
import type { DraftClaim } from "./patterns.js";

const SYSTEM_PROMPT = `You extract checkable claims from the final message a coding agent wrote to its user.
Return JSON: {"claims": [{"text": string, "type": string, "subject": string}]}.
- "text" must be copied exactly from the message, as short as possible while still being the whole claim.
- "type" is one of: ${CLAIM_TYPES.join(", ")}.
  tests-pass: tests pass. tests-added: new or changed tests. build-passes, typecheck-passes, lint-passes: that check succeeds.
  file-changed, file-created, file-deleted: a named file. dependency-added, dependency-removed: a package.
  command-ran: a named command was run. no-errors: no errors at all. bug-fixed: a bug is fixed.
  feature-done: a feature is implemented. behaviour: how the software now behaves. scope: what was or was not touched.
- "subject" is what the claim is about: a file path, package name, command, or a few words.
- Only claims the agent states as done. Skip plans, questions, suggestions, conditionals and negations.
- If there are no claims, return {"claims": []}.`;

const ResponseSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().min(1),
      type: z.string(),
      subject: z.string().optional(),
    }),
  ),
});

export interface LlmExtractOptions {
  ref: ModelRef;
  env: ProviderEnv;
  cacheDir: string;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Asks a free model for claims in the final message, and only the final
 * message. The model may propose a type; the verdict always comes from a
 * deterministic checker later. Claims whose text is not in the message are
 * dropped, so a model cannot invent a claim the agent never made.
 */
export async function extractLlmClaims(
  message: string,
  options: LlmExtractOptions,
): Promise<DraftClaim[]> {
  const model = formatModelRef(options.ref);
  const key = cacheKey(model, SYSTEM_PROMPT + "\n\n" + message);
  const cached = readCache(options.cacheDir, key);
  if (cached !== null) {
    const parsed = parseResponse(cached);
    if (parsed) return ground(parsed, message);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat({
      ref: options.ref,
      messages,
      env: options.env,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
    const parsed = parseResponse(content);
    if (parsed) {
      writeCache(options.cacheDir, key, content);
      return ground(parsed, message);
    }
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content:
          'That was not valid JSON in the requested shape. Reply with only {"claims": [...]}.',
      },
    );
  }
  throw new LlmUnavailable("rejected", `${model} did not return valid JSON after a retry.`);
}

function parseResponse(content: string): z.infer<typeof ResponseSchema> | null {
  // Some models wrap JSON in a code fence despite json mode.
  const body = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    const result = ResponseSchema.safeParse(JSON.parse(body));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function ground(response: z.infer<typeof ResponseSchema>, message: string): DraftClaim[] {
  const claims: DraftClaim[] = [];
  const used: Span[] = [];
  for (const item of response.claims) {
    const span = locate(message, item.text, used);
    if (!span) continue;
    const type: ClaimType = (CLAIM_TYPES as readonly string[]).includes(item.type)
      ? (item.type as ClaimType)
      : "behaviour";
    if (!hasTypeCue(type, message.slice(span.start, span.end))) continue;
    used.push(span);
    claims.push({
      text: message.slice(span.start, span.end),
      type,
      subject: (item.subject ?? "").trim(),
      span,
    });
  }
  return claims;
}

/** Finds the quote in the message: exactly, then ignoring case and runs of whitespace. */
function locate(message: string, quote: string, used: Span[]): Span | null {
  const trimmed = quote.trim().replace(/[.]+$/, "");
  if (!trimmed) return null;
  let from = 0;
  for (;;) {
    const at = message.indexOf(trimmed, from);
    if (at < 0) break;
    const span = { start: at, end: at + trimmed.length };
    if (!used.some((u) => u.start === span.start && u.end === span.end)) return span;
    from = at + 1;
  }
  const pattern = trimmed
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const m = new RegExp(pattern, "i").exec(message);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}
