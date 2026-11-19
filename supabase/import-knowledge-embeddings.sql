begin;

alter table public.documents enable row level security;
alter table public.chunks enable row level security;
revoke all on public.documents, public.chunks from public, anon, authenticated;
grant select, insert on public.documents to service_role;
grant select, insert, update on public.chunks to service_role;

do $$
declare seq text; target_table text;
begin
  foreach target_table in array array['documents', 'chunks'] loop
    seq := pg_get_serial_sequence('public.' || target_table, 'id');
    if seq is not null then execute format('grant usage, select on sequence %s to service_role', seq); end if;
  end loop;
end $$;

create or replace function public.import_knowledge_document(p_title text, p_chunks jsonb, p_backfill jsonb)
returns table(document_id text, title text, chunk_count integer, backfilled_count integer, missing_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id public.documents.id%type;
  vector_value public.chunks.embedding%type;
  item jsonb;
  ordinal integer := 0;
  updated integer := 0;
  affected integer;
begin
  if p_title is null or char_length(btrim(p_title)) = 0 or char_length(p_title) > 200 then
    raise exception 'Nieprawidłowy tytuł.' using errcode = '22023';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or p_backfill is null or jsonb_typeof(p_backfill) <> 'array' then
    raise exception 'Nieprawidłowe fragmenty.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_chunks) = 0 or jsonb_array_length(p_chunks) > 20000 then
    raise exception 'Nieprawidłowa liczba fragmentów.' using errcode = '22023';
  end if;
  -- Walidacja wszystkich wektorów przed zmianami. Kolumna nadal ma vector(1536).
  for item in select value from jsonb_array_elements(p_chunks || p_backfill) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'content') is distinct from 'string'
      or char_length(btrim(item->>'content')) = 0
      or jsonb_typeof(item->'embedding') is distinct from 'array' then
      raise exception 'Brak treści lub embeddingu.' using errcode = '22023';
    end if;
    if jsonb_array_length(item->'embedding') <> 1536 or exists (
      select 1 from jsonb_array_elements(item->'embedding') as number(value)
      where jsonb_typeof(number.value) <> 'number'
    ) then
      raise exception 'Nieprawidłowy wymiar lub wartości embeddingu.' using errcode = '22023';
    end if;
    vector_value := (item->'embedding')::text;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_chunks) as chunk(value) where char_length(chunk.value->>'content') > 800)
    or (select sum(char_length(value->>'content')) from jsonb_array_elements(p_chunks)) > 24000 then
    raise exception 'Za długa treść dokumentu.' using errcode = '22023';
  end if;

  -- Podczas sprawdzania i zapisu nikt nie może dopisać nowych pustych fragmentów.
  lock table public.chunks in share row exclusive mode;
  for item in select value from jsonb_array_elements(p_backfill) loop
    vector_value := (item->'embedding')::text;
    update public.chunks as c set embedding = vector_value
      where c.id::text = item->>'id' and c.content = item->>'content' and c.embedding is null;
    get diagnostics affected = row_count;
    updated := updated + affected;
    if affected = 0 and not exists (
      select 1 from public.chunks as c where c.id::text = item->>'id' and c.content = item->>'content' and c.embedding is not null
    ) then
      raise exception 'Fragment zmienił się w trakcie importu.' using errcode = '40001';
    end if;
  end loop;
  if exists (select 1 from public.chunks as c where c.embedding is null) then
    raise exception 'Nie uzupełniono wszystkich fragmentów.' using errcode = '40001';
  end if;

  insert into public.documents (title) values (btrim(p_title)) returning id into new_id;
  for item in select value from jsonb_array_elements(p_chunks) loop
    vector_value := (item->'embedding')::text;
    insert into public.chunks (document_id, chunk_index, content, embedding)
      values (new_id, ordinal, item->>'content', vector_value);
    ordinal := ordinal + 1;
  end loop;
  -- Błąd dowolnego fragmentu wycofuje dokument i uzupełnienia starych fragmentów.
  return query select new_id::text, btrim(p_title), ordinal, updated, 0;
end;
$$;

revoke all on function public.import_knowledge_document(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_knowledge_document(text, jsonb, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
