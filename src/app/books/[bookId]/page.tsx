"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/layout/app-state";
import { Button, Card, Notice, Spinner } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/supabase/storage";
import { formatBytes } from "@/lib/books/image-compression";
import type { BookRow } from "@/lib/supabase/types";

export default function BookDetail({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const router = useRouter();
  const { refreshBooks, setActiveBook, activeBook } = useApp();
  const [book, setBook] = useState<BookRow | null>(null);
  const [stats, setStats] = useState<{ uploaded: number; mapped: number; questions: number; sessions: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const sb = getBrowserSupabase();
    (async () => {
      const { data } = await sb.from("books").select("*").eq("id", bookId).maybeSingle();
      if (!data) return setError("Book not found");
      setBook(data as BookRow);
      const head = { count: "exact" as const, head: true };
      const [a, b, c, d] = await Promise.all([
        sb.from("book_pages").select("id", head).eq("book_id", bookId).eq("upload_status", "uploaded"),
        sb.from("book_pages").select("id", head).eq("book_id", bookId).not("page_label", "is", null),
        sb.from("question_cache").select("id", head).eq("book_id", bookId),
        sb.from("graph_sessions").select("id", head).eq("book_id", bookId),
      ]);
      const [uploaded, mapped, questions, sessions] = [a.count ?? 0, b.count ?? 0, c.count ?? 0, d.count ?? 0];
      setStats({ uploaded, mapped, questions, sessions });
    })();
  }, [bookId]);

  const remove = async () => {
    if (!book || !confirm(`Delete “${book.title}” and all its pages, questions and graphs? This cannot be undone.`)) return;
    setDeleting(true);
    const sb = getBrowserSupabase();
    // Remove stored images (paths are under <user>/<book>/...) in batches, then the rows (cascade).
    const { data: rows } = await sb.from("book_pages").select("storage_path,thumbnail_path").eq("book_id", bookId);
    const paths = (rows ?? []).flatMap((r) => [r.storage_path, r.thumbnail_path].filter(Boolean) as string[]);
    for (let i = 0; i < paths.length; i += 500) await sb.storage.from(BUCKETS.pages).remove(paths.slice(i, i + 500));
    const { data: qs } = await sb.from("question_cache").select("question_image_path").eq("book_id", bookId);
    const qp = (qs ?? []).map((q) => q.question_image_path).filter(Boolean) as string[];
    if (qp.length) await sb.storage.from(BUCKETS.crops).remove(qp);
    const { error } = await sb.from("books").delete().eq("id", bookId);
    if (error) { setDeleting(false); return setError(error.message); }
    if (activeBook?.id === bookId) await setActiveBook(null);
    await refreshBooks();
    router.push("/books");
  };

  if (error) return <div className="mx-auto max-w-xl p-4"><Notice tone="error">{error}</Notice></div>;
  if (!book) return <div className="flex h-[50vh] items-center justify-center"><Spinner /></div>;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">{book.title}</h1>
        <p className="text-sm text-muted">{[book.author, book.edition, book.subject].filter(Boolean).join(" · ")}</p>
      </div>
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="PDF pages" value={book.pdf_page_count} />
        <Stat label="Uploaded" value={stats ? `${stats.uploaded}` : "…"} sub={formatBytes(book.uploaded_bytes)} />
        <Stat label="Pages labelled" value={stats ? stats.mapped : "…"} />
        <Stat label="Graphs" value={stats ? stats.sessions : "…"} sub={stats ? `${stats.questions} questions cached` : undefined} />
      </Card>
      <div className="flex flex-wrap gap-2">
        <Link href={`/books/${bookId}/import`}><Button variant={book.ingestion_status === "complete" ? "secondary" : "primary"}>{book.ingestion_status === "complete" ? "Re-check import" : "Continue import"}</Button></Link>
        <Link href={`/books/${bookId}/mapping`}><Button variant={book.ingestion_status === "complete" && book.page_mapping_status !== "complete" ? "primary" : "secondary"}>Page mapping</Button></Link>
        {activeBook?.id !== bookId ? <Button onClick={() => setActiveBook(bookId)}>Make active</Button> : null}
        <Button variant="danger" className="ml-auto" onClick={remove} disabled={deleting}>{deleting ? <Spinner /> : null} Delete book</Button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
    </div>
  );
}
