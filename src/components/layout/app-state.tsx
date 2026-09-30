"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabase, supabaseConfigured } from "@/lib/supabase/client";
import type { BookRow } from "@/lib/supabase/types";

export interface Preferences {
  active_book_id: string | null;
  graph_preferences: { deepAnalysisDefault?: boolean };
  voice_preferences: { autoSubmit?: boolean };
  ui_preferences: { theme?: "system" | "light" | "dark"; defaultQuality?: "economy" | "balanced" | "high" };
}

interface AppState {
  user: User | null;
  loading: boolean;
  books: BookRow[];
  activeBook: BookRow | null;
  prefs: Preferences;
  setActiveBook: (id: string | null) => Promise<void>;
  updatePrefs: (patch: Partial<Preferences>) => Promise<void>;
  refreshBooks: () => Promise<void>;
}

const DEFAULT_PREFS: Preferences = { active_book_id: null, graph_preferences: {}, voice_preferences: {}, ui_preferences: {} };
const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);

  const refreshBooks = useCallback(async () => {
    const { data } = await getBrowserSupabase().from("books").select("*").order("last_opened_at", { ascending: false, nullsFirst: false });
    setBooks((data ?? []) as BookRow[]);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured()) {
      setLoading(false);
      return;
    }
    const sb = getBrowserSupabase();
    let alive = true;
    (async () => {
      const { data } = await sb.auth.getUser();
      if (!alive) return;
      setUser(data.user);
      if (data.user) {
        const [{ data: p }] = await Promise.all([sb.from("user_preferences").select("*").eq("user_id", data.user.id).maybeSingle(), refreshBooks()]);
        if (p) setPrefs({ ...DEFAULT_PREFS, ...(p as Preferences) });
        else await sb.from("user_preferences").upsert({ user_id: data.user.id });
      }
      setLoading(false);
    })();
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshBooks]);

  // Theme
  useEffect(() => {
    const t = prefs.ui_preferences.theme ?? "system";
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.classList.toggle("light", t === "light");
  }, [prefs.ui_preferences.theme]);

  const updatePrefs = useCallback(async (patch: Partial<Preferences>) => {
    if (!user) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await getBrowserSupabase().from("user_preferences").upsert({ user_id: user.id, ...next });
  }, [prefs, user]);

  const setActiveBook = useCallback(async (id: string | null) => {
    await updatePrefs({ active_book_id: id });
    if (id) await getBrowserSupabase().from("books").update({ last_opened_at: new Date().toISOString() }).eq("id", id);
  }, [updatePrefs]);

  const activeBook = useMemo(() => books.find((b) => b.id === prefs.active_book_id) ?? books[0] ?? null, [books, prefs.active_book_id]);

  const value = useMemo(() => ({ user, loading, books, activeBook, prefs, setActiveBook, updatePrefs, refreshBooks }), [user, loading, books, activeBook, prefs, setActiveBook, updatePrefs, refreshBooks]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
