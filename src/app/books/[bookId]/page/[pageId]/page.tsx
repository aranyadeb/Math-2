"use client";
import Link from "next/link";
import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BBoxEditor } from "@/components/books/bbox-editor";
import { useCommand, postJSON } from "@/components/command/use-command";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui/primitives";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/supabase/storage";
import type { BBox, BookPageRow, QuestionCacheRow } from "@/lib/supabase/types";

function PageViewer({ bookId, pageId }: { bookId: string; pageId: string }) {
  const sb = getBrowserSupabase();
  const router = useRouter();
  const sp = useSearchParams();
  const cmdText = sp.get("cmd");
  const [page, setPage] = useState<BookPageRow | null>(null);
  const [nav, setNav] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  const [questions, setQuestions] = useState<QuestionCacheRow[]>([]);
  const [editing, setEditing] = useState<QuestionCacheRow | null>(null);
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [qLabel, setQLabel] = useState(sp.get("q") ?? "");
  const [exercise, setExercise] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const img = useSignedUrl(BUCKETS.pages, page?.storage_path);
  const cmd = useCommand();

  const load = useCallback(async () => {
    const { data } = await sb.from("book_pages").select("*").eq("id", pageId).maybeSingle();
    const p = data as BookPageRow | null;
    setPage(p);
    if (!p) return;
    const [{ data: qs }, { data: prev }, { data: next }] = await Promise.all([
      sb.from("question_cache").select("*").eq("book_page_id", pageId).order("question_label"),
      sb.from("book_pages").select("id").eq("book_id", bookId).eq("pdf_page_index", p.pdf_page_index - 1).maybeSingle(),
      sb.from("book_pages").select("id").eq("book_id", bookId).eq("pdf_page_index", p.pdf_page_index + 1).maybeSingle(),
    ]);
    const list = (qs ?? []) as QuestionCacheRow[];
    setQuestions(list);
    setNav({ prev: (prev as { id: string } | null)?.id ?? null, next: (next as { id: string } | null)?.id ?? null });
    const editId = sp.get("edit");
    const e = editId ? list.find((q) => q.id === editId) : null;
    if (e) { setEditing(e); setBBox(e.bbox); setQLabel(e.question_label); setExercise(e.exercise_label ?? ""); }
  }, [sb, pageId, bookId, sp]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!bbox || !page) return;
    setBusy(true);
    setError(null);
    try {
      let q: QuestionCacheRow;
      if (editing) {
        q = (await fetch(`/api/questions/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "correct", bbox }) }).then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          return d;
        })).question;
      } else {
        if (!qLabel.trim()) throw new Error("Enter the question number.");
        q = (await postJSON<{ question: QuestionCacheRow }>("/api/questions", { bookPageId: page.id, questionLabel: qLabel.trim(), exerciseLabel: exercise.trim() || null, bbox })).question;
      }
      setSaved(`Saved question ${q.question_label}. This box will be reused from now on.`);
      await load();
      if (cmdText) await cmd.run({ text: cmdText, bookId, resolvedPageId: page.id, questionCacheId: q.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!editing || !confirm("Forget this box? The AI will detect the question again next time.")) return;
    await fetch(`/api/questions/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
    setEditing(null);
    setBBox(null);
    load();
  };

  if (!page) return <div className="flex h-[50vh] items-center justify-center"><Spinner /></div>;
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/books/${bookId}/mapping`} className="text-sm text-accent">← Mapping</Link>
        <h1 className="text-lg font-semibold">Page {page.page_label ?? "—"} <span className="text-sm font-normal text-muted">(PDF {page.pdf_page_index})</span></h1>
        <div className="ml-auto flex gap-1">
          <Button size="sm" disabled={!nav.prev} onClick={() => nav.prev && router.push(`/books/${bookId}/page/${nav.prev}`)}>‹ Prev</Button>
          <Button size="sm" disabled={!nav.next} onClick={() => nav.next && router.push(`/books/${bookId}/page/${nav.next}`)}>Next ›</Button>
        </div>
      </div>
      {sp.get("msg") ? <Notice tone="warn">{sp.get("msg")}</Notice> : null}

      <Card className="space-y-3 p-3">
        <p className="text-sm text-muted">
          {editing ? `Adjust the box for Q${editing.question_label}${editing.exercise_label ? ` (${editing.exercise_label})` : ""}.` : "Drag on the page to draw a box around a question. Tap a blue box to edit it."}
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <div><Label htmlFor="ql">Question</Label><Input id="ql" value={qLabel} disabled={!!editing} onChange={(e) => setQLabel(e.target.value)} placeholder="22" /></div>
          <div><Label htmlFor="ex">Exercise (optional)</Label><Input id="ex" value={exercise} disabled={!!editing} onChange={(e) => setExercise(e.target.value)} placeholder="Exercise 4.3" /></div>
          <Button className="self-end" variant="primary" disabled={!bbox || busy || cmd.busy} onClick={save}>{busy || cmd.busy ? <Spinner /> : null}{cmdText ? "Save & graph" : "Save box"}</Button>
          {editing ? <Button className="self-end" onClick={reset}>Reset</Button> : null}
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {cmd.error ? <Notice tone="error">{cmd.error}</Notice> : null}
        {saved ? <Notice tone="ok">{saved}</Notice> : null}
      </Card>

      {img.url ? (
        <BBoxEditor
          src={img.url}
          alt={`Textbook page ${page.page_label ?? page.pdf_page_index}`}
          value={bbox}
          onChange={setBBox}
          others={questions.filter((q) => q.id !== editing?.id && q.bbox).map((q) => ({
            bbox: q.bbox!, label: `Q${q.question_label}${q.manually_corrected ? " ✓" : ""}`,
            onClick: () => { setEditing(q); setBBox(q.bbox); setQLabel(q.question_label); setExercise(q.exercise_label ?? ""); },
          }))}
        />
      ) : img.error ? <Notice tone="error">{img.error}</Notice> : <div className="flex h-64 items-center justify-center"><Spinner /></div>}
    </div>
  );
}

export default function PageRoute({ params }: { params: Promise<{ bookId: string; pageId: string }> }) {
  const { bookId, pageId } = use(params);
  return <Suspense><PageViewer bookId={bookId} pageId={pageId} /></Suspense>;
}
