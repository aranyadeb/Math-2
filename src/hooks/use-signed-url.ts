"use client";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

const cache = new Map<string, { url: string; expires: number }>();
const TTL = 60 * 60; // seconds

function key(bucket: string, path: string) {
  return `${bucket}/${path}`;
}

/** Private storage only: short-lived signed URLs, cached in memory. */
export async function signedUrl(bucket: string, path: string): Promise<string> {
  const k = key(bucket, path);
  const hit = cache.get(k);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await getBrowserSupabase().storage.from(bucket).createSignedUrl(path, TTL);
  if (error || !data) throw new Error(error?.message ?? "Could not sign URL");
  cache.set(k, { url: data.signedUrl, expires: Date.now() + TTL * 1000 });
  return data.signedUrl;
}

export async function signedUrls(bucket: string, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of paths) {
    const hit = cache.get(key(bucket, p));
    if (hit && hit.expires > Date.now() + 60_000) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length) {
    const { data } = await getBrowserSupabase().storage.from(bucket).createSignedUrls(missing, TTL);
    for (const d of data ?? []) {
      if (d.signedUrl && d.path) {
        out[d.path] = d.signedUrl;
        cache.set(key(bucket, d.path), { url: d.signedUrl, expires: Date.now() + TTL * 1000 });
      }
    }
  }
  return out;
}

export function useSignedUrl(bucket: string, path: string | null | undefined): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    let alive = true;
    if (!path) {
      setState({ url: null, error: null });
      return;
    }
    signedUrl(bucket, path).then(
      (url) => alive && setState({ url, error: null }),
      (e: Error) => alive && setState({ url: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [bucket, path]);
  return state;
}
