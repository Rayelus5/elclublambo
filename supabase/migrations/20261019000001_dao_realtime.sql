-- DAO page live updates: a donation recorded, credited or reverted, a dao_state change, or a member opting in/out of the
-- ranking broadcasts dao_changed on the private "dao" topic. The payload is only {chain_id}; clients re-read through the
-- definer RPCs (dao_overview, dao_ranking, dao_history), which keep the ranking privacy. Every active member can see the
-- DAO page, so every active member may join the topic. Same pattern as 20261016200004_message_realtime.sql.

create policy "realtime_receive_dao_topic"
  on realtime.messages
  for select
  to authenticated
  using (realtime.topic() = 'dao' and public.is_active_member());
-- Intentionally NO insert policy on realtime.messages: clients must never broadcast.

create function public.broadcast_dao_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chain int;
begin
  if tg_table_name = 'dao_state' then
    if new.total_shares is not distinct from old.total_shares and new.value_usdc is not distinct from old.value_usdc then
      return null;
    end if;
    v_chain := new.chain_id;
  elsif tg_table_name = 'dao_ledger' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_chain := new.chain_id;
  else -- members: only the ranking opt-in matters; the active chain is the one the page shows
    if new.dao_ranking_visible is not distinct from old.dao_ranking_visible then
      return null;
    end if;
    select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  end if;

  perform realtime.send(jsonb_build_object('chain_id', v_chain), 'dao_changed', 'dao', true);
  return null;
end;
$$;

revoke execute on function public.broadcast_dao_event() from public, anon, authenticated, service_role;

create trigger dao_ledger_broadcast after insert or update on public.dao_ledger
  for each row execute function public.broadcast_dao_event();
create trigger dao_state_broadcast after update on public.dao_state
  for each row execute function public.broadcast_dao_event();
create trigger members_dao_ranking_broadcast after update of dao_ranking_visible on public.members
  for each row execute function public.broadcast_dao_event();
