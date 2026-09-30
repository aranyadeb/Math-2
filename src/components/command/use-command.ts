"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommandOutcome } from "@/lib/pipeline/run-command";

export interface CommandRequest {
  text: string;
  bookId: string | null;
  graphSessionId?: string | null;
  resolvedPageId?: string | null;
  questionCacheId?: string | null;
  deep?: boolean;
  forceNew?: boolean;
  voice?: { durationMs: number | null; model: string | null } | null;
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Sends commands through the shared pipeline and performs deterministic navigation on the outcome. */
export function useCommand(opts: { onFollowUp?: (reply: string) => void } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<{ outcome: Extract<CommandOutcome, { kind: "clarify_page" | "clarify_question" }>; request: CommandRequest } | null>(null);

  const run = useCallback(
    async (req: CommandRequest) => {
      setBusy(true);
      setError(null);
      try {
        const out = await postJSON<CommandOutcome>("/api/command", req);
        switch (out.kind) {
          case "session":
            router.push(`/graph/${out.sessionId}`);
            break;
          case "followup":
            opts.onFollowUp?.(out.reply);
            break;
          case "navigate":
            router.push(out.to);
            break;
          case "page":
            router.push(`/books/${out.bookId}/page/${out.pageId}`);
            break;
          case "question_not_found": {
            const q = new URLSearchParams({ q: out.questionLabel, cmd: req.text, msg: out.message });
            router.push(`/books/${out.bookId}/page/${out.pageId}?${q.toString()}`);
            break;
          }
          case "clarify_page":
          case "clarify_question":
            setClarify({ outcome: out, request: req });
            break;
          case "error":
            setError(out.message);
            break;
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [opts, router],
  );

  return { run, busy, error, setError, clarify, setClarify };
}
