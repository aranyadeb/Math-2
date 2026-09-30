import "server-only";
import type { Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "../env";
import { buildDocumentFromAI, GraphAIResponse, type PipelineResult } from "../graph/ai-pipeline";
import type { GraphDocument } from "../graph/schema";
import { AIError, generateStructured, imagePart, textPart } from "./client";
import { modelFor } from "./models";
import { GRAPH_SYSTEM } from "./prompts";
import { makeRepairFn } from "./repair-graph-object";

export interface GraphGenerationInput {
  questionText: string | null;
  questionImage: { bytes: Buffer; mime: string } | null;
  userQuery: string;
  requestedActions: string[];
  pageLabel: string;
  questionLabel: string | null;
  exerciseLabel: string | null;
  deep: boolean;
}

export interface GraphGenerationResult extends PipelineResult {
  questionSummary: string;
  explanation: string;
  solutionConnection: string;
  solution: string | null;
  confidence: number;
  modelUsed: string;
  fallbackReason: string | null;
}

const COMPLEX = /\blocus\b|\bfamily of (curves|lines|circles)\b|\benvelope\b|orthogonal trajector|\bimplicit(ly)?\b.*\bdifferentiat/i;

async function runOnce(input: GraphGenerationInput, model: string, ctx: { supabase: SupabaseClient; userId: string }, fallbackReason: string | null, note?: string) {
  const parts: Part[] = [];
  if (input.questionImage) parts.push(imagePart(input.questionImage.bytes, input.questionImage.mime));
  parts.push(
    textPart(
      [
        `Textbook page ${input.pageLabel}${input.exerciseLabel ? `, ${input.exerciseLabel}` : ""}${input.questionLabel ? `, question ${input.questionLabel}` : ""}.`,
        input.questionText ? `Question text (OCR, may contain small errors — trust the image where they differ):\n${input.questionText}` : "",
        `Student request: ${JSON.stringify(input.userQuery)}`,
        input.requestedActions.length ? `Requested actions: ${input.requestedActions.join(", ")}` : "",
        note ?? "",
      ].filter(Boolean).join("\n\n"),
    ),
  );
  const r = await generateStructured(
    { task: "generate_graph", model, supabase: ctx.supabase, userId: ctx.userId, fallbackReason },
    { system: GRAPH_SYSTEM, parts, schema: GraphAIResponse, temperature: 0.2 },
  );
  const repair = makeRepairFn({ ...ctx, model });
  const built = await buildDocumentFromAI(
    r.data,
    { title: r.data.questionSummary.slice(0, 200) || undefined, pageLabel: input.pageLabel, questionLabel: input.questionLabel ?? undefined },
    repair,
  );
  return { response: r.data, built };
}

/**
 * Fast model first; escalate to the reasoning model when confidence is low,
 * the model asks for it, validation dropped objects, the problem is complex,
 * or the user chose Deep Analysis. model_used + fallback_reason are recorded.
 */
export async function generateGraphDocument(input: GraphGenerationInput, ctx: { supabase: SupabaseClient; userId: string }): Promise<GraphGenerationResult> {
  const env = serverEnv();
  const fast = modelFor("fast"), reasoning = modelFor("reasoning");
  let fallbackReason: string | null = null;

  if (input.deep) fallbackReason = "user selected Deep Analysis";
  else if (COMPLEX.test(input.questionText ?? "")) fallbackReason = "complex implicit/locus/parameter problem";

  let first: Awaited<ReturnType<typeof runOnce>> | null = null;
  if (!fallbackReason) {
    try {
      first = await runOnce(input, fast, ctx, null);
      const { response, built } = first;
      if (response.needsReasoningFallback) fallbackReason = "fast model requested escalation";
      else if (response.confidence < env.GEMINI_ESCALATION_CONFIDENCE) fallbackReason = `low confidence (${response.confidence.toFixed(2)})`;
      else if (built.dropped.length > 0) fallbackReason = `validation failed for ${built.dropped.length} object(s)`;
      else if (response.objects.length > 0 && built.document.objects.length === 0) fallbackReason = "no valid objects";
    } catch (e) {
      fallbackReason = `fast model error: ${(e as Error).message.slice(0, 120)}`;
    }
  }

  if (fallbackReason) {
    try {
      const note = first?.built.dropped.length
        ? `A previous attempt produced invalid objects: ${first.built.dropped.map((d) => d.error).join(" | ").slice(0, 800)}. Avoid these errors.`
        : undefined;
      const second = await runOnce(input, reasoning, ctx, fallbackReason, note);
      // Prefer the reasoning result unless it is strictly worse (fewer valid objects and more drops).
      if (!first || second.built.dropped.length <= first.built.dropped.length || second.built.document.objects.length >= first.built.document.objects.length) {
        return pack(second, reasoning, fallbackReason);
      }
    } catch (e) {
      if (!first) throw e instanceof AIError ? e : new AIError((e as Error).message);
      fallbackReason = `${fallbackReason}; reasoning model failed: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  if (!first) throw new AIError("Graph generation failed");
  return pack(first, fast, fallbackReason);
}

function pack(run: Awaited<ReturnType<typeof runOnce>>, model: string, fallbackReason: string | null): GraphGenerationResult {
  return {
    ...run.built,
    questionSummary: run.response.questionSummary,
    explanation: run.response.explanation,
    solutionConnection: run.response.solutionConnection,
    solution: run.response.solution ?? null,
    confidence: run.response.confidence,
    modelUsed: model,
    fallbackReason,
  };
}

export type { GraphDocument };
