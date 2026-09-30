import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateGraphDocument } from "../ai/generate-graph-document";
import { parseCommand } from "../ai/parse-command";
import { spokenToLabelCandidates } from "../books/page-label";
import { resolvePageReference } from "../books/page-resolver-db";
import type { ParsedCommand } from "../commands/schema";
import { findCachedQuestions, normalizeQuestionLabel } from "../questions/cache";
import { buildQuestionCrop, detectAndCacheQuestion, downloadCrop, downloadPageImage } from "../questions/detector";
import type { BookPageRow, BookRow, QuestionCacheRow } from "../supabase/types";
import { runFollowUp } from "./followup";

export interface CommandInput {
  text: string;
  bookId: string | null;
  graphSessionId?: string | null;
  resolvedPageId?: string | null;
  questionCacheId?: string | null;
  deep?: boolean;
  voice?: { durationMs: number | null; model: string | null } | null;
  forceNew?: boolean;
}

export type CommandOutcome =
  | { kind: "session"; sessionId: string; reused: boolean; command: ParsedCommand }
  | { kind: "followup"; sessionId: string; reply: string; command: ParsedCommand }
  | { kind: "navigate"; to: string; command: ParsedCommand }
  | { kind: "page"; bookId: string; pageId: string; pageLabel: string; pdfPageIndex: number; command: ParsedCommand }
  | { kind: "clarify_page"; message: string; candidates: { label: string; pageId: string; pdfPageIndex: number }[]; command: ParsedCommand }
  | { kind: "clarify_question"; message: string; candidates: { id: string; label: string; exercise: string | null }[]; pageId: string; command: ParsedCommand }
  | { kind: "question_not_found"; message: string; bookId: string; pageId: string; pageLabel: string; questionLabel: string; command: ParsedCommand }
  | { kind: "error"; message: string; command?: ParsedCommand };

function questionLabelFrom(ref: string): string {
  const c = spokenToLabelCandidates(ref);
  const label = c.length === 1 && /^\d+$/.test(c[0]) ? c[0] : ref;
  return normalizeQuestionLabel(label);
}

export async function runCommand(supabase: SupabaseClient, userId: string, input: CommandInput): Promise<CommandOutcome> {
  const text = input.text.trim();
  if (!text) return { kind: "error", message: "Say or type a command, e.g. “Page 4.33, question 22”." };

  const { command } = await parseCommand(text, { supabase, userId, hasOpenGraph: !!input.graphSessionId });
  if (input.deep) command.deep_analysis = true;

  const { data: vq } = await supabase
    .from("voice_queries")
    .insert({ user_id: userId, book_id: input.bookId, transcript: text, parsed_command: command, duration_ms: input.voice?.durationMs ?? null, transcription_model: input.voice?.model ?? null })
    .select("id")
    .single();
  const voiceQueryId = (vq as { id: string } | null)?.id ?? null;

  if (command.intent === "OPEN_HISTORY") return { kind: "navigate", to: "/history", command };

  // Follow-up on the open graph
  if (!command.page_reference && !input.resolvedPageId) {
    if (input.graphSessionId) {
      const r = await runFollowUp(supabase, userId, input.graphSessionId, text, command, { deep: input.deep });
      return { kind: "followup", sessionId: input.graphSessionId, reply: r.reply, command };
    }
    return { kind: "error", message: "I didn't catch a page. Try “Page 4.33, question 22”.", command };
  }

  // Book: explicitly named, else the active book
  let bookId = input.bookId;
  if (command.book_reference) {
    const { data: books } = await supabase.from("books").select("id,title").ilike("title", `%${command.book_reference.replace(/[%_]/g, "")}%`).limit(2);
    if (books && books.length === 1) bookId = (books[0] as { id: string }).id;
  }
  if (!bookId) return { kind: "error", message: "Choose a book first.", command };
  const { data: bookData } = await supabase.from("books").select("*").eq("id", bookId).single();
  const book = bookData as BookRow | null;
  if (!book) return { kind: "error", message: "Book not found.", command };

  // Page — deterministic resolver over the authoritative semantic page map
  let page: BookPageRow | null = null;
  if (input.resolvedPageId) {
    const { data } = await supabase.from("book_pages").select("*").eq("id", input.resolvedPageId).eq("book_id", bookId).single();
    page = data as BookPageRow | null;
  } else {
    const res = await resolvePageReference(supabase, { bookId, pageReference: command.page_reference, chapterReference: command.chapter_reference, transcriptContext: text });
    if (res.status === "ambiguous") {
      return {
        kind: "clarify_page",
        message: `Both ${res.candidates.map((c) => `page ${c.label}`).join(" and ")} exist. Which page?`,
        candidates: res.candidates.map((c) => ({ label: c.label, pageId: c.page.id, pdfPageIndex: c.page.pdf_page_index })),
        command,
      };
    }
    if (res.status === "not_found") {
      const mapped = book.page_mapping_status === "complete" || book.page_mapping_status === "needs_review";
      return {
        kind: "error",
        message: `I couldn't find page ${command.page_reference} in ${book.title}.${mapped ? " Check the page mapping if the label should exist." : " The page map for this book isn't finished yet — open Book → Mapping."}`,
        command,
      };
    }
    const { data } = await supabase.from("book_pages").select("*").eq("id", res.page.id).single();
    page = data as BookPageRow | null;
  }
  if (!page) return { kind: "error", message: "Page not found.", command };
  const pageLabel = page.page_label ?? `PDF ${page.pdf_page_index}`;

  await supabase.from("books").update({ last_opened_at: new Date().toISOString() }).eq("id", bookId);

  if (!command.question_reference && !input.questionCacheId) {
    return { kind: "page", bookId, pageId: page.id, pageLabel, pdfPageIndex: page.pdf_page_index, command };
  }

  // Question — cache first, Gemini detection lazily
  let question: QuestionCacheRow | null = null;
  if (input.questionCacheId) {
    const { data } = await supabase.from("question_cache").select("*").eq("id", input.questionCacheId).single();
    question = data as QuestionCacheRow | null;
  } else {
    const qLabel = questionLabelFrom(command.question_reference!);
    let cached = await findCachedQuestions(supabase, page.id, qLabel, command.exercise_reference);
    if (!cached.length) {
      const det = await detectAndCacheQuestion(supabase, userId, page, { label: qLabel, exercise: command.exercise_reference });
      if (det.status === "not_found") {
        return {
          kind: "question_not_found",
          message: `I found page ${pageLabel} but couldn't confidently identify Question ${qLabel}. Draw a box around it on the page.`,
          bookId, pageId: page.id, pageLabel, questionLabel: qLabel, command,
        };
      }
      cached = det.rows;
      if (command.exercise_reference) {
        const ex = command.exercise_reference.toLowerCase();
        const filtered = cached.filter((c) => (c.exercise_label ?? "").toLowerCase().includes(ex));
        if (filtered.length) cached = filtered;
      }
    }
    if (cached.length > 1) {
      return {
        kind: "clarify_question",
        message: `Question ${qLabel} appears more than once on page ${pageLabel}.`,
        candidates: cached.map((c) => ({ id: c.id, label: c.question_label, exercise: c.exercise_label })),
        pageId: page.id,
        command,
      };
    }
    question = cached[0];
  }
  if (!question) return { kind: "error", message: "Question not found.", command };

  // Reuse an identical previous session instead of paying for the same graph twice.
  if (!input.forceNew && !command.deep_analysis) {
    const { data: prev } = await supabase
      .from("graph_sessions").select("id,original_user_query")
      .eq("question_cache_id", question.id).order("created_at", { ascending: false }).limit(5);
    const same = (prev ?? []).find((p) => (p as { original_user_query: string }).original_user_query.trim().toLowerCase() === text.toLowerCase());
    if (same) {
      await supabase.from("graph_sessions").update({ last_opened_at: new Date().toISOString() }).eq("id", (same as { id: string }).id);
      return { kind: "session", sessionId: (same as { id: string }).id, reused: true, command };
    }
  }

  // Question image (crop, or rebuild it; the full page as last resort)
  let image: { bytes: Buffer; mime: string } | null = null;
  if (question.question_image_path) {
    const b = await downloadCrop(supabase, question.question_image_path);
    if (b) image = { bytes: b, mime: "image/webp" };
  }
  if (!image) {
    const pageImg = await downloadPageImage(supabase, page.storage_path);
    let nextImg: Buffer | null = null;
    if (question.continuation_page_ids?.length) {
      const { data: np } = await supabase.from("book_pages").select("storage_path").eq("id", question.continuation_page_ids[0]).maybeSingle();
      if (np) nextImg = await downloadPageImage(supabase, (np as { storage_path: string }).storage_path);
    }
    try {
      const crop = await buildQuestionCrop(supabase, userId, question, pageImg, nextImg);
      image = { bytes: crop.bytes, mime: "image/webp" };
    } catch {
      image = { bytes: pageImg, mime: page.storage_path.endsWith(".jpg") ? "image/jpeg" : "image/webp" };
    }
  }

  const gen = await generateGraphDocument(
    {
      questionText: question.question_text,
      questionImage: image,
      userQuery: text,
      requestedActions: command.requested_actions,
      pageLabel,
      questionLabel: question.question_label,
      exerciseLabel: question.exercise_label,
      deep: command.deep_analysis,
    },
    { supabase, userId },
  );

  const explanation = [gen.explanation, gen.solutionConnection].filter(Boolean).join("\n\n");
  const { data: sess, error } = await supabase
    .from("graph_sessions")
    .insert({
      user_id: userId,
      book_id: bookId,
      book_page_id: page.id,
      question_cache_id: question.id,
      voice_query_id: voiceQueryId,
      page_label: pageLabel,
      question_label: question.question_label,
      exercise_label: question.exercise_label,
      original_user_query: text,
      transcript: input.voice ? text : null,
      model_used: gen.modelUsed,
      fallback_reason: gen.fallbackReason,
      graph_document: gen.document,
      ai_explanation: explanation || null,
      ai_solution: gen.solution,
      question_summary: gen.questionSummary || null,
      confidence: gen.confidence,
    })
    .select("id")
    .single();
  if (error || !sess) return { kind: "error", message: `Could not save the graph: ${error?.message ?? "unknown error"}`, command };
  const sessionId = (sess as { id: string }).id;

  const notes: string[] = [];
  if (gen.autoFixes.length) notes.push(...gen.autoFixes);
  if (gen.dropped.length) notes.push(`${gen.dropped.length} generated object(s) failed validation and were left out: ${gen.dropped.map((d) => d.error).join("; ").slice(0, 400)}`);
  await supabase.from("graph_messages").insert([
    { user_id: userId, graph_session_id: sessionId, role: "user", content: text, structured_payload: command },
    { user_id: userId, graph_session_id: sessionId, role: "assistant", content: explanation || "Graph created.", structured_payload: { model: gen.modelUsed, fallbackReason: gen.fallbackReason, notes } },
  ]);
  return { kind: "session", sessionId, reused: false, command };
}
