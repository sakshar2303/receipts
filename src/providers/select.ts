import type { Fetch } from "./client.js";
import { baseUrl, type ModelRef, type ProviderEnv } from "./models.js";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

interface OllamaTag {
  name: string;
  size?: number;
}

/**
 * The first free model that is actually available: a local Ollama model, then
 * Groq's free tier, then an OpenRouter ":free" model. Null means patterns only.
 */
export async function chooseDefaultModel(
  env: ProviderEnv,
  fetchImpl: Fetch = fetch,
): Promise<ModelRef | null> {
  const local = await pickOllamaModel(env, fetchImpl);
  if (local) return { provider: "ollama", model: local };
  if (env.GROQ_API_KEY) return { provider: "groq", model: DEFAULT_GROQ_MODEL };
  if (env.OPENROUTER_API_KEY) return { provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL };
  return null;
}

/**
 * Prefers a coder model, then the smallest chat model: extraction from one
 * short message does not need a large model, and small ones answer fast.
 */
export async function pickOllamaModel(
  env: ProviderEnv,
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  let tags: OllamaTag[];
  try {
    const response = await fetchImpl(`${baseUrl("ollama", env)}/api/tags`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return null;
    tags = ((await response.json()) as { models?: OllamaTag[] }).models ?? [];
  } catch {
    return null;
  }
  const chat = tags.filter((t) => !/embed|nomic|bge|minilm/i.test(t.name));
  const bySize = [...chat].sort((a, b) => (a.size ?? Infinity) - (b.size ?? Infinity));
  return (bySize.find((t) => /coder/i.test(t.name)) ?? bySize[0])?.name ?? null;
}
