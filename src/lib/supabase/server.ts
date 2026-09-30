import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv } from "../env";

/** Per-request Supabase client acting as the signed-in user (RLS applies). */
export async function getServerSupabase(): Promise<SupabaseClient> {
  const env = publicEnv();
  if (!env) throw new Error("Supabase is not configured");
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // called from a Server Component — middleware refreshes the session instead
        }
      },
    },
  });
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
  }
}

/** Returns the authenticated user (validated with the Auth server, not just the cookie). */
export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new UnauthorizedError();
  return { supabase, user: data.user };
}
