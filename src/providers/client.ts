import { apiKey, baseUrl, formatModelRef, type ModelRef, type ProviderEnv } from "./models.js";

export type Fetch = typeof fetch;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Why a free model could not answer. Receipts then continues with patterns only. */
export class LlmUnavailable extends Error {
  constructor(
    readonly reason: "unreachable" | "rate-limited" | "quota" | "rejected" | "no-key",
    message: string,
  ) {
    super(message);
    this.name = "LlmUnavailable";
  }
}

export interface ChatOptions {
  ref: ModelRef;
  messages: ChatMessage[];
  env: ProviderEnv;
  fetchImpl?: Fetch;
  timeoutMs?: number;
  /** Injected in tests so backoff does not slow the suite. */
  sleep?: (ms: number) => Promise<void>;
}

// Requests per minute, kept under each free tier's published limit.
const RATE: Record<ModelRef["provider"], number> = { ollama: 600, groq: 25, openrouter: 15 };
const buckets = new Map<string, { tokens: number; updated: number }>();
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 20_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One chat completion over the OpenAI-compatible API all three providers expose. */
export async function chat(options: ChatOptions): Promise<string> {
  const { ref, env } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const key = apiKey(ref.provider, env);
  if (ref.provider !== "ollama" && !key) {
    throw new LlmUnavailable("no-key", `No API key for ${ref.provider}.`);
  }

  for (let attempt = 0; ; attempt++) {
    await sleep(takeToken(ref.provider));
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl(ref.provider, env)}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model: ref.model,
          messages: options.messages,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
    } catch {
      throw new LlmUnavailable("unreachable", `${formatModelRef(ref)} is not reachable.`);
    }

    if (response.status === 429) {
      const body = await response.text();
      // A spent daily quota will not recover by waiting; a per-minute limit will.
      if (/quota|daily|per day|insufficient|credits/i.test(body) || attempt >= MAX_RETRIES) {
        throw new LlmUnavailable(
          "quota",
          `${formatModelRef(ref)} is rate-limited or out of free quota.`,
        );
      }
      await sleep(retryAfterMs(response.headers.get("retry-after"), attempt));
      continue;
    }
    if (response.status === 402) {
      throw new LlmUnavailable(
        "quota",
        `${formatModelRef(ref)} asked for payment; Receipts never pays.`,
      );
    }
    if (!response.ok) {
      throw new LlmUnavailable(
        "rejected",
        `${formatModelRef(ref)} returned HTTP ${response.status}.`,
      );
    }
    const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LlmUnavailable("rejected", `${formatModelRef(ref)} returned no message.`);
    }
    return content;
  }
}

function retryAfterMs(header: string | null, attempt: number): number {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_WAIT_MS);
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), MAX_WAIT_MS);
  return Math.min(1000 * 2 ** attempt, MAX_WAIT_MS);
}

/** Token bucket per provider. Returns how long to wait before sending. */
function takeToken(provider: ModelRef["provider"]): number {
  const perMinute = RATE[provider];
  const now = Date.now();
  const bucket = buckets.get(provider) ?? { tokens: perMinute, updated: now };
  bucket.tokens = Math.min(
    perMinute,
    bucket.tokens + ((now - bucket.updated) / 60_000) * perMinute,
  );
  bucket.updated = now;
  bucket.tokens -= 1;
  buckets.set(provider, bucket);
  return bucket.tokens >= 0 ? 0 : Math.ceil((-bucket.tokens / perMinute) * 60_000);
}
