import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCommand } from "../ai/parse-command";
import { patchGraphDocument } from "../ai/patch-graph-document";
import type { ParsedCommand } from "../commands/schema";
import { deterministicFollowUp } from "../graph/followups";
import { objectFromEntry } from "../graph/manual-entry";
import type { GraphDocument } from "../graph/schema";
import { restoreGraphDocument } from "../graph/serializer";
import { applyPatch } from "../graph/validation";
import type { GraphSessionRow, QuestionCacheRow } from "../supabase/types";

export interface FollowUpResult {
  document: GraphDocument;
  reply: string;
  model: string | null;
  handledBy: "deterministic" | "ai";
}

/**
 * Follow-up on an open graph session. Returns a patched document; simple
 * requests never touch the model. User-created objects are preserved unless
 * the user explicitly asks to change them.
 */
export async function runFollowUp(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  text: string,
  parsed?: ParsedCommand | null,
  opts: { deep?: boolean } = {},
): Promise<FollowUpResult> {
  const { data: s, error } = await supabase.from("graph_sessions").select("*").eq("id", sessionId).single();
  if (error || !s) throw new Error("Graph session not found");
  const session = s as GraphSessionRow;
  const doc = restoreGraphDocument(session.graph_document);

  const cmd = parsed ?? (await parseCommand(text, { supabase, userId, hasOpenGraph: true })).command;
  let result: FollowUpResult | null = null;

  const det = deterministicFollowUp(doc, cmd);
  if (det) {
    const allowUser = cmd.intent === "REMOVE_GRAPH" && /\b(my|mine)\b/i.test(text);
    try {
      result = { document: applyPatch(doc, det.patch, { allowUserChanges: allowUser || cmd.intent !== "REMOVE_GRAPH" }), reply: det.reply, model: null, handledBy: "deterministic" };
    } catch {
      result = null; // fall through to the model
    }
  }
  if (!result && cmd.intent === "ADD_GRAPH" && cmd.expression) {
    const r = objectFromEntry(doc, cmd.expression);
    if (r.ok) {
      const added = { ...r.object, source: "question" as const, group: "supporting" as const };
      result = { document: applyPatch(doc, { operations: [{ op: "add", object: added }] }), reply: `Added ${cmd.expression}.`, model: null, handledBy: "deterministic" };
    }
  }
  if (!result) {
    let questionText: string | null = null;
    if (session.question_cache_id) {
      const { data: q } = await supabase.from("question_cache").select("question_text").eq("id", session.question_cache_id).maybeSingle();
      questionText = (q as Pick<QuestionCacheRow, "question_text"> | null)?.question_text ?? null;
    }
    const r = await patchGraphDocument(doc, text, { questionText, explanation: session.ai_explanation }, { supabase, userId, deep: opts.deep || cmd.deep_analysis });
    result = { document: r.document, reply: r.reply || "Updated the graph.", model: r.model, handledBy: "ai" };
  }

  const isSolve = cmd.intent === "SOLVE" || cmd.requested_actions.includes("SOLVE");
  const { error: upErr } = await supabase
    .from("graph_sessions")
    .update({
      graph_document: result.document,
      ...(isSolve && result.reply ? { ai_solution: result.reply } : {}),
      last_opened_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
  if (upErr) throw new Error(`Could not save graph: ${upErr.message}`);
  await supabase.from("graph_messages").insert([
    { user_id: userId, graph_session_id: sessionId, role: "user", content: text, structured_payload: cmd },
    { user_id: userId, graph_session_id: sessionId, role: "assistant", content: result.reply, structured_payload: { handledBy: result.handledBy, model: result.model } },
  ]);
  return result;
}
