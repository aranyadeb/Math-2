-- Initial schema for the math textbook graph application.
-- All user-owned tables have RLS enabled; every policy is scoped to auth.uid().

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- books
-- ---------------------------------------------------------------------------
create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  author text,
  edition text,
  subject text,
  source_filename text,
  source_size_bytes bigint,
  pdf_page_count integer not null default 0 check (pdf_page_count >= 0),
  ingestion_status text not null default 'pending'
    check (ingestion_status in ('pending','in_progress','paused','complete','failed')),
  page_mapping_status text not null default 'pending'
    check (page_mapping_status in ('pending','in_progress','needs_review','complete','failed')),
  image_quality text not null default 'balanced'
    check (image_quality in ('economy','balanced','high')),
  uploaded_bytes bigint not null default 0,
  cover_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz
);
create index books_user_idx on public.books(user_id, last_opened_at desc nulls last);

-- ---------------------------------------------------------------------------
-- book_pages : PDF index ≠ semantic label ≠ chapter ≠ section
-- ---------------------------------------------------------------------------
create table public.book_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  pdf_page_index integer not null check (pdf_page_index >= 1),
  page_label text,               -- semantic label, ALWAYS text ("4.33", "xiv", "233")
  chapter_label text,
  chapter_title text,
  section_label text,
  section_title text,
  storage_path text not null,
  thumbnail_path text,
  size_bytes integer,
  mapping_source text
    check (mapping_source is null or mapping_source in ('ai_visual','sequence_inferred','manual','imported')),
  mapping_confidence real check (mapping_confidence is null or (mapping_confidence >= 0 and mapping_confidence <= 1)),
  manually_verified boolean not null default false,
  upload_status text not null default 'pending'
    check (upload_status in ('pending','uploaded','failed')),
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, pdf_page_index)
);
create index book_pages_book_pdf_idx on public.book_pages(book_id, pdf_page_index);
create index book_pages_book_label_idx on public.book_pages(book_id, page_label);
create index book_pages_book_chapter_idx on public.book_pages(book_id, chapter_label);

-- ---------------------------------------------------------------------------
-- page_aliases
-- ---------------------------------------------------------------------------
create table public.page_aliases (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_page_id uuid not null references public.book_pages(id) on delete cascade,
  alias text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (book_id, alias)
);
create index page_aliases_book_idx on public.page_aliases(book_id, alias);

-- ---------------------------------------------------------------------------
-- question_cache (lazy)
-- ---------------------------------------------------------------------------
create table public.question_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  book_page_id uuid not null references public.book_pages(id) on delete cascade,
  exercise_label text,
  question_label text not null,
  bbox jsonb,
  question_text text,
  question_image_path text,
  continues_to_next_page boolean not null default false,
  continuation_page_ids jsonb,
  continuation_bbox jsonb,
  confidence real,
  manually_corrected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index question_cache_lookup_idx on public.question_cache(book_page_id, question_label);
create unique index question_cache_unique_idx
  on public.question_cache(book_page_id, question_label, coalesce(exercise_label, ''));

-- ---------------------------------------------------------------------------
-- voice_queries (raw audio is never stored)
-- ---------------------------------------------------------------------------
create table public.voice_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  transcript text not null,
  parsed_command jsonb,
  duration_ms integer,
  transcription_model text,
  created_at timestamptz not null default now()
);
create index voice_queries_user_idx on public.voice_queries(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- graph_sessions
-- ---------------------------------------------------------------------------
create table public.graph_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  book_page_id uuid not null references public.book_pages(id) on delete cascade,
  question_cache_id uuid references public.question_cache(id) on delete set null,
  voice_query_id uuid references public.voice_queries(id) on delete set null,
  page_label text not null,
  question_label text,
  exercise_label text,
  original_user_query text not null,
  transcript text,
  model_used text not null,
  fallback_reason text,
  graph_document jsonb not null,
  ai_explanation text,
  ai_solution text,
  question_summary text,
  confidence real,
  search_text tsvector generated always as (
    to_tsvector('simple',
      coalesce(page_label,'') || ' ' || coalesce(question_label,'') || ' ' ||
      coalesce(exercise_label,'') || ' ' || coalesce(original_user_query,'') || ' ' ||
      coalesce(transcript,'') || ' ' || coalesce(ai_explanation,'') || ' ' ||
      coalesce(question_summary,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now()
);
create index graph_sessions_user_idx on public.graph_sessions(user_id, last_opened_at desc);
create index graph_sessions_book_idx on public.graph_sessions(book_id, page_label, question_label);
create index graph_sessions_search_idx on public.graph_sessions using gin(search_text);

-- ---------------------------------------------------------------------------
-- graph_messages
-- ---------------------------------------------------------------------------
create table public.graph_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  graph_session_id uuid not null references public.graph_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  structured_payload jsonb,
  created_at timestamptz not null default now()
);
create index graph_messages_session_idx on public.graph_messages(graph_session_id, created_at);

-- ---------------------------------------------------------------------------
-- user_preferences
-- ---------------------------------------------------------------------------
create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  active_book_id uuid references public.books(id) on delete set null,
  graph_preferences jsonb not null default '{}'::jsonb,
  voice_preferences jsonb not null default '{}'::jsonb,
  ui_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ai_usage : cost control
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  latency_ms integer,
  fallback boolean not null default false,
  fallback_reason text,
  success boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index ai_usage_user_idx on public.ai_usage(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

do $$
declare t text;
begin
  foreach t in array array['profiles','books','book_pages','question_cache','graph_sessions','user_preferences']
  loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['books','book_pages','page_aliases','question_cache','voice_queries',
                           'graph_sessions','graph_messages','user_preferences','ai_usage']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s_select_own" on public.%I for select using (user_id = auth.uid())', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert with check (user_id = auth.uid())', t, t);
    execute format('create policy "%s_update_own" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete using (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- Child rows must reference parents owned by the same user (prevents attaching
-- rows to someone else's book even with a forged book_id).
create or replace function public.assert_book_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.book_id is not null and not exists (
    select 1 from public.books b where b.id = new.book_id and b.user_id = new.user_id
  ) then
    raise exception 'book % not owned by user', new.book_id using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['book_pages','page_aliases','question_cache','voice_queries','graph_sessions']
  loop
    execute format('create trigger %I_book_owner before insert or update on public.%I for each row execute function public.assert_book_owner()', t, t);
  end loop;
end $$;

create or replace function public.assert_session_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.graph_sessions s where s.id = new.graph_session_id and s.user_id = new.user_id
  ) then
    raise exception 'session not owned by user' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger graph_messages_session_owner before insert or update on public.graph_messages
  for each row execute function public.assert_session_owner();

-- ---------------------------------------------------------------------------
-- Private storage buckets. Objects are stored under "<user_id>/..." and the
-- policies only allow access to the caller's own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('book-pages','book-pages', false),
       ('question-crops','question-crops', false),
       ('graph-previews','graph-previews', false)
on conflict (id) do update set public = false;

create policy "own_objects_select" on storage.objects for select to authenticated
  using (bucket_id in ('book-pages','question-crops','graph-previews')
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own_objects_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('book-pages','question-crops','graph-previews')
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own_objects_update" on storage.objects for update to authenticated
  using (bucket_id in ('book-pages','question-crops','graph-previews')
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own_objects_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('book-pages','question-crops','graph-previews')
         and (storage.foldername(name))[1] = auth.uid()::text);
