import { z } from "zod";

export const INTENTS = [
  "SHOW_GRAPH", "GRAPH_ALL_USEFUL", "SOLVE", "EXPLAIN", "SHOW_DERIVATIVE", "SHOW_SECOND_DERIVATIVE",
  "SHOW_TANGENT", "SHOW_NORMAL", "SHOW_INTEGRAL", "SHOW_AREA", "SHOW_INTERSECTION", "ADD_GRAPH",
  "REMOVE_GRAPH", "CHANGE_PARAMETER", "OPEN_PAGE", "OPEN_HISTORY", "SHOW_ONLY_ESSENTIAL", "UNKNOWN",
] as const;
export const Intent = z.enum(INTENTS);
export type Intent = z.infer<typeof Intent>;

/** All labels stay strings — never numbers. */
export const ParsedCommand = z.object({
  intent: Intent,
  page_reference: z.string().nullable().default(null),
  chapter_reference: z.string().nullable().default(null),
  exercise_reference: z.string().nullable().default(null),
  question_reference: z.string().nullable().default(null),
  book_reference: z.string().nullable().default(null),
  requested_actions: z.array(Intent).default([]),
  /** x-value for tangent/normal, slider name/range, expression to add, target to remove. */
  x_value: z.string().nullable().default(null),
  parameter_name: z.string().nullable().default(null),
  parameter_min: z.number().nullable().default(null),
  parameter_max: z.number().nullable().default(null),
  expression: z.string().nullable().default(null),
  target: z.string().nullable().default(null),
  deep_analysis: z.boolean().default(false),
});
export type ParsedCommand = z.infer<typeof ParsedCommand>;

export function emptyCommand(intent: Intent = "UNKNOWN"): ParsedCommand {
  return ParsedCommand.parse({ intent });
}

/** JSON schema sent to Gemini for structured output (kept flat for model compatibility). */
export const PARSED_COMMAND_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...INTENTS] },
    page_reference: { type: ["string", "null"], description: "Semantic page label as spoken/written, e.g. '4.33', '233', 'xiv'. Never convert to a number." },
    chapter_reference: { type: ["string", "null"] },
    exercise_reference: { type: ["string", "null"] },
    question_reference: { type: ["string", "null"] },
    book_reference: { type: ["string", "null"], description: "Only if the user explicitly names a book" },
    requested_actions: { type: "array", items: { type: "string", enum: [...INTENTS] } },
    x_value: { type: ["string", "null"] },
    parameter_name: { type: ["string", "null"] },
    parameter_min: { type: ["number", "null"] },
    parameter_max: { type: ["number", "null"] },
    expression: { type: ["string", "null"] },
    target: { type: ["string", "null"] },
    deep_analysis: { type: "boolean" },
  },
  required: ["intent", "page_reference", "question_reference", "requested_actions"],
} as const;
