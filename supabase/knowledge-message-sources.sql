begin;
-- Dokładny tekst źródeł użytych w odpowiedzi pozostaje dostępny po F5,
-- także gdy dokument zostanie później zastąpiony lub usunięty.
alter table public.messages add column if not exists knowledge_context jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
commit;
