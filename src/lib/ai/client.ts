import "server-only";
import { GoogleGenAI, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { serverEnv } from "../env";
import { estimateCostUsd } from "./models";

let ai: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!ai) ai = new GoogleGenAI({ apiKey: serverEnv().GEMINI_API_KEY });
  return ai;
}

export interface CallMeta {
  task: string;
  model: string;
  supabase?: SupabaseClient;
  userId?: string;
  fallbackReason?: string | null;
}

export interface CallResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export class AIError extends Error {
  constructor(message: string, public readonly raw?: string) {
    super(message);
    this.name = "AIError";
  }
}

async function logUsage(meta: CallMeta, r: { inputTokens: number; outputTokens: number; latencyMs: number; success: boolean; error?: string }) {
  if (!meta.supabase || !meta.userId) return;
  try {
    await meta.supabase.from("ai_usage").insert({
      user_id: meta.userId,
      task: meta.task,
      model: meta.model,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      estimated_cost_usd: estimateCostUsd(meta.model, r.inputTokens, r.outputTokens),
      latency_ms: r.latencyMs,
      fallback: !!meta.fallbackReason,
      fallback_reason: meta.fallbackReason ?? null,
      success: r.success,
      error: r.error?.slice(0, 500) ?? null,
    });
  } catch {
    // usage logging must never break the request
  }
}

/** Strip ```json fences and parse. Model output is untrusted text. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{"), end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new AIError("Model did not return valid JSON", text.slice(0, 2000));
  }
}

/** Plain text generation (used for transcription). */
export async function generateText(meta: CallMeta, opts: { system?: string; parts: Part[]; temperature?: number }): Promise<CallResult<string>> {
  const started = Date.now();
  try {
    const res = await gemini().models.generateContent({
      model: meta.model,
      contents: [{ role: "user", parts: opts.parts }],
      config: { systemInstruction: opts.system, temperature: opts.temperature ?? 0 },
    });
    const latencyMs = Date.now() - started;
    const inputTokens = res.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0;
    await logUsage(meta, { inputTokens, outputTokens, latencyMs, success: true });
    return { data: (res.text ?? "").trim(), model: meta.model, inputTokens, outputTokens, latencyMs };
  } catch (e) {
    await logUsage(meta, { inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, success: false, error: (e as Error).message });
    throw e instanceof AIError ? e : new AIError(`Gemini request failed: ${(e as Error).message}`);
  }
}

/**
 * Structured JSON generation. `jsonSchema` (optional) is passed as the
 * response schema; the result is always re-validated with Zod — the model's
 * compliance with the schema is never trusted.
 */
export async function generateStructured<S extends z.ZodTypeAny>(
  meta: CallMeta,
  opts: { system: string; parts: Part[]; schema: S; jsonSchema?: unknown; temperature?: number },
): Promise<CallResult<z.infer<S>> & { raw: unknown }> {
  const started = Date.now();
  let text = "";
  let inputTokens = 0, outputTokens = 0;
  try {
    const res = await gemini().models.generateContent({
      model: meta.model,
      contents: [{ role: "user", parts: opts.parts }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        ...(opts.jsonSchema ? { responseJsonSchema: opts.jsonSchema } : {}),
        temperature: opts.temperature ?? 0.1,
      },
    });
    text = res.text ?? "";
    inputTokens = res.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0;
  } catch (e) {
    await logUsage(meta, { inputTokens, outputTokens, latencyMs: Date.now() - started, success: false, error: (e as Error).message });
    throw new AIError(`Gemini request failed: ${(e as Error).message}`);
  }
  const latencyMs = Date.now() - started;
  let raw: unknown;
  try {
    raw = parseJsonLoose(text);
  } catch (e) {
    await logUsage(meta, { inputTokens, outputTokens, latencyMs, success: false, error: "invalid JSON" });
    throw e;
  }
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    await logUsage(meta, { inputTokens, outputTokens, latencyMs, success: false, error: `schema: ${msg}` });
    throw new AIError(`Model output failed schema validation: ${msg}`, text.slice(0, 2000));
  }
  await logUsage(meta, { inputTokens, outputTokens, latencyMs, success: true });
  return { data: parsed.data, raw, model: meta.model, inputTokens, outputTokens, latencyMs };
}

export function imagePart(bytes: Buffer | Uint8Array, mimeType: string): Part {
  return { inlineData: { data: Buffer.from(bytes).toString("base64"), mimeType } };
}
export function textPart(text: string): Part {
  return { text };
}
