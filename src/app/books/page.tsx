"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/layout/app-state";
import { Button, Card, Input, Label, Notice, Spinner } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { closePdf, openPdf } from "@/lib/books/ingestion";
import { setPendingFile } from "@/lib/books/pending-file";
import { estimateStorageBytes, formatBytes } from "@/lib/books/image-compression";

export default function BooksPage() {
  const { books, user, refreshBooks, setActiveBook, activeBook } = useApp();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [edition, setEdition] = useState("");
  const [subject, setSubject] = useState("Mathematics");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (f: File | null) => {
    setFile(f);
    setPages(null);
    setError(null);
    if (!f) return;
    if (!title) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
    try {
      const pdf = await openPdf(f);
      setPages(pdf.numPages);
      closePdf(pdf);
    } catch (e) {
      setError(`Could not read this PDF: ${(e as Error).message}`);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !pages || !user) return;
    setBusy(true);
    const { data, error } = await getBrowserSupabase()
      .from("books")
      .insert({ user_id: user.id, title: title.trim(), author: author.trim() || null, edition: edition.trim() || null, subject: subject.trim() || null, source_filename: file.name, source_size_bytes: file.size, pdf_page_count: pages })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) return setError(error?.message ?? "Could not create book");
    setPendingFile(data.id, file);
    await refreshBooks();
    await setActiveBook(data.id);
    router.push(`/books/${data.id}/import`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">Books</h1>
      {books.length ? (
        <Card>
          <ul className="divide-y divide-border">
            {books.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/books/${b.id}`} className="font-medium hover:underline">{b.title}</Link>
                  <p className="text-xs text-muted">
                    {b.pdf_page_count} pages · {formatBytes(b.uploaded_bytes)} · import {b.ingestion_status.replace("_", " ")} · mapping {b.page_mapping_status.replace("_", " ")}
                  </p>
                </div>
                {activeBook?.id === b.id ? <span className="text-xs text-ok">Active</span> : <Button size="sm" onClick={() => setActiveBook(b.id)}>Make active</Button>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Add a book</h2>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="pdf">Scanned PDF</Label>
            <input id="pdf" type="file" accept="application/pdf" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm" />
            <p className="mt-1 text-xs text-muted">The PDF is processed in your browser; only compressed page images go to your private storage.</p>
            {file && pages === null && !error ? <p className="mt-1 text-xs text-muted"><Spinner className="size-3" /> Reading PDF…</p> : null}
            {pages ? <p className="mt-1 text-xs text-muted">{pages} pages · estimated cloud storage ≈ {formatBytes(estimateStorageBytes(pages, "balanced"))} (Balanced)</p> : null}
          </div>
          <div className="sm:col-span-2"><Label htmlFor="title">Title</Label><Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cengage Calculus" /></div>
          <div><Label htmlFor="author">Author</Label><Input id="author" value={author} onChange={(e) => setAuthor(e.target.value)} /></div>
          <div><Label htmlFor="edition">Edition</Label><Input id="edition" value={edition} onChange={(e) => setEdition(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="subject">Subject</Label><Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={!file || !pages || !title.trim() || busy}>{busy ? <Spinner /> : null} Continue to import</Button>
          </div>
        </form>
        {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      </Card>
    </div>
  );
}
