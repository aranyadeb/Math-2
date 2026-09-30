import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { MissingConfigError } from "../env";
import { AIError } from "../ai/client";
import { UnauthorizedError } from "../supabase/server";

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Uniform error mapping; never leaks secrets or stack traces. */
export function handleError(e: unknown) {
  if (e instanceof UnauthorizedError) return jsonError("Please sign in.", 401);
  if (e instanceof MissingConfigError) {
    return jsonError(`Server is missing configuration: ${e.variables.join(", ")}. See README → Environment.`, 503, { missing: e.variables });
  }
  if (e instanceof AIError) return jsonError(e.message, 502);
  console.error(e);
  return jsonError((e as Error)?.message ?? "Unexpected error", 500);
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new BadRequest("Body must be JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new BadRequest(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export class BadRequest extends Error {}

export function withErrors<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof BadRequest) return jsonError(e.message, 400);
      return handleError(e);
    }
  };
}
