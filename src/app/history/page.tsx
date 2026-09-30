"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/layout/app-state";
import { GraphPreview } from "@/components/graph/graph-preview";
import { Button, Card, Input, Select, Spinner } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { restoreGraphDocument } from "@/lib/graph/serializer";
import type { GraphSessionRow } from "@/lib/supabase/types";

const PAGE = 24;

/** Turn free text into filters: "4.33 q22" → page/question filters; the rest → full-text search. */
function parseQuery(q: string) {
  let rest = q.trim();
  let page: string | null = null, question: string | null = null, exercise: string | null = null;
  const qm = /\b(?:q|question)\s*([0-9]+[a-z]?)\b/i.exec(rest);
  if (qm) { question = qm[1].toLowerCase(); rest = rest.replace(qm[0], " "); }
  const em = /\bexercise\s+([0-9a-z.]+)\b/i.exec(rest);
  if (em) { exercise = em[1]; rest = rest.replace(em[0], " "); }
  const pm = /\b(?:page\s+)?([0-9]+(?:[.\-][0-9]+)+|[0-9]+)\b/i.exec(rest);
  if (pm) { page = pm[1]; rest = rest.replace(pm[0], " "); }
  return { page, question, exercise, text: rest.replace(/\s+/g, " ").trim() };
}

export default function HistoryPage() {
  const { books } = useApp();
  const [query, setQuery] = useState("");
  const [bookId, setBookId] = useState<string>("");
  const [rows, setRows] = useState<GraphSessionRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(async () => {
      const sb = getBrowserSupabase();
      const f = parseQuery(query);
      let q = sb.from("graph_sessions")
        .select("id,book_id,page_label,question_label,exercise_label,original_user_query,transcript,graph_document,question_summary,created_at,last_opened_at")
        .order("last_opened_at", { ascending: false })
        .range(offset, offset + PAGE);
      if (bookId) q = q.eq("book_id", bookId);
      if (f.page) q = q.eq("page_label", f.page);
      if (f.question) q = q.eq("question_label", f.question);
      if (f.exercise) q = q.ilike("exercise_label", `%${f.exercise.replace(/[%_]/g, "")}%`);
      if (f.text) q = q.textSearch("search_text", f.text, { type: "websearch", config: "simple" });
      const { data } = await q;
      const list = (data ?? []) as GraphSessionRow[];
      setMore(list.length > PAGE);
      setRows((prev) => (offset === 0 ? list.slice(0, PAGE) : [...(prev ?? []), ...list.slice(0, PAGE)]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, bookId, offset]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">History</h1>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="hs">Search history</label>
        <Input id="hs" value={query} onChange={(e) => { setOffset(0); setQuery(e.target.value); }} placeholder="Search: 4.33 Q22, derivative, exercise 4.3…" />
        {books.length > 1 ? (
          <Select aria-label="Filter by book" value={bookId} onChange={(e) => { setOffset(0); setBookId(e.target.value); }}>
            <option value="">All books</option>
            {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </Select>
        ) : null}
      </div>
      {rows === null ? <Spinner /> : rows.length === 0 ? <p className="text-sm text-muted">No graphs found.</p> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            let doc = null;
            try { doc = restoreGraphDocument(r.graph_document); } catch { /* old/invalid document */ }
            const d = new Date(r.created_at);
            return (
              <li key={r.id}>
                <Link href={`/graph/${r.id}`} className="block">
                  <Card className="overflow-hidden transition hover:border-accent">
                    <div className="h-28 bg-[var(--board-bg)] text-muted">{doc ? <GraphPreview doc={doc} className="h-full w-full" /> : null}</div>
                    <div className="space-y-0.5 p-3">
                      <p className="text-xs text-muted">{books.find((b) => b.id === r.book_id)?.title ?? "Book"}</p>
                      <p className="font-medium">Page {r.page_label}{r.question_label ? ` · Q${r.question_label}` : ""}</p>
                      <p className="line-clamp-2 text-sm italic text-muted">“{r.transcript ?? r.original_user_query}”</p>
                      <p className="text-xs text-muted">{d.toLocaleDateString(undefined, { day: "numeric", month: "long" })} · {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {more ? <Button onClick={() => setOffset((o) => o + PAGE)}>Load more</Button> : null}
    </div>
  );
}
