-- Galaxy Survivor M8b (GDD §18 retention): what is kept and for how long, run by the server every hour through one
-- function (the only way to delete these rows).
--   run_inputs     the recorded inputs of an ordinary run go after 30 days; those of suspicious runs and of runs that
--                  purged a Core or reached layer 3 (the records and the leaderboard's) stay always.
--   chat_messages  go after 90 days, unless someone reported them (reports are kept always).
-- run_inputs stays append-only for everyone else: its guard lets a delete through only inside this function.

create function galaxy.run_inputs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('galaxy.retention', true) = 'on' then
    return old;
  end if;
  raise exception 'append_only';
end;
$$;
revoke all on function galaxy.run_inputs_guard() from public, anon, authenticated, service_role;

drop trigger run_inputs_append_only on galaxy.run_inputs;
create trigger run_inputs_append_only before update or delete on galaxy.run_inputs
  for each row execute function galaxy.run_inputs_guard();

create function galaxy.prune_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inputs integer;
  chat integer;
begin
  perform set_config('galaxy.retention', 'on', true);
  delete from galaxy.run_inputs i
   using galaxy.runs r
   where r.id = i.run_id
     and i.created_at < now() - interval '30 days'
     and not r.suspicious
     and coalesce(r.boss_kills, 0) = 0
     and coalesce(r.depth, 0) < 3;
  get diagnostics inputs = row_count;
  perform set_config('galaxy.retention', 'off', true);
  delete from galaxy.chat_messages m
   where m.created_at < now() - interval '90 days'
     and not exists (select 1 from galaxy.chat_reports c where c.message_id = m.id);
  get diagnostics chat = row_count;
  return jsonb_build_object('inputs', inputs, 'chat', chat);
end;
$$;
revoke all on function galaxy.prune_retention() from public, anon, authenticated, service_role;
grant execute on function galaxy.prune_retention() to galaxy_api;
