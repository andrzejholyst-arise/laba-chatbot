begin;

-- Zmieniamy wyłącznie limit sumy fragmentów: zakładki powtarzają część tekstu.
-- Treść źródłowa nadal ma limit 20 000 znaków w aplikacji.
do $$
declare
  definition text := pg_get_functiondef('public.import_knowledge_document(text,jsonb,jsonb)'::regprocedure);
  previous_limit text := '(select sum(char_length(value->>''content'')) from jsonb_array_elements(p_chunks)) > 20000';
  updated_limit text := '(select sum(char_length(value->>''content'')) from jsonb_array_elements(p_chunks)) > 24000';
begin
  if position(previous_limit in definition) > 0 then
    execute replace(definition, previous_limit, updated_limit);
  elsif position(updated_limit in definition) = 0 then
    raise exception 'Nie rozpoznano limitu funkcji importu. Nie zmieniono funkcji.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
