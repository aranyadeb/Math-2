import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GraphPatch, type GraphDocument } from "../graph/schema";
import { applyPatch, PatchError } from "../graph/validation";
import { generateStructured, textPart } from "./client";
import { modelFor } from "./models";
import { PATCH_SYSTEM } from "./prompts";

const PatchResponse = z.object({
  operations: z.array(z.unknown()).max(40).default([]),
  reply: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.7),
});

/**
 * Ask Gemini for a patch against the current document. Each operation is
 * validated; the patch is applied atomically and must leave a valid document.
 * One retry with the exact error, then escalate to the reasoning model.
 */
export async function patchGraphDocument(
  doc: GraphDocument,
  request: string,
  context: { questionText: string | null; explanation: string | null },
  ctx: { supabase: SupabaseClient; userId: string; deep?: boolean },
): Promise<{ document: GraphDocument; reply: string; model: string; operations: GraphPatch["operations"] }> {
  const models = ctx.deep ? [modelFor("reasoning")] : [modelFor("fast"), modelFor("fast"), modelFor("reasoning")];
  let lastError = "";
  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[attempt];
    const r = await generateStructured(
      { task: "patch_graph", model, supabase: ctx.supabase, userId: ctx.userId, fallbackReason: attempt === 2 ? `patch failed: ${lastError.slice(0, 200)}` : null },
      {
        system: PATCH_SYSTEM,
        parts: [
          textPart(
            [
              context.questionText ? `Question: ${context.questionText.slice(0, 2000)}` : "",
              `Current graph document:\n${JSON.stringify(doc).slice(0, 12000)}`,
              `Follow-up request: ${JSON.stringify(request)}`,
              lastError ? `Your previous patch was rejected: ${lastError}. Fix only that problem.` : "",
            ].filter(Boolean).join("\n\n"),
          ),
        ],
        schema: PatchResponse,
      },
    );
    const parsed = GraphPatch.safeParse({ operations: r.data.operations });
    if (!parsed.success) {
      lastError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      continue;
    }
    try {
      const next = applyPatch(doc, parsed.data, { allowUserChanges: /\b(my|mine|user)\b/i.test(request) });
      return { document: next, reply: r.data.reply, model, operations: parsed.data.operations };
    } catch (e) {
      lastError = e instanceof PatchError ? e.message : String(e);
    }
  }
  throw new PatchError(`Could not apply the requested change: ${lastError}`);
}
