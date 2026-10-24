begin;
select plan(12);

-- F3c: marking a solution / cancelling a bounty broadcasts an id-only bounty_changed on the channel topic.

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
-- security definer: the realtime.messages receive policy hides rows from a session without a joined topic
create function tests.ev(p_event text, p_id uuid) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from realtime.messages m where m.event = p_event and m.payload->>'id' = p_id::text
$$;

select has_trigger('public', 'bounties', 'bounties_broadcast_update', 'update trigger on bounties');
select ok(not has_function_privilege('anon', 'public.broadcast_bounty_event()', 'execute')
      and not has_function_privilege('authenticated', 'public.broadcast_bounty_event()', 'execute')
      and not has_function_privilege('service_role', 'public.broadcast_bounty_event()', 'execute'),
  'nobody can execute the bounty broadcast function directly');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.broadcast_bounty_event()'::regprocedure),
  'bounty broadcast function is definer with empty search_path');

select set_config('t.a', tests.create_member('0x' || lpad('d7200', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d7201', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.cat', tests.create_channel(null, 'category', 'T720cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't720')::text, true);

-- bounty 1: marked
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b1', public.create_bounty(current_setting('t.ch')::uuid, tests.td('uno'), 84532, 'USDC', 10000000)::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r1', public.post_message(current_setting('t.ch')::uuid, tests.td('sol'), 'x', false, current_setting('t.b1')::uuid, null, '[]'::jsonb)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is(tests.ev('bounty_changed', current_setting('t.b1')::uuid), 0, 'creating a bounty emits no bounty_changed');
select public.mark_bounty_solution(current_setting('t.b1')::uuid, current_setting('t.r1')::uuid);
select is(tests.ev('bounty_changed', current_setting('t.b1')::uuid), 1, 'marking a solution emits bounty_changed with the bounty id');
select tests.clear_authentication();
select ok((select payload = jsonb_build_object('id', current_setting('t.b1'), 'channel_id', current_setting('t.ch'), 'thread_root_id', null)
           from realtime.messages where event = 'bounty_changed' and payload->>'id' = current_setting('t.b1')),
  'payload is exactly {id, channel_id, thread_root_id}');
select ok((select m.topic = 'channel:' || current_setting('t.ch') and m.private
           from realtime.messages m where m.event = 'bounty_changed' and m.payload->>'id' = current_setting('t.b1')),
  'sent to the private channel topic');
select tests.authenticate_as(current_setting('t.ua')::uuid);

-- bounty 2: cancelled
select set_config('t.b2', public.create_bounty(current_setting('t.ch')::uuid, tests.td('dos'), 84532, 'USDC', 10000000)::text, true);
select public.cancel_bounty(current_setting('t.b2')::uuid);
select is(tests.ev('bounty_changed', current_setting('t.b2')::uuid), 1, 'cancelling emits bounty_changed');

-- bounty 3: a non-lifecycle update (service role backdating the creation) emits nothing
select set_config('t.b3', public.create_bounty(current_setting('t.ch')::uuid, tests.td('tres'), 84532, 'USDC', 10000000)::text, true);
select tests.clear_authentication();
update public.bounties set created_at = created_at - interval '1 day' where message_id = current_setting('t.b3')::uuid;
select is(tests.ev('bounty_changed', current_setting('t.b3')::uuid), 0, 'an unrelated update emits nothing');

-- paying emits too (the card must leave "solution marked")
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i1', public.create_bounty_payment_intent(current_setting('t.b1')::uuid, 84532, 10000000)::text, true);
select public.attach_intent_tx((current_setting('t.i1')::jsonb ->> 'id')::uuid, 'main', '0x' || lpad('7201', 64, '0'));
select tests.clear_authentication();
set local role service_role;
select public.confirm_bounty_payment((current_setting('t.i1')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', '0x' || lpad('7201', 64, '0'), 'logIndex', 1, 'blockNumber', 720,
    'blockTimestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), null);
reset role;
select is(tests.ev('bounty_changed', current_setting('t.b1')::uuid), 2, 'confirming the payment emits bounty_changed');

-- a second cancel/mark attempt that fails emits nothing more
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.cancel_bounty(%L)$$, current_setting('t.b1')), 'P0001', 'already_marked', 'cancel after marking is refused');
select is(tests.ev('bounty_changed', current_setting('t.b1')::uuid), 2, 'a refused action emits nothing');

select * from finish();
rollback;
