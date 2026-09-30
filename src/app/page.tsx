"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CommandBar } from "@/components/command/command-bar";
import { useApp } from "@/components/layout/app-state";
import { Card, Notice, Spinner } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";

interface Recent { id: string; page_label: string; question_label: string | null; original_user_query: string; book_id: string }

export default function Dashboard() {
  const { activeBook, books, loading } = useApp();
  const [recent, setRecent] = useState<Recent[] | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .from("graph_sessions")
      .select("id,page_label,question_label,original_user_query,book_id")
      .order("last_opened_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setRecent((data ?? []) as Recent[]));
  }, []);

  if (loading) return <div className="flex h-[60vh] items-center justify-center text-muted"><Spinner /></div>;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      {!books.length ? (
        <Notice>
          No books yet. <Link href="/books" className="font-medium text-accent">Upload your first textbook</Link> — it&apos;s prepared once, then every question is a tap away.
        </Notice>
      ) : activeBook && activeBook.ingestion_status !== "complete" ? (
        <Notice tone="warn">
          {activeBook.title} is still being prepared. <Link href={`/books/${activeBook.id}/import`} className="font-medium text-accent">Continue import</Link>
        </Notice>
      ) : activeBook && !["complete", "needs_review"].includes(activeBook.page_mapping_status) ? (
        <Notice tone="warn">
          Page numbers for {activeBook.title} aren&apos;t mapped yet. <Link href={`/books/${activeBook.id}/mapping`} className="font-medium text-accent">Map pages</Link>
        </Notice>
      ) : null}

      <section aria-label="Ask" className="py-6">
        <CommandBar variant="hero" />
        <p className="mt-2 text-center text-xs text-muted">Try “Page 4.33, question 22. Show me every useful graph.”</p>
      </section>

      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-2 text-sm font-semibold text-muted">Recent</h2>
        <Card>
          {recent === null ? (
            <div className="p-4 text-muted"><Spinner /></div>
          ) : recent.length === 0 ? (
            <p className="p-4 text-sm text-muted">Your graphs will appear here.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/graph/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <span className="font-mono text-sm font-medium">{r.page_label}{r.question_label ? ` · Q${r.question_label}` : ""}</span>
                    <span className="truncate text-sm text-muted">{r.original_user_query}</span>
                    {books.length > 1 ? <span className="ml-auto shrink-0 text-xs text-muted">{books.find((b) => b.id === r.book_id)?.title}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="mt-2 flex justify-between text-sm">
          <Link href="/history" className="text-accent">All history →</Link>
          <Link href="/lab" className="text-muted hover:text-fg">Graph lab (no book)</Link>
        </div>
      </section>
    </div>
  );
}
