begin;

-- Istniejące tabele documents i chunks. Bez zmiany typu id i bez embeddingów.
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
revoke all on public.documents, public.chunks from public, anon, authenticated;
grant select, insert on public.documents, public.chunks to service_role;

do $$
declare seq text; table_name text;
begin
  foreach table_name in array array['documents', 'chunks'] loop
    seq := pg_get_serial_sequence('public.' || table_name, 'id');
    if seq is not null then
      execute format('grant usage, select on sequence %s to service_role', seq);
    end if;
  end loop;
end $$;

create or replace function public.add_knowledge_document(p_title text, p_chunks jsonb)
returns table(document_id text, title text, chunk_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare new_id public.documents.id%type; total integer;
begin
  if p_title is null or char_length(btrim(p_title)) = 0 or char_length(p_title) > 200 then
    raise exception 'Nieprawidłowy tytuł.' using errcode = '22023';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'Nieprawidłowe fragmenty.' using errcode = '22023';
  end if;
  total := jsonb_array_length(p_chunks);
  if total = 0 or total > 20000 or exists (
    select 1 from jsonb_array_elements(p_chunks) as item(value)
    where jsonb_typeof(item.value) <> 'string'
      or char_length(btrim(item.value #>> '{}')) = 0
      or char_length(item.value #>> '{}') > 800
  ) or (select sum(char_length(value)) from jsonb_array_elements_text(p_chunks)) > 20000 then
    raise exception 'Nieprawidłowa długość fragmentów.' using errcode = '22023';
  end if;

  insert into public.documents (title) values (btrim(p_title)) returning id into new_id;
  insert into public.chunks (document_id, chunk_index, content)
    select new_id, (item.ordinality - 1)::integer, item.content
    from jsonb_array_elements_text(p_chunks) with ordinality as item(content, ordinality)
    order by item.ordinality;

  -- Każdy błąd INSERT wycofuje całą funkcję, włącznie z nowym dokumentem.
  return query select new_id::text, btrim(p_title), total;
end;
$$;

revoke all on function public.add_knowledge_document(text, jsonb) from public, anon, authenticated;
grant execute on function public.add_knowledge_document(text, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
