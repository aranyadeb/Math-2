"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app-state";
import { cx } from "../ui/primitives";

export function BookSelector({ className }: { className?: string }) {
  const { books, activeBook, setActiveBook } = useApp();
  if (!books.length) {
    return <Link href="/books" className={cx("text-sm font-medium text-accent", className)}>Add a book</Link>;
  }
  return (
    <label className={cx("relative inline-flex items-center", className)}>
      <span className="sr-only">Active book</span>
      <select
        value={activeBook?.id ?? ""}
        onChange={(e) => setActiveBook(e.target.value)}
        className="max-w-[60vw] appearance-none truncate rounded-lg bg-transparent py-1 pl-2 pr-7 text-base font-semibold text-fg hover:bg-surface-2 sm:max-w-xs"
      >
        {books.map((b) => (
          <option key={b.id} value={b.id}>{b.title}</option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2 text-xs text-muted">▼</span>
    </label>
  );
}

const NAV = [
  { href: "/", label: "Ask" },
  { href: "/books", label: "Books" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export function Header() {
  const path = usePathname();
  const { user } = useApp();
  if (!user || path.startsWith("/login") || path.startsWith("/setup")) return null;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-4">
        <BookSelector />
        <nav aria-label="Main" className="ml-auto flex items-center gap-1">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx("rounded-lg px-2.5 py-1.5 text-sm", active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
