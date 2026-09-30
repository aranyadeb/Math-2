import { NextResponse } from "next/server";
import { transcribeAudio, normalizeAudioMime } from "@/lib/ai/transcribe";
import { jsonError, withErrors } from "@/lib/api/handler";
import { modelFor } from "@/lib/ai/models";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 6 * 1024 * 1024; // ~ a few minutes of opus audio; commands are seconds long

/** Audio is transcribed and discarded — raw audio is never stored. */
export const POST = withErrors(async (req: Request) => {
  const { supabase, user } = await requireUser();
  const form = await req.formData();
  const file = form.get("audio");
  const bookTitle = typeof form.get("bookTitle") === "string" ? (form.get("bookTitle") as string).slice(0, 200) : null;
  if (!(file instanceof Blob)) return jsonError("Missing audio", 400);
  if (file.size === 0) return jsonError("Empty recording", 400);
  if (file.size > MAX_BYTES) return jsonError("Recording too long", 413);
  const mime = normalizeAudioMime(file.type || "audio/webm");
  if (!mime) return jsonError(`Unsupported audio type ${file.type}`, 415);
  const buf = Buffer.from(await file.arrayBuffer());
  const { transcript, model } = await transcribeAudio(buf, mime, { supabase, userId: user.id, bookTitle });
  if (!transcript || transcript === "[inaudible]") return jsonError("I couldn't hear a command. Please try again.", 422);
  return NextResponse.json({ transcript, model: model ?? modelFor("transcribe") });
});
