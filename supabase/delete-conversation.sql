begin;

create or replace function public.delete_studio_conversation(
  p_client_id uuid,
  p_session_key text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare conversation_id_to_delete bigint;
begin
  select id into conversation_id_to_delete
  from public.conversations
  where client_id = p_client_id and session_key = p_session_key
  for update;

  if not found then
    return false;
  end if;

  delete from public.messages where conversation_id = conversation_id_to_delete;
  delete from public.conversations where id = conversation_id_to_delete;
  return true;
end;
$$;

revoke all on function public.delete_studio_conversation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.delete_studio_conversation(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
