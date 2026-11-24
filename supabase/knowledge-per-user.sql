-- Baza wiedzy osobno dla każdego zalogowanego użytkownika.
-- Wklej w Supabase → SQL Editor i uruchom raz. Skrypt można uruchomić ponownie.
begin;

-- 1. Kolumna user_id. Domyślnie wypełnia ją baza (auth.uid()); aplikacja jej nie wysyła.
alter table public.documents add column if not exists user_id uuid;
alter table public.chunks    add column if not exists user_id uuid;
alter table public.documents alter column user_id set default auth.uid();
alter table public.chunks    alter column user_id set default auth.uid();

-- Dotychczasowe, wspólne dokumenty i fragmenty mają user_id = NULL, więc po tej zmianie
-- nie będzie ich widział nikt. Jeżeli mają należeć do jednej osoby, odkomentuj i wstaw jej
-- „User UID” z Authentication → Users (dokument i jego fragmenty muszą mieć tego samego właściciela):
-- update public.documents set user_id = '00000000-0000-0000-0000-000000000000' where user_id is null;
-- update public.chunks    set user_id = '00000000-0000-0000-0000-000000000000' where user_id is null;

create index if not exists documents_user_id_idx on public.documents (user_id);
create index if not exists chunks_user_id_idx    on public.chunks (user_id);

-- 2. RLS i polityki „tylko własne wiersze” dla roli authenticated.
alter table public.documents enable row level security;
alter table public.chunks    enable row level security;

do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('documents', 'chunks')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy documents_select_own on public.documents for select to authenticated using (user_id = (select auth.uid()));
create policy documents_insert_own on public.documents for insert to authenticated with check (user_id = (select auth.uid()));
create policy documents_update_own on public.documents for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy documents_delete_own on public.documents for delete to authenticated using (user_id = (select auth.uid()));

create policy chunks_select_own on public.chunks for select to authenticated using (user_id = (select auth.uid()));
create policy chunks_insert_own on public.chunks for insert to authenticated with check (user_id = (select auth.uid()));
create policy chunks_update_own on public.chunks for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chunks_delete_own on public.chunks for delete to authenticated using (user_id = (select auth.uid()));

-- 3. Uprawnienia do tabel. Anonimowi nadal nie mają nic; service_role zostaje jak było.
revoke all on public.documents, public.chunks from public, anon;
grant select, insert, update, delete on public.documents, public.chunks to authenticated;

do $$
declare seq text; target_table text;
begin
  foreach target_table in array array['documents', 'chunks'] loop
    seq := pg_get_serial_sequence('public.' || target_table, 'id');
    if seq is not null then execute format('grant usage, select on sequence %s to authenticated', seq); end if;
  end loop;
end $$;

-- 4. Funkcje zarządzania wiedzą działają jako „security invoker”, więc RLS zawęża je do wierszy
--    osoby wywołującej (lista, zastąpienie, usunięcie, import). Dajemy im wykonanie zalogowanym.
revoke all on function public.import_knowledge_document(text, jsonb, jsonb) from public, anon;
revoke all on function public.list_knowledge_documents() from public, anon;
revoke all on function public.replace_knowledge_document(text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.delete_knowledge_document(text, timestamptz) from public, anon;
grant execute on function public.import_knowledge_document(text, jsonb, jsonb) to authenticated;
grant execute on function public.list_knowledge_documents() to authenticated;
grant execute on function public.replace_knowledge_document(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.delete_knowledge_document(text, timestamptz) to authenticated;

-- 5. match_chunks zwraca tylko fragmenty zalogowanej osoby (RLS + jawny warunek user_id).
--    Podobieństwo kosinusowe: 1 - odległość. Aplikacja używa kolumn title, content, similarity.
drop function if exists public.match_chunks(extensions.vector, integer);
create function public.match_chunks(query_embedding extensions.vector(1536), match_count integer)
returns table(title text, content text, similarity double precision)
language sql stable security invoker set search_path = ''
as $$
  select d.title, c.content,
         (1 - (c.embedding operator(extensions.<=>) query_embedding))::double precision
  from public.chunks as c
  join public.documents as d on d.id = c.document_id
  where c.embedding is not null
    and c.user_id = (select auth.uid())
    and d.user_id = (select auth.uid())
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 20);
$$;
revoke all on function public.match_chunks(extensions.vector, integer) from public, anon;
grant execute on function public.match_chunks(extensions.vector, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
