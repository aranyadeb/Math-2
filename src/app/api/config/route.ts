import { NextResponse } from "next/server";
import { modelConfig } from "@/lib/env";
import { withErrors } from "@/lib/api/handler";
import { requireUser } from "@/lib/supabase/server";

/** Non-secret configuration for the settings screen (model ids, whether Gemini is configured). */
export const GET = withErrors(async () => {
  await requireUser();
  return NextResponse.json(modelConfig());
});
