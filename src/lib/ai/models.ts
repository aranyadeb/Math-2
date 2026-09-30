import { serverEnv } from "../env";

export type ModelTier = "fast" | "reasoning" | "transcribe";

/** All model ids come from configuration — never hardcode elsewhere. */
export function modelFor(tier: ModelTier): string {
  const env = serverEnv();
  return tier === "fast" ? env.GEMINI_FAST_MODEL : tier === "reasoning" ? env.GEMINI_REASONING_MODEL : env.GEMINI_TRANSCRIBE_MODEL;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const env = serverEnv();
  const reasoning = model === env.GEMINI_REASONING_MODEL;
  const pin = reasoning ? env.GEMINI_REASONING_PRICE_IN : env.GEMINI_FAST_PRICE_IN;
  const pout = reasoning ? env.GEMINI_REASONING_PRICE_OUT : env.GEMINI_FAST_PRICE_OUT;
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}
