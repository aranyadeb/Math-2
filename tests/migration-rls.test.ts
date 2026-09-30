import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Applies the real migrations to an in-process PostgreSQL (PGlite) with
 * minimal stand-ins for Supabase's auth/storage schemas, then verifies RLS
 * isolates users and the ownership triggers reject forged book ids.
 */
const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;

async function as(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  await db.exec(`
    grant usage on schema public, auth, storage to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant execute on all functions in schema auth, storage to authenticated;
    insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  `);
}, 60_000);

describe("migrations + RLS", () => {
  it("new users get a profile and preferences row", async () => {
    const r = await db.query<{ n: number }>("select count(*)::int as n from public.profiles");
    expect(r.rows[0].n).toBe(2);
    const p = await db.query<{ n: number }>("select count(*)::int as n from public.user_preferences");
    expect(p.rows[0].n).toBe(2);
  });

  it("isolates books, pages and sessions between users", async () => {
    const book = await as(A, "insert into public.books (title) values ('Cengage Calculus') returning id, user_id");
    const bookId = (book.rows[0] as { id: string; user_id: string }).id;
    expect((book.rows[0] as { user_id: string }).user_id).toBe(A); // default auth.uid()
    await as(A, "insert into public.book_pages (book_id, pdf_page_index, page_label, storage_path) values ($1, 187, '4.33', 'x')", [bookId]);

    expect((await as(B, "select * from public.books")).rows).toHaveLength(0);
    expect((await as(B, "select * from public.book_pages")).rows).toHaveLength(0);
    expect((await as(A, "select page_label from public.book_pages")).rows).toEqual([{ page_label: "4.33" }]);

    const upd = await as(B, "update public.books set title = 'hacked' where id = $1", [bookId]);
    expect(upd.affectedRows ?? 0).toBe(0);
    const del = await as(B, "delete from public.books where id = $1", [bookId]);
    expect(del.affectedRows ?? 0).toBe(0);
  });

  it("rejects rows claiming another user's id or attaching to another user's book", async () => {
    await expect(as(B, "insert into public.books (user_id, title) values ($1, 'x')", [A])).rejects.toThrow();
    const bookId = ((await as(A, "select id from public.books limit 1")).rows[0] as { id: string }).id;
    await expect(as(B, "insert into public.book_pages (book_id, pdf_page_index, storage_path) values ($1, 1, 'y')", [bookId])).rejects.toThrow();
    await expect(as(B, "insert into public.question_cache (book_id, book_page_id, question_label) select $1, id, '22' from public.book_pages limit 1", [bookId])).resolves.toBeDefined(); // sees no pages → inserts nothing
  });

  it("active book preference cannot point at another user's book", async () => {
    const bookId = ((await as(A, "select id from public.books limit 1")).rows[0] as { id: string }).id;
    await as(A, "update public.user_preferences set active_book_id = $1", [bookId]);
    await expect(as(B, "update public.user_preferences set active_book_id = $1", [bookId])).rejects.toThrow();
  });

  it("labels are text: '4.30' is preserved and not equal to '4.3'", async () => {
    const bookId = ((await as(A, "select id from public.books limit 1")).rows[0] as { id: string }).id;
    await as(A, "insert into public.book_pages (book_id, pdf_page_index, page_label, storage_path) values ($1, 184, '4.30', 'z')", [bookId]);
    const r = await as(A, "select pdf_page_index from public.book_pages where book_id = $1 and page_label = '4.3'", [bookId]);
    expect(r.rows).toHaveLength(0);
    const r2 = await as(A, "select pdf_page_index from public.book_pages where book_id = $1 and page_label = '4.30'", [bookId]);
    expect(r2.rows).toEqual([{ pdf_page_index: 184 }]);
  });

  it("graph sessions are searchable and private", async () => {
    const page = (await as(A, "select id, book_id from public.book_pages where page_label = '4.33'")).rows[0] as { id: string; book_id: string };
    await as(A, `insert into public.graph_sessions (book_id, book_page_id, page_label, question_label, original_user_query, model_used, graph_document, ai_explanation)
                 values ($1, $2, '4.33', '22', 'show every useful graph', 'm', '{"version":1}', 'The derivative shows stationary points')`, [page.book_id, page.id]);
    const hit = await as(A, "select page_label from public.graph_sessions where search_text @@ websearch_to_tsquery('simple', 'derivative')");
    expect(hit.rows).toHaveLength(1);
    expect((await as(B, "select * from public.graph_sessions")).rows).toHaveLength(0);
    const sid = ((await as(A, "select id from public.graph_sessions")).rows[0] as { id: string }).id;
    await expect(as(B, "insert into public.graph_messages (graph_session_id, role, content) values ($1, 'user', 'hi')", [sid])).rejects.toThrow();
  });

  it("storage policies restrict objects to the owner's folder in private buckets", async () => {
    const buckets = await db.query<{ id: string; public: boolean }>("select id, public from storage.buckets order by id");
    expect(buckets.rows.every((b) => b.public === false)).toBe(true);
    expect(buckets.rows.map((b) => b.id)).toEqual(["book-pages", "graph-previews", "question-crops"]);
    await as(A, "insert into storage.objects (bucket_id, name) values ('book-pages', $1)", [`${A}/book/pages/00001.webp`]);
    await expect(as(A, "insert into storage.objects (bucket_id, name) values ('book-pages', $1)", [`${B}/book/pages/00001.webp`])).rejects.toThrow();
    expect((await as(B, "select * from storage.objects")).rows).toHaveLength(0);
    expect((await as(A, "select * from storage.objects")).rows).toHaveLength(1);
  });
});
