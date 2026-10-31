import { DEFAULT_CACHE_DIR } from "../providers/cache.js";
import { LlmUnavailable, type Fetch } from "../providers/client.js";
import { formatModelRef, parseModelRef, type ProviderEnv } from "../providers/models.js";
import { chooseDefaultModel } from "../providers/select.js";
import type { Claim } from "../types.js";
import { extractLlmClaims } from "./llm.js";
import { mergeClaims } from "./merge.js";
import { extractPatternClaims, type DraftClaim } from "./patterns.js";
import { isReported } from "./voice.js";

export interface ExtractOptions {
  noLlm?: boolean;
  /** "provider:model"; validated by the free guard. */
  model?: string;
  env: ProviderEnv;
  cacheDir?: string;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface ExtractResult {
  claims: Claim[];
  /** The model that contributed claims, or null when only patterns ran. */
  model: string | null;
  /** One line for the reader when an LLM was wanted but could not be used. */
  notice?: string;
}

export async function extractClaims(
  message: string,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const pattern = extractPatternClaims(message).filter((c) => isReported(message, c.span));
  if (options.noLlm) return { claims: mergeClaims(pattern, []), model: null };

  // An explicit --model that fails the free guard is a usage error, not a fallback.
  const ref = options.model
    ? parseModelRef(options.model)
    : await chooseDefaultModel(options.env, options.fetchImpl);
  if (!ref) {
    return {
      claims: mergeClaims(pattern, []),
      model: null,
      notice: "No free model is reachable, so claims come from patterns only.",
    };
  }

  let llm: DraftClaim[];
  try {
    llm = await extractLlmClaims(message, {
      ref,
      env: options.env,
      cacheDir: options.cacheDir ?? DEFAULT_CACHE_DIR,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
  } catch (error) {
    if (!(error instanceof LlmUnavailable)) throw error;
    return {
      claims: mergeClaims(pattern, []),
      model: null,
      notice: `${error.message} Continuing with patterns only.`,
    };
  }
  const reported = llm.filter((c) => isReported(message, c.span));
  return { claims: mergeClaims(pattern, reported), model: formatModelRef(ref) };
}
