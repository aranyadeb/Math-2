"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "processing" | "error";

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((c) => MediaRecorder.isTypeSupported?.(c)) ?? "";
}

/** Short command recorder built on MediaRecorder. Audio stays in memory only. */
export function useRecorder(opts: { maxMs?: number; onComplete: (blob: Blob, durationMs: number) => void }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const onComplete = useRef(opts.onComplete);
  onComplete.current = opts.onComplete;
  const maxMs = opts.maxMs ?? 20_000;

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state === "recording") rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      setError("This browser can't record audio. Type your command instead.");
      return;
    }
    setState("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("error");
      setError("Microphone permission was denied.");
      return;
    }
    const mime = pickMime();
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const duration = Date.now() - started.current;
      cleanup();
      const blob = new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" });
      chunks.current = [];
      if (duration < 400 || blob.size < 1000) {
        setState("idle");
        setError("That was too short — hold on a moment longer.");
        return;
      }
      setState("processing");
      onComplete.current(blob, duration);
    };
    rec.current = r;
    started.current = Date.now();
    setElapsed(0);
    r.start(250);
    setState("recording");
    timer.current = setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= maxMs) stop();
    }, 200);
  }, [cleanup, maxMs, stop]);

  const reset = useCallback(() => setState("idle"), []);

  return { state, error, elapsed, start, stop, reset, setError };
}
