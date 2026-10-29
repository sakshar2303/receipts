import { ReceiptsError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";

export type ProviderId = "ollama" | "groq" | "openrouter";

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export interface ProviderEnv {
  OLLAMA_HOST?: string | undefined;
  GROQ_API_KEY?: string | undefined;
  OPENROUTER_API_KEY?: string | undefined;
}

const PROVIDERS: readonly ProviderId[] = ["ollama", "groq", "openrouter"];

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`;
}

/** Parses "provider:model". The model part may itself contain colons ("qwen2.5-coder:7b"). */
export function parseModelRef(value: string): ModelRef {
  const at = value.indexOf(":");
  const provider = value.slice(0, at) as ProviderId;
  const model = value.slice(at + 1);
  if (at < 1 || !PROVIDERS.includes(provider) || !model) {
    throw new ReceiptsError(
      `"${value}" is not a model Receipts can use. Use ollama:<model>, groq:<model> or openrouter:<model>:free.`,
      ExitCode.Usage,
    );
  }
  assertFree({ provider, model });
  return { provider, model };
}

/**
 * The only gate between Receipts and a bill. Local Ollama models cost nothing;
 * OpenRouter models are free only when their id ends in ":free". Groq is used
 * only on its free tier, which an API key alone does not exceed; the docs tell
 * users not to put a key from a paid Groq plan in .env.
 */
export function assertFree(ref: ModelRef): void {
  if (ref.provider === "openrouter" && !ref.model.endsWith(":free")) {
    throw new ReceiptsError(
      `OpenRouter model "${ref.model}" is not a free model. Receipts only calls models whose id ends in ":free".`,
      ExitCode.Usage,
    );
  }
}

export function baseUrl(provider: ProviderId, env: ProviderEnv): string {
  if (provider === "ollama") {
    const host = env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
    return (/^https?:\/\//.test(host) ? host : `http://${host}`).replace(/\/+$/, "");
  }
  return provider === "groq" ? "https://api.groq.com/openai" : "https://openrouter.ai/api";
}

export function apiKey(provider: ProviderId, env: ProviderEnv): string | undefined {
  if (provider === "groq") return env.GROQ_API_KEY?.trim() || undefined;
  if (provider === "openrouter") return env.OPENROUTER_API_KEY?.trim() || undefined;
  return undefined;
}
