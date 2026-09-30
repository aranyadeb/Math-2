import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, textPart } from "./client";
import { modelFor } from "./models";
import { TRANSCRIBE_SYSTEM, TRANSCRIBE_VOCABULARY } from "./prompts";

const ALLOWED = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac", "audio/m4a", "audio/x-m4a"]);

export function normalizeAudioMime(mime: string): string | null {
  const base = mime.split(";")[0].trim().toLowerCase();
  return ALLOWED.has(base) ? base : null;
}

export async function transcribeAudio(
  audio: Buffer,
  mime: string,
  ctx: { supabase: SupabaseClient; userId: string; bookTitle?: string | null },
): Promise<{ transcript: string; model: string }> {
  const model = modelFor("transcribe");
  const hints = ctx.bookTitle ? `Active book: ${ctx.bookTitle}.` : "";
  const r = await generateText(
    { task: "transcribe", model, supabase: ctx.supabase, userId: ctx.userId },
    {
      system: TRANSCRIBE_SYSTEM,
      parts: [
        { inlineData: { data: audio.toString("base64"), mimeType: mime } },
        textPart(`Transcribe this command. ${hints} Vocabulary hints: ${TRANSCRIBE_VOCABULARY.join(", ")}.`),
      ],
    },
  );
  return { transcript: r.data.replace(/^["']|["']$/g, "").trim(), model };
}
