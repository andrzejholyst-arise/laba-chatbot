begin;

create table if not exists public.conversations (
  id bigint generated always as identity primary key,
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  session_key text not null
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id bigint not null references public.conversations(id),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  position bigint generated always as identity
);

-- Dla istniejących tabel: stare rozmowy bez przypisanej sesji pozostają ukryte.
alter table public.conversations add column if not exists session_key text;
alter table public.messages add column if not exists position bigint generated always as identity;
alter table public.conversations add column if not exists client_id uuid not null default gen_random_uuid();
alter table public.messages add column if not exists client_id uuid not null default gen_random_uuid();

create unique index if not exists conversations_client_id_key on public.conversations (client_id);
create unique index if not exists messages_client_id_key on public.messages (client_id);

create index if not exists conversations_session_created_idx
  on public.conversations (session_key, created_at desc, id);
create index if not exists messages_conversation_position_idx
  on public.messages (conversation_id, position);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Dostęp przez serwer z kluczem service_role; bez polityk dla przeglądarki.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('conversations', 'messages')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

revoke all on table public.conversations, public.messages from public, anon, authenticated;
grant all on table public.conversations, public.messages to service_role;

do $$
declare r record;
begin
  for r in
    select pg_get_serial_sequence(v.tbl, v.col) as seq
    from (values ('public.conversations', 'id'), ('public.messages', 'id'),
      ('public.messages', 'position')) as v(tbl, col)
  loop
    if r.seq is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', r.seq);
      execute format('grant usage, select on sequence %s to service_role', r.seq);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
