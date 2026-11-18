begin;

create table if not exists public.user_profiles (
  id bigint generated always as identity primary key,
  name text,
  preferences jsonb not null default '{}'::jsonb
);

alter table public.user_profiles add column if not exists name text;
alter table public.user_profiles add column if not exists preferences jsonb not null default '{}'::jsonb;

-- W lekcji 7 profil dotyczy jednego właściciela. Indeks dopuszcza jeden wiersz.
-- Jeżeli istnieje ich więcej, transakcja zakończy się błędem bez utraty danych.
create unique index if not exists user_profiles_single_owner
  on public.user_profiles ((true));

alter table public.user_profiles enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
  loop
    execute format('drop policy %I on public.user_profiles', p.policyname);
  end loop;
end $$;

revoke all on table public.user_profiles from public, anon, authenticated;
grant select, insert, update on table public.user_profiles to service_role;

do $$
declare seq text := pg_get_serial_sequence('public.user_profiles', 'id');
begin
  if seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq);
    execute format('grant usage, select on sequence %s to service_role', seq);
  end if;
end $$;

create or replace function public.save_studio_profile(
  p_name text default null,
  p_preferences jsonb default '{}'::jsonb
) returns table(name text, preferences jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare owner_profile_id public.user_profiles.id%type;
begin
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'Preferencje muszą być obiektem JSON.' using errcode = '22023';
  end if;

  -- Blokada zapobiega tworzeniu dwóch profili i utracie równoległych dopisków.
  lock table public.user_profiles in share row exclusive mode;

  select p.id into owner_profile_id from public.user_profiles as p limit 1;
  if found then
    update public.user_profiles as p
    set name = coalesce(p_name, p.name),
        preferences = coalesce(p.preferences, '{}'::jsonb) || p_preferences
    where p.id = owner_profile_id;
  else
    insert into public.user_profiles (name, preferences)
    values (p_name, p_preferences);
  end if;

  return query
    select p.name, coalesce(p.preferences, '{}'::jsonb)
    from public.user_profiles as p;
end;
$$;

revoke all on function public.save_studio_profile(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_studio_profile(text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
commit;
