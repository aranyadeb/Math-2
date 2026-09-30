import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrors, jsonError } from "@/lib/api/handler";
import { runMappingBatch } from "@/lib/books/mapping-service";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  batchSize: z.number().int().min(1).max(30).optional(),
  pdfPageIndexes: z.array(z.number().int().min(1)).max(60).optional(),
});

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await ctx.params;
  if (!z.string().uuid().safeParse(bookId).success) return jsonError("Bad book id", 400);
  const { supabase, user } = await requireUser();
  const { data: book } = await supabase.from("books").select("id").eq("id", bookId).maybeSingle();
  if (!book) return jsonError("Book not found", 404);
  const body = await parseBody(req, Body);
  const progress = await runMappingBatch(supabase, user.id, bookId, body);
  return NextResponse.json(progress);
});
