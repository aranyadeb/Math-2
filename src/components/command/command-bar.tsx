"use client";
import { useEffect, useRef, useState } from "react";
import { useRecorder } from "../voice/use-recorder";
import { Button, Input, Modal, Notice, Spinner, cx } from "../ui/primitives";
import { useApp } from "../layout/app-state";
import { useCommand } from "./use-command";

const STAGES = ["Finding the page…", "Locating the question…", "Reading the mathematics…", "Building graphs…", "Checking the graphs…"];

export function MicButton({ state, onPress, size = "lg", elapsed }: { state: string; onPress: () => void; size?: "lg" | "sm"; elapsed?: number }) {
  const recording = state === "recording";
  const label = recording ? "Stop recording" : state === "processing" ? "Processing" : "Start voice command";
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      aria-pressed={recording}
      disabled={state === "processing" || state === "requesting"}
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full transition disabled:opacity-60",
        size === "lg" ? "size-24" : "size-10",
        recording ? "recording bg-red-600 text-white" : "bg-accent text-accent-fg hover:opacity-90",
      )}
    >
      {state === "processing" ? (
        <Spinner className={size === "lg" ? "size-8" : "size-4"} label="Processing" />
      ) : recording ? (
        <span className={cx("rounded-sm bg-white", size === "lg" ? "size-7" : "size-3.5")} />
      ) : (
        <svg aria-hidden viewBox="0 0 24 24" className={size === "lg" ? "size-10" : "size-5"} fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
        </svg>
      )}
      {recording && elapsed !== undefined && size === "lg" ? <span className="sr-only">{Math.round(elapsed / 1000)} seconds</span> : null}
    </button>
  );
}

/**
 * Voice + text command entry. Voice → /api/voice/transcribe (Gemini) → the
 * same command pipeline as typed text.
 */
export function CommandBar({ graphSessionId, variant = "hero", onFollowUp, placeholder }: {
  graphSessionId?: string | null;
  variant?: "hero" | "inline";
  onFollowUp?: (reply: string) => void;
  placeholder?: string;
}) {
  const { activeBook, prefs } = useApp();
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [deep, setDeep] = useState(!!prefs.graph_preferences.deepAnalysisDefault);
  const [stage, setStage] = useState(0);
  const cmd = useCommand({ onFollowUp });
  const lastVoice = useRef<{ durationMs: number; model: string | null } | null>(null);

  useEffect(() => setDeep(!!prefs.graph_preferences.deepAnalysisDefault), [prefs.graph_preferences.deepAnalysisDefault]);
  useEffect(() => {
    if (!cmd.busy) return setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(STAGES.length - 1, s + 1)), 3500);
    return () => clearInterval(t);
  }, [cmd.busy]);

  const submit = (value: string, voice?: { durationMs: number; model: string | null } | null) => {
    const v = value.trim();
    if (!v) return;
    cmd.run({ text: v, bookId: activeBook?.id ?? null, graphSessionId: graphSessionId ?? null, deep, voice: voice ?? null });
  };

  const rec = useRecorder({
    onComplete: async (blob, durationMs) => {
      try {
        const fd = new FormData();
        fd.append("audio", blob, "command");
        if (activeBook) fd.append("bookTitle", activeBook.title);
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Transcription failed");
        setTranscript(data.transcript);
        setText(data.transcript);
        lastVoice.current = { durationMs, model: data.model ?? null };
        rec.reset();
        submit(data.transcript, lastVoice.current);
      } catch (e) {
        rec.reset();
        rec.setError((e as Error).message);
      }
    },
  });

  const onMic = () => (rec.state === "recording" ? rec.stop() : rec.start());
  const statusText =
    rec.state === "recording" ? `Listening… ${Math.floor(rec.elapsed / 1000)}s — tap to stop`
      : rec.state === "requesting" ? "Waiting for microphone permission…"
        : rec.state === "processing" ? "Transcribing…"
          : cmd.busy ? STAGES[stage] : null;

  const clarify = cmd.clarify;
  return (
    <div className={variant === "hero" ? "flex flex-col items-center gap-4" : "flex flex-col gap-2"}>
      {variant === "hero" ? (
        <>
          <MicButton state={rec.state === "idle" && cmd.busy ? "processing" : rec.state} onPress={onMic} elapsed={rec.elapsed} />
          <p aria-live="polite" className="min-h-5 text-sm text-muted">{statusText ?? "Ask about a question"}</p>
          {transcript && !cmd.busy ? <p className="text-center text-sm italic text-muted">“{transcript}”</p> : null}
        </>
      ) : null}
      <form
        className="flex w-full items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          lastVoice.current = null;
          submit(text, null);
        }}
      >
        {variant === "inline" ? <MicButton size="sm" state={rec.state === "idle" && cmd.busy ? "processing" : rec.state} onPress={onMic} /> : null}
        <label className="sr-only" htmlFor={`cmd-${variant}`}>Command</label>
        <Input
          id={`cmd-${variant}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? "Page 4.33, question 22"}
          autoComplete="off"
          enterKeyHint="go"
          disabled={cmd.busy}
        />
        <Button type="submit" variant="primary" disabled={cmd.busy || !text.trim()}>
          {cmd.busy ? <Spinner /> : "Go"}
        </Button>
      </form>
      <div className="flex w-full items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Deep analysis
        </label>
        {variant === "inline" && statusText ? <span aria-live="polite" className="text-xs text-muted">{statusText}</span> : null}
      </div>
      {rec.error ? <Notice tone="warn" className="w-full">{rec.error}</Notice> : null}
      {cmd.error ? <Notice tone="error" className="w-full">{cmd.error}</Notice> : null}

      <Modal open={!!clarify} onClose={() => cmd.setClarify(null)} title={clarify?.outcome.kind === "clarify_page" ? "Which page?" : "Which question?"}>
        {clarify ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">{clarify.outcome.message}</p>
            {clarify.outcome.kind === "clarify_page"
              ? clarify.outcome.candidates.map((c) => (
                <Button key={c.pageId} className="w-full justify-start" onClick={() => { cmd.setClarify(null); cmd.run({ ...clarify.request, resolvedPageId: c.pageId }); }}>
                  Page {c.label} <span className="ml-auto text-xs text-muted">PDF {c.pdfPageIndex}</span>
                </Button>
              ))
              : clarify.outcome.candidates.map((c) => (
                <Button key={c.id} className="w-full justify-start" onClick={() => {
                  const o = clarify.outcome as Extract<typeof clarify.outcome, { kind: "clarify_question" }>;
                  cmd.setClarify(null);
                  cmd.run({ ...clarify.request, resolvedPageId: o.pageId, questionCacheId: c.id });
                }}>
                  Q{c.label} {c.exercise ? <span className="text-muted">under {c.exercise}</span> : null}
                </Button>
              ))}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
