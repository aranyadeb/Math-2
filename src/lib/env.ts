import { z } from "zod";

/** Public (browser-safe) configuration. */
const PublicEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

/** Server-only configuration. Never import this into client components. */
const ServerEnv = z.object({
  GEMINI_API_KEY: z.string().min(10),
  /** Optional API base URL override (proxies / the local end-to-end test backend). */
  GEMINI_BASE_URL: z.string().url().optional(),
  GEMINI_FAST_MODEL: z.string().min(1).default("gemini-3.1-flash-lite"),
  GEMINI_REASONING_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  GEMINI_TRANSCRIBE_MODEL: z.string().min(1).default("gemini-3.5-transcribe"),
  GEMINI_ESCALATION_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  GEMINI_FAST_PRICE_IN: z.coerce.number().default(0.1),
  GEMINI_FAST_PRICE_OUT: z.coerce.number().default(0.4),
  GEMINI_REASONING_PRICE_IN: z.coerce.number().default(0.3),
  GEMINI_REASONING_PRICE_OUT: z.coerce.number().default(2.5),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

export function publicEnv(): z.infer<typeof PublicEnv> | null {
  const r = PublicEnv.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return r.success ? r.data : null;
}

export class MissingConfigError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Missing or invalid environment variables: ${variables.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

export function serverEnv(): ServerEnv {
  const r = ServerEnv.safeParse(process.env);
  if (!r.success) throw new MissingConfigError([...new Set(r.error.issues.map((i) => String(i.path[0])))]);
  return r.data;
}

/** Model defaults without requiring the API key (for display in settings). */
export function modelConfig() {
  return {
    fast: process.env.GEMINI_FAST_MODEL || "gemini-3.1-flash-lite",
    reasoning: process.env.GEMINI_REASONING_MODEL || "gemini-3.8-flash",
    transcribe: process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe",
    geminiConfigured: !!process.env.GEMINI_API_KEY,
  };
}
