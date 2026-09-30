"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/supabase/storage";
import type { GraphDocument, GraphObject, GroupId } from "@/lib/graph/schema";
import { mergeLiveState, restoreGraphDocument } from "@/lib/graph/serializer";
import { applyPatch, dependentsOf } from "@/lib/graph/validation";
import type { BookPageRow, BookRow, GraphMessageRow, GraphSessionRow, QuestionCacheRow } from "@/lib/supabase/types";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { usePrefersDark } from "@/hooks/use-prefers-dark";
import { CommandBar } from "../command/command-bar";
import { Button, Card, Notice, Spinner, cx } from "../ui/primitives";
import { GraphBoard, type BoardApi } from "./graph-board";
import { ObjectPanel } from "./object-panel";
import { SliderPanel } from "./slider-panel";
import { ExpressionEditor } from "./expression-editor";

type Tab = GroupId | "explanation";
const TABS: { id: Tab; label: string }[] = [
  { id: "essential", label: "Essential" },
  { id: "supporting", label: "Supporting" },
  { id: "exploration", label: "Explore" },
  { id: "explanation", label: "Explanation" },
];
const SAVE_DELAY = 1000;

/** Structure key excludes live values (slider value, viewport) so dragging/sliding never rebuilds the board. */
function structureKeyOf(doc: GraphDocument): string {
  return JSON.stringify({ o: doc.objects.map((o) => (o.type === "slider" ? { ...o, value: 0 } : o)), g: doc.groups });
}

export function GraphWorkspace({ sessionId }: { sessionId: string }) {
  const sb = getBrowserSupabase();
  const [session, setSession] = useState<GraphSessionRow | null>(null);
  const [book, setBook] = useState<BookRow | null>(null);
  const [page, setPage] = useState<BookPageRow | null>(null);
  const [question, setQuestion] = useState<QuestionCacheRow | null>(null);
  const [messages, setMessages] = useState<GraphMessageRow[]>([]);
  const [doc, setDoc] = useState<GraphDocument | null>(null);
  const [params, setParams] = useState<Record<string, number>>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("essential");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [showPage, setShowPage] = useState(false);
  const dark = usePrefersDark();
  const boardApi = useRef<BoardApi | null>(null);

  // Live state not reflected in structure (viewport, dragged bounds) — merged at save time.
  const live = useRef<{ viewport?: GraphDocument["viewport"]; objectChanges: Record<string, Record<string, unknown>> }>({ objectChanges: {} });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<GraphDocument | null>(null);
  docRef.current = doc;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const load = useCallback(async () => {
    const { data, error } = await sb.from("graph_sessions").select("*").eq("id", sessionId).maybeSingle();
    if (error || !data) { setLoadError(error?.message ?? "This graph could not be found."); return; }
    const s = data as GraphSessionRow;
    let d: GraphDocument;
    try { d = restoreGraphDocument(s.graph_document); } catch (e) { setLoadError(`Saved graph is invalid: ${(e as Error).message}`); return; }
    setSession(s);
    setDoc(d);
    setParams(Object.fromEntries(d.objects.filter((o) => o.type === "slider").map((o) => [(o as Extract<GraphObject, { type: "slider" }>).name, (o as Extract<GraphObject, { type: "slider" }>).value])));
    live.current = { objectChanges: {} };
    const [b, p, q, m] = await Promise.all([
      sb.from("books").select("*").eq("id", s.book_id).maybeSingle(),
      sb.from("book_pages").select("*").eq("id", s.book_page_id).maybeSingle(),
      s.question_cache_id ? sb.from("question_cache").select("*").eq("id", s.question_cache_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("graph_messages").select("*").eq("graph_session_id", s.id).order("created_at"),
    ]);
    setBook(b.data as BookRow | null);
    setPage(p.data as BookPageRow | null);
    setQuestion(q.data as QuestionCacheRow | null);
    setMessages((m.data ?? []) as GraphMessageRow[]);
    sb.from("graph_sessions").update({ last_opened_at: new Date().toISOString() }).eq("id", s.id).then(() => {});
  }, [sb, sessionId]);

  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    const merged = mergeLiveState(d, { viewport: live.current.viewport, params: paramsRef.current, objectChanges: live.current.objectChanges });
    setSaveState("saving");
    const { error } = await sb.from("graph_sessions").update({ graph_document: merged }).eq("id", sessionId);
    setSaveState(error ? "error" : "saved");
  }, [sb, sessionId]);

  const scheduleSave = useCallback(() => {
    setSaveState("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  // Save on tab close / navigation
  useEffect(() => {
    const onHide = () => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; flush(); } };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide); onHide(); };
  }, [flush]);

  /** Structural change: merge pending live state first so nothing is lost. */
  const mutate = useCallback((fn: (d: GraphDocument) => GraphDocument) => {
    setDoc((cur) => {
      if (!cur) return cur;
      const base = mergeLiveState(cur, { viewport: live.current.viewport, params: paramsRef.current, objectChanges: live.current.objectChanges });
      live.current.objectChanges = {};
      return fn(base);
    });
    scheduleSave();
  }, [scheduleSave]);

  const structureKey = useMemo(() => (doc ? structureKeyOf(doc) : ""), [doc]);

  const onToggle = (id: string, visible: boolean) => mutate((d) => applyPatch(d, { operations: [{ op: "set_visibility", id, visible }] }));
  const onRemove = (id: string) => mutate((d) => {
    const ids = [id, ...dependentsOf(d, id)];
    return applyPatch(d, { operations: ids.map((x) => ({ op: "remove" as const, id: x })) }, { allowUserChanges: true });
  });
  const onAdd = (o: GraphObject) => {
    mutate((d) => applyPatch(d, { operations: [{ op: "add", object: o }] }, { allowUserChanges: true }));
    setTab("exploration");
  };
  const onGroupToggle = (g: GroupId, visible: boolean) => mutate((d) => applyPatch(d, { operations: [{ op: "set_group_visibility", group: g, visible }] }));

  const onFollowUp = useCallback(async () => {
    // Follow-up was applied and saved server-side: flush local state first, then reload.
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    await load();
  }, [load]);

  if (loadError) return <div className="mx-auto max-w-xl p-4"><Notice tone="error">{loadError}</Notice><Link href="/history" className="mt-3 inline-block text-sm text-accent">Back to history</Link></div>;
  if (!session || !doc) return <div className="flex h-[60vh] items-center justify-center text-muted"><Spinner /></div>;

  const explanation = session.ai_explanation ?? "";
  const lastNotes = messages.filter((m) => m.role === "assistant").map((m) => (m.structured_payload as { notes?: string[] } | null)?.notes ?? []).flat();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 p-3 sm:p-4 lg:h-[calc(100dvh-3.5rem)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">
          {book?.title ? <span className="text-muted">{book.title} · </span> : null}
          Page {session.page_label}{session.question_label ? ` · Q${session.question_label}` : ""}
          {session.exercise_label ? <span className="text-sm font-normal text-muted"> ({session.exercise_label})</span> : null}
        </h1>
        <span className="text-xs text-muted" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "pending" ? "Unsaved changes" : saveState === "error" ? "Save failed — will retry on next change" : "Saved"}
        </span>
      </div>
      <p className="-mt-2 text-sm italic text-muted">“{session.transcript ?? session.original_user_query}”</p>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(280px,2fr)_minmax(0,3fr)]">
        {/* Question / page */}
        <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
            <span className="font-medium">{showPage ? "Textbook page" : "Question"}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setShowPage((v) => !v)}>{showPage ? "Show question" : "Show page"}</Button>
              {page ? <Link className="inline-flex h-8 items-center rounded-lg px-2 text-sm text-accent hover:bg-surface-2" href={`/books/${session.book_id}/page/${page.id}${question ? `?edit=${question.id}` : ""}`}>Fix crop</Link> : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <QuestionView question={question} page={page} showPage={showPage} />
            {question?.question_text ? (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-muted">Extracted text</summary>
                <p className="mt-1 whitespace-pre-wrap font-mono text-xs">{question.question_text}</p>
              </details>
            ) : null}
          </div>
        </Card>

        {/* Graph + panels */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <Card className="relative h-[55vh] min-h-[320px] overflow-hidden lg:h-auto lg:flex-1">
            <GraphBoard
              doc={doc}
              structureKey={structureKey}
              params={params}
              dark={dark}
              apiRef={boardApi}
              onViewportChange={(vp) => { live.current.viewport = vp; scheduleSave(); }}
              onObjectChange={(id, ch) => { live.current.objectChanges[id] = { ...live.current.objectChanges[id], ...ch }; scheduleSave(); }}
              onWarnings={setWarnings}
            />
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <Button size="sm" aria-label="Zoom in" onClick={() => boardApi.current?.zoom(1.2)}>+</Button>
              <Button size="sm" aria-label="Zoom out" onClick={() => boardApi.current?.zoom(0.8)}>−</Button>
              <Button size="sm" aria-label="Reset view" onClick={() => boardApi.current?.reset()}>⟲</Button>
            </div>
          </Card>

          <Card className="flex min-h-0 min-w-0 flex-col lg:max-h-[42%]">
            <div role="tablist" aria-label="Graph groups" className="flex overflow-x-auto border-b border-border">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cx("whitespace-nowrap px-3 py-2 text-sm", tab === t.id ? "border-b-2 border-accent font-medium" : "text-muted hover:text-fg")}
                >
                  {t.label}
                  {t.id !== "explanation" ? <span className="ml-1 text-xs text-muted">{doc.objects.filter((o) => o.group === t.id && o.type !== "slider").length}</span> : null}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="min-h-0 flex-1 overflow-auto px-3 py-2">
              {tab === "explanation" ? (
                <div className="space-y-3 text-sm leading-relaxed">
                  {session.question_summary ? <p className="font-medium">{session.question_summary}</p> : null}
                  {explanation ? <p className="whitespace-pre-wrap">{explanation}</p> : <p className="text-muted">No explanation yet.</p>}
                  {session.ai_solution ? (<><h3 className="font-semibold">Solution</h3><p className="whitespace-pre-wrap">{session.ai_solution}</p></>) : null}
                  {lastNotes.length ? <Notice tone="warn">{lastNotes.join(" · ")}</Notice> : null}
                  <p className="text-xs text-muted">Model: {session.model_used}{session.fallback_reason ? ` (escalated: ${session.fallback_reason})` : ""}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={doc.groups.find((g) => g.id === tab)?.visible ?? true} onChange={(e) => onGroupToggle(tab as GroupId, e.target.checked)} />
                    Show this group
                  </label>
                  {tab === "exploration" ? <SliderPanel doc={doc} params={params} onChange={(name, v) => { setParams((p) => ({ ...p, [name]: v })); scheduleSave(); }} /> : null}
                  <ObjectPanel doc={doc} group={tab as GroupId} warnings={warnings} onToggle={onToggle} onRemove={onRemove} />
                  {tab === "exploration" ? <ExpressionEditor doc={doc} onAdd={onAdd} /> : null}
                </div>
              )}
            </div>
          </Card>
          {tab !== "exploration" && doc.objects.some((o) => o.type === "slider") ? (
            <Card className="p-3 lg:hidden"><SliderPanel doc={doc} params={params} onChange={(name, v) => { setParams((p) => ({ ...p, [name]: v })); scheduleSave(); }} /></Card>
          ) : null}
        </div>
      </div>

      {messages.length > 2 ? <Card className="p-3"><Conversation messages={messages.slice(2)} /></Card> : null}
      {/* On phones the command bar sticks above the tab bar so the mic is always reachable. */}
      <div className="sticky bottom-16 z-20 rounded-xl border border-border bg-surface p-3 shadow-lg sm:static sm:bottom-auto sm:shadow-none">
        <CommandBar variant="inline" graphSessionId={session.id} onFollowUp={onFollowUp} placeholder="Show the derivative too · Add tangent at x = 2" />
      </div>
    </div>
  );
}

function Conversation({ messages }: { messages: GraphMessageRow[] }) {
  if (!messages.length) return null;
  return (
    <ul className="max-h-60 space-y-2 overflow-auto text-sm" aria-label="Conversation">
      {messages.map((m) => (
        <li key={m.id} className={cx("rounded-lg px-3 py-2", m.role === "user" ? "ml-8 bg-surface-2" : "mr-8 border border-border")}>
          <p className="whitespace-pre-wrap">{m.content}</p>
        </li>
      ))}
    </ul>
  );
}

function QuestionView({ question, page, showPage }: { question: QuestionCacheRow | null; page: BookPageRow | null; showPage: boolean }) {
  const crop = useSignedUrl(BUCKETS.crops, !showPage ? question?.question_image_path : null);
  const full = useSignedUrl(BUCKETS.pages, showPage || !question?.question_image_path ? page?.storage_path : null);
  const url = !showPage && question?.question_image_path ? crop.url : full.url;
  if (!url) return <div className="flex h-40 items-center justify-center text-muted"><Spinner /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={showPage ? "Textbook page" : "Question"} className="mx-auto w-full max-w-2xl rounded bg-white" />;
}
