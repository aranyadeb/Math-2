import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrors, jsonError } from "@/lib/api/handler";
import { runFollowUp } from "@/lib/pipeline/followup";
import { PatchError } from "@/lib/graph/validation";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 90;

const Body = z.object({ text: z.string().min(1).max(1000), deep: z.boolean().optional() });

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ sessionId: string }> }) => {
  const { sessionId } = await ctx.params;
  if (!z.string().uuid().safeParse(sessionId).success) return jsonError("Bad session id", 400);
  const { supabase, user } = await requireUser();
  const body = await parseBody(req, Body);
  try {
    const r = await runFollowUp(supabase, user.id, sessionId, body.text, null, { deep: body.deep });
    return NextResponse.json({ document: r.document, reply: r.reply, handledBy: r.handledBy, model: r.model });
  } catch (e) {
    if (e instanceof PatchError) return jsonError(e.message, 422);
    throw e;
  }
});
