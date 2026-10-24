-- P1 Task 7 (migration 20261024200005): channel gates by what the member has donated (P1-R4, D8).
--   - channels.gate_min_donated_usd6 is the only rule: it passes when the member's total in donations is >= it.
--   - 'view' hides the channel below the amount; 'post' keeps it readable but removes SEND.
--   - channel_lock_state returns scope, minDonatedUsd6, myDonatedUsd6 (text), requirements.
--   - the legacy share/net columns are ignored even when they hold a value.
begin;
select plan(20);

-- ===== fixtures: a, d (donated exactly 10 USD), e (9.99 USD), n (nothing), two channels =====
select set_config('t.a', tests.create_member('0x' || lpad('d1050a', 40, '0'), null, true)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('d1050d', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.e', tests.create_member('0x' || lpad('d1050e', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.n', tests.create_member('0x' || lpad('d1050f', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ud', (select auth_user_id::text from public.members where id = current_setting('t.d')::uuid), true);
select set_config('t.ue', (select auth_user_id::text from public.members where id = current_setting('t.e')::uuid), true);
select set_config('t.un', (select auth_user_id::text from public.members where id = current_setting('t.n')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'P105cat')::text, true);
select set_config('t.view', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p105view')::text, true);
select set_config('t.post', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p105post')::text, true);
select set_config('t.open', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p105open')::text, true);

select tests.give(current_setting('t.d')::uuid, 4000000);
select tests.give(current_setting('t.d')::uuid, 6000000);
select tests.give(current_setting('t.e')::uuid, 9990000);

update public.channels set gate_min_donated_usd6 = 10000000, gate_scope = 'view' where id = current_setting('t.view')::uuid;
update public.channels set gate_min_donated_usd6 = 10000000, gate_scope = 'post' where id = current_setting('t.post')::uuid;
-- legacy values on an otherwise open channel: ignored
update public.channels set gate_min_share_bps = 10000, gate_min_net_usdc = 1000000000000, gate_scope = 'view'
  where id = current_setting('t.open')::uuid;

-- ===== 1. schema and privileges =====
select col_type_is('public', 'channels', 'gate_min_donated_usd6', 'numeric(78,0)', 'gate_min_donated_usd6 is numeric(78,0)');
select ok(not has_function_privilege('authenticated', 'public._member_donated_usd6(uuid)', 'execute')
      and not has_function_privilege('anon', 'public._member_donated_usd6(uuid)', 'execute'),
  '_member_donated_usd6 is internal');
select ok(to_regprocedure('public.set_channel_gate(uuid,int,numeric,text)') is null
      and to_regprocedure('public.set_channel_gate(uuid,numeric,text)') is not null, 'only the 3-argument set_channel_gate remains');
select is(public._member_donated_usd6(current_setting('t.d')::uuid), 10000000::numeric, 'the donated total is the sum of the member donations');

-- ===== 2. view scope: 10 USD sees, 9.99 does not =====
select is(public.gate_passes(current_setting('t.d')::uuid, current_setting('t.view')::uuid, 'view'), true, 'exactly 10 USD (4 + 6) passes');
select is(public.gate_passes(current_setting('t.e')::uuid, current_setting('t.view')::uuid, 'view'), false, '9.99 USD does not pass');
select is(public.channel_permissions(current_setting('t.d')::uuid, current_setting('t.view')::uuid) & 1, 1::bigint, 'the donor sees the channel');
select is(public.channel_permissions(current_setting('t.e')::uuid, current_setting('t.view')::uuid), 0::bigint, 'the 9.99 USD member gets no bits at all');
select tests.authenticate_as(current_setting('t.ud')::uuid);
select is((select count(*)::int from public.visible_channels() where id = current_setting('t.view')::uuid), 1, 'visible_channels lists it for the donor');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select is((select count(*)::int from public.visible_channels() where id = current_setting('t.view')::uuid), 0, 'visible_channels hides it from 9.99 USD');
select tests.clear_authentication();

-- ===== 3. post scope: seen but not written =====
select is(public.channel_permissions(current_setting('t.e')::uuid, current_setting('t.post')::uuid) & 7, 1::bigint,
  'below the amount: VIEW kept, SEND and SEND_IN_THREADS removed');
select is(public.channel_permissions(current_setting('t.d')::uuid, current_setting('t.post')::uuid) & 7, 7::bigint,
  'with 10 USD the donor can write');

-- ===== 4. lock state =====
select tests.authenticate_as(current_setting('t.ue')::uuid);
select is(public.channel_lock_state(current_setting('t.view')::uuid) ->> 'myDonatedUsd6', '9990000', 'lock state returns myDonatedUsd6 as text');
select is(public.channel_lock_state(current_setting('t.view')::uuid) ->> 'minDonatedUsd6', '10000000', 'and the minimum as text');
select is(public.channel_lock_state(current_setting('t.post')::uuid) ->> 'scope', 'post', 'the post gate reports scope post');
select tests.authenticate_as(current_setting('t.un')::uuid);
select is(public.channel_lock_state(current_setting('t.view')::uuid) ->> 'myDonatedUsd6', '0', 'someone who never donated has 0');
select tests.authenticate_as(current_setting('t.ud')::uuid);
select is(public.channel_lock_state(current_setting('t.view')::uuid), null::jsonb, 'the donor is not locked: null');
select tests.clear_authentication();

-- ===== 5. legacy columns are ignored =====
select is(public.gate_passes(current_setting('t.n')::uuid, current_setting('t.open')::uuid, 'view'), true,
  'legacy share/net values do not gate the channel');
select is(public.channel_permissions(current_setting('t.n')::uuid, current_setting('t.open')::uuid) & 1, 1::bigint,
  'a member with no donations sees a channel that only has legacy values');

-- ===== 6. set_channel_gate nulls the legacy columns =====
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where (permissions & 512) <> 0 and is_system limit 1;
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.a')::uuid));
select public.set_channel_gate(current_setting('t.open')::uuid, 2500000, 'view');
select tests.clear_authentication();
select is((select gate_min_donated_usd6::text || '/' || coalesce(gate_min_share_bps::text, 'null') || '/' || coalesce(gate_min_net_usdc::text, 'null')
           from public.channels where id = current_setting('t.open')::uuid), '2500000/null/null',
  'saving a gate stores the amount and clears the legacy columns');

select * from finish();
rollback;
