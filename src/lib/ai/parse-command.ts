import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ParsedCommand, PARSED_COMMAND_JSON_SCHEMA } from "../commands/schema";
import { quickParse } from "../commands/quick-parse";
import { generateStructured, textPart } from "./client";
import { modelFor } from "./models";
import { PARSE_COMMAND_SYSTEM } from "./prompts";

/**
 * Deterministic fast path first; Gemini (fast model, structured output) only
 * when the command is not recognised. The result only feeds deterministic
 * routing code — the model is not the router.
 */
export async function parseCommand(
  text: string,
  ctx: { supabase: SupabaseClient; userId: string; hasOpenGraph: boolean },
): Promise<{ command: ParsedCommand; via: "quick" | "ai"; model: string | null }> {
  const quick = quickParse(text);
  if (quick) return { command: quick, via: "quick", model: null };
  const model = modelFor("fast");
  const r = await generateStructured(
    { task: "parse_command", model, supabase: ctx.supabase, userId: ctx.userId },
    {
      system: PARSE_COMMAND_SYSTEM,
      parts: [textPart(`${ctx.hasOpenGraph ? "A graph is currently open (follow-ups allowed)." : "No graph is open."}\nCommand: ${JSON.stringify(text)}`)],
      schema: ParsedCommand,
      jsonSchema: PARSED_COMMAND_JSON_SCHEMA,
    },
  );
  return { command: r.data, via: "ai", model };
}
