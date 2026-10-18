-- DAO page live updates: ledger/state/ranking changes broadcast an id-free dao_changed on the private "dao" topic, which
-- any active member may join (the DAO page is visible to every member); clients re-read through the definer RPCs.
begin;
select plan(11);

-- security definer: the realtime.messages receive policy hides rows from a session without a joined topic
create function tests.dao_ev() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from realtime.messages m where m.event = 'dao_changed' and m.topic = 'dao'
$$;

select has_trigger('public', 'dao_ledger', 'dao_ledger_broadcast', 'ledger trigger');
select has_trigger('public', 'dao_state', 'dao_state_broadcast', 'state trigger');
select has_trigger('public', 'members', 'members_dao_ranking_broadcast', 'ranking visibility trigger');
select ok(not has_function_privilege('anon', 'public.broadcast_dao_event()', 'execute')
      and not has_function_privilege('authenticated', 'public.broadcast_dao_event()', 'execute')
      and not has_function_privilege('service_role', 'public.broadcast_dao_event()', 'execute'),
  'nobody can execute the DAO broadcast function directly');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.broadcast_dao_event()'::regprocedure),
  'DAO broadcast function is definer with empty search_path');

select set_config('t.a', tests.create_member('0x' || lpad('d8600', 40, '0'), null, true)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);

-- a state change (credit / revert move value and shares) emits once, with a chain-only payload, privately
update public.dao_state set value_usdc = value_usdc + 1, total_shares = total_shares + 1 where chain_id = 59141;
select is(tests.dao_ev(), 1, 'a dao_state change emits dao_changed');
select ok((select (payload - 'id') = jsonb_build_object('chain_id', 59141) and private from realtime.messages
           where event = 'dao_changed' and topic = 'dao' limit 1),
  'payload is {chain_id} (plus the message id realtime.send adds) on the private dao topic');

-- touching only updated_at emits nothing
update public.dao_state set updated_at = now() where chain_id = 59141;
select is(tests.dao_ev(), 1, 'an unrelated dao_state update emits nothing');

-- opting in/out of the ranking emits (other viewers see the name appear)
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.set_dao_ranking_visible(true);
select tests.clear_authentication();
select is(tests.dao_ev(), 2, 'toggling ranking visibility emits dao_changed');

-- receive policy: only the exact "dao" topic, only for active members (same check as every DAO read RPC)
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                  and policyname = 'realtime_receive_dao_topic' and cmd = 'SELECT' and roles = '{authenticated}'),
  'realtime_receive_dao_topic exists for authenticated, select only');
select ok((select qual like '%is_active_member()%' and qual like '%''dao''%' from pg_policies
           where schemaname = 'realtime' and tablename = 'messages' and policyname = 'realtime_receive_dao_topic'),
  'the policy requires the dao topic and an active member');

select * from finish();
rollback;
