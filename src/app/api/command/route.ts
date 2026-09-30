import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrors } from "@/lib/api/handler";
import { runCommand } from "@/lib/pipeline/run-command";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  text: z.string().min(1).max(1000),
  bookId: z.string().uuid().nullable(),
  graphSessionId: z.string().uuid().nullable().optional(),
  resolvedPageId: z.string().uuid().nullable().optional(),
  questionCacheId: z.string().uuid().nullable().optional(),
  deep: z.boolean().optional(),
  forceNew: z.boolean().optional(),
  voice: z.object({ durationMs: z.number().int().nonnegative().nullable(), model: z.string().max(100).nullable() }).nullable().optional(),
});

export const POST = withErrors(async (req: Request) => {
  const { supabase, user } = await requireUser();
  const body = await parseBody(req, Body);
  const outcome = await runCommand(supabase, user.id, body);
  return NextResponse.json(outcome);
});
