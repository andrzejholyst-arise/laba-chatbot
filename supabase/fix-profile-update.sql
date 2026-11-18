begin;

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
