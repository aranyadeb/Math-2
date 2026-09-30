import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, textPart } from "./client";
import { REPAIR_SYSTEM } from "./prompts";

const RepairResponse = z.object({ object: z.unknown().nullable() });

/** Ask the model to fix ONE invalid object given the exact validation error. */
export function makeRepairFn(ctx: { supabase: SupabaseClient; userId: string; model: string }) {
  return async (object: unknown, error: string, otherIds: string[]): Promise<unknown | null> => {
    const r = await generateStructured(
      { task: "repair_graph_object", model: ctx.model, supabase: ctx.supabase, userId: ctx.userId },
      {
        system: REPAIR_SYSTEM,
        parts: [textPart(`Invalid object:\n${JSON.stringify(object).slice(0, 3000)}\n\nValidation error: ${error}\n\nOther object ids: ${JSON.stringify(otherIds)}`)],
        schema: RepairResponse,
      },
    );
    return r.data.object ?? null;
  };
}
