-- P0 Task 4 (migration 20261024100002): tips and bounties per enabled network, no fee (P0-R4, P0-R5, P0-R7).
--   - create_tip_intent / create_bounty / create_bounty_payment_intent take the chain; chain_invalid unless enabled,
--     network_not_accepted unless the recipient (or solver) receives on that network; fee columns always 0.
--   - A bounty is paid with its own token on any enabled network the solver accepts (no chain equality at confirm).
--   - bounty_status loses other_chain; member_tips_totals sums the enabled networks; the reads filter on
--     private.chain_enabled instead of the legacy active chain.
begin;
select plan(50);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.post(p_ch uuid, p_body jsonb, p_root uuid default null)
returns uuid language sql as $$
  select public.post_message(p_ch, p_body, 'x', false, p_root, null, '[]'::jsonb)
$$;
create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
-- a confirmed tip inserted directly (read tests need no chain verification)
create function tests.seed_tip(p_from uuid, p_to uuid, p_chain int, p_amount numeric, p_n int)
returns void language plpgsql as $$
declare v_intent uuid;
begin
  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, target_type, status)
  values (p_from, 'tip', p_chain, 'USDC', p_amount, 0, 0, 0, p_to, '0x' || lpad('abc', 40, '0'), 'profile', 'confirmed')
  returning id into v_intent;
  insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, token, amount, fee_amount,
                           anonymous, main_tx_hash, block_number)
  values (v_intent, p_chain, p_from, p_to, 'profile', 'USDC', p_amount, 0, false, '0x' || lpad(to_hex(p_n), 64, '0'), 1);
end;
$$;

-- ===== fixtures: admin (SuperAdmin, bounty author), donor, recipient, solver, totals member =====
select set_config('t.a', tests.create_member('0x' || lpad('d9960', 40, '0'), null, true)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('d9961', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.r', tests.create_member('0x' || lpad('d9962', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.s', tests.create_member('0x' || lpad('d9963', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('d9964', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ud', (select auth_user_id::text from public.members where id = current_setting('t.d')::uuid), true);
select set_config('t.ur', (select auth_user_id::text from public.members where id = current_setting('t.r')::uuid), true);
select set_config('t.us', (select auth_user_id::text from public.members where id = current_setting('t.s')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'T996cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't996')::text, true);

select tests.authenticate_as(current_setting('t.ur')::uuid);
select set_config('t.m1', tests.post(current_setting('t.ch')::uuid, tests.td('tip me'))::text, true);
select tests.clear_authentication();

-- ===== 1. signatures and privileges =====
select ok(to_regprocedure('public.create_tip_intent(text,uuid,text,numeric,int,boolean)') is null,
  'the fee-taking create_tip_intent is gone');
select ok(to_regprocedure('public.create_bounty(uuid,jsonb,text,numeric)') is null, 'the chainless create_bounty is gone');
select ok(to_regprocedure('public.create_bounty_payment_intent(uuid,numeric,int)') is null,
  'the fee-taking create_bounty_payment_intent is gone');
select ok(to_regprocedure('public.member_tips_totals(uuid,int)') is null, 'the per-chain member_tips_totals is gone');
select ok(has_function_privilege('authenticated', 'public.create_tip_intent(text,uuid,int,text,numeric,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.create_tip_intent(text,uuid,int,text,numeric,boolean)', 'execute'),
  'create_tip_intent: authenticated yes, anon no');
select ok(has_function_privilege('authenticated', 'public.create_bounty(uuid,jsonb,int,text,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.create_bounty(uuid,jsonb,int,text,numeric)', 'execute'),
  'create_bounty: authenticated yes, anon no');
select ok(has_function_privilege('authenticated', 'public.create_bounty_payment_intent(uuid,int,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.create_bounty_payment_intent(uuid,int,numeric)', 'execute'),
  'create_bounty_payment_intent: authenticated yes, anon no');
select ok(has_function_privilege('authenticated', 'public.member_tips_totals(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.member_tips_totals(uuid)', 'execute'),
  'member_tips_totals: authenticated yes, anon no');

-- ===== 2. tips per network, no fee =====
select tests.authenticate_as(current_setting('t.ud')::uuid);
select set_config('t.i1', public.create_tip_intent('message', current_setting('t.m1')::uuid, 84532, 'USDC', 10000000, false)::text, true);
select set_config('t.i2', public.create_tip_intent('profile', current_setting('t.r')::uuid, 421614, 'ETH', 10000000000000, false)::text, true);
select is((current_setting('t.i1')::jsonb ->> 'chainId')::int, 84532, 'a tip on 84532 returns chainId 84532');
select is((current_setting('t.i2')::jsonb ->> 'chainId')::int, 421614, 'a tip on 421614 returns chainId 421614');
select is((current_setting('t.i1')::jsonb ->> 'feeAmount'), '0', 'feeAmount is "0"');
select ok((current_setting('t.i1')::jsonb ? 'platformAddress') and (current_setting('t.i1')::jsonb -> 'platformAddress') = 'null'::jsonb,
  'platformAddress is null (kept for the local ledger)');
select is((current_setting('t.i1')::jsonb ->> 'recipientAddress'), '0x' || lpad('d9962', 40, '0'), 'recipient wallet is snapshotted');
select tests.clear_authentication();
select results_eq(
  format($$select chain_id, fee_bps, min_fee_bps, fee_amount::text, platform_address from public.payment_intents
           where id in (%L, %L) order by chain_id$$, current_setting('t.i1')::jsonb ->> 'id', current_setting('t.i2')::jsonb ->> 'id'),
  $$values (84532, 0, 0, '0'::text, null::text), (421614, 0, 0, '0', null)$$,
  'both intents keep their chain and store no fee');
-- a non-zero minimum left in app_config is ignored
update public.app_config set value = '100'::jsonb where key = 'min_fee_bps';
select tests.authenticate_as(current_setting('t.ud')::uuid);
select is((public.create_tip_intent('message', current_setting('t.m1')::uuid, 84532, 'USDC', 10000000, false) ->> 'feeAmount'), '0',
  'min_fee_bps no longer applies');
select tests.clear_authentication();
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';

-- disabled and unknown networks (ruling #1: 8453 starts enabled, so the SuperAdmin disables it first)
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.set_chain_enabled(8453, false);
select tests.authenticate_as(current_setting('t.ud')::uuid);
select throws_ok(format($$select public.create_tip_intent('message', %L, 8453, 'USDC', 10000000, false)$$, current_setting('t.m1')),
  'chain_invalid', 'a disabled network (8453) is chain_invalid');
select throws_ok(format($$select public.create_tip_intent('message', %L, 59141, 'USDC', 10000000, false)$$, current_setting('t.m1')),
  'chain_invalid', 'Linea is chain_invalid');
select throws_ok(format($$select public.create_tip_intent('message', %L, 1, 'USDC', 10000000, false)$$, current_setting('t.m1')),
  'chain_invalid', 'an unknown chain is chain_invalid');
select throws_ok(format($$select public.create_tip_intent('message', %L, null, 'USDC', 10000000, false)$$, current_setting('t.m1')),
  'invalid_input', 'a null chain is invalid_input');

-- the recipient's networks (Review Focus 2)
select tests.authenticate_as(current_setting('t.ur')::uuid);
select public.set_receive_networks('{base}');
select tests.authenticate_as(current_setting('t.ud')::uuid);
select throws_ok(format($$select public.create_tip_intent('message', %L, 421614, 'USDC', 10000000, false)$$, current_setting('t.m1')),
  'network_not_accepted', 'a recipient on {base} refuses a tip on Arbitrum Sepolia');
select throws_ok(format($$select public.create_tip_intent('profile', %L, 421614, 'USDC', 10000000, false)$$, current_setting('t.r')),
  'network_not_accepted', 'also on a profile tip');
select lives_ok(format($$select public.create_tip_intent('message', %L, 84532, 'USDC', 10000000, false)$$, current_setting('t.m1')),
  'the same recipient accepts Base Sepolia');
select tests.clear_authentication();

-- ===== 3. bounties: announced network, paid on any accepted network with the bounty's token =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b1', public.create_bounty(current_setting('t.ch')::uuid, tests.td('bounty arb'), 421614, 'USDC', 1000000)::text, true);
select throws_ok(format($$select public.create_bounty(%L, tests.td('x'), 59141, 'USDC', 1000000)$$, current_setting('t.ch')),
  'chain_invalid', 'create_bounty on Linea is chain_invalid');
select throws_ok(format($$select public.create_bounty(%L, tests.td('x'), 8453, 'USDC', 1000000)$$, current_setting('t.ch')),
  'chain_invalid', 'create_bounty on a disabled network is chain_invalid');
select throws_ok(format($$select public.create_bounty(%L, tests.td('x'), null, 'USDC', 1000000)$$, current_setting('t.ch')),
  'invalid_input', 'create_bounty with a null chain is invalid_input');
select tests.clear_authentication();
select is((select chain_id from public.bounties where message_id = current_setting('t.b1')::uuid), 421614,
  'the bounty stores its announced network');

select tests.authenticate_as(current_setting('t.us')::uuid);
select set_config('t.r1', tests.post(current_setting('t.ch')::uuid, tests.td('solution'), current_setting('t.b1')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b1')::uuid, current_setting('t.r1')::uuid);

select throws_ok(format($$select public.create_bounty_payment_intent(%L, 59141, 1000000)$$, current_setting('t.b1')),
  'chain_invalid', 'paying on Linea is chain_invalid');
select throws_ok(format($$select public.create_bounty_payment_intent(%L, 8453, 1000000)$$, current_setting('t.b1')),
  'chain_invalid', 'paying on a disabled network is chain_invalid');
select throws_ok(format($$select public.create_bounty_payment_intent(%L, null, 1000000)$$, current_setting('t.b1')),
  'invalid_input', 'paying with a null chain is invalid_input');

-- (a) a hashless intent on another network is expired and replaced
select set_config('t.pa', public.create_bounty_payment_intent(current_setting('t.b1')::uuid, 421614, 1000000)::text, true);
select is((current_setting('t.pa')::jsonb ->> 'chainId')::int, 421614, 'a payment on the announced network');
select is(public.create_bounty_payment_intent(current_setting('t.b1')::uuid, 421614, 1000000) ->> 'id',
  current_setting('t.pa')::jsonb ->> 'id', 'asking again on the same network returns the same hashless intent');
select set_config('t.pb', public.create_bounty_payment_intent(current_setting('t.b1')::uuid, 84532, 1000000)::text, true);
select isnt(current_setting('t.pb')::jsonb ->> 'id', current_setting('t.pa')::jsonb ->> 'id', 'another network gets a new intent');
select is((current_setting('t.pb')::jsonb ->> 'chainId')::int || '/' || (current_setting('t.pb')::jsonb ->> 'token')
          || '/' || (current_setting('t.pb')::jsonb ->> 'feeAmount'),
  '84532/USDC/0', 'paid on 84532 with the bounty token and no fee');
select tests.clear_authentication();
select is((select status from public.payment_intents where id = (current_setting('t.pa')::jsonb ->> 'id')::uuid), 'expired',
  'the hashless intent on the other network is expired');
select is((select fee_bps || '/' || min_fee_bps || '/' || fee_amount || '/' || coalesce(platform_address, 'null')
           from public.payment_intents where id = (current_setting('t.pb')::jsonb ->> 'id')::uuid),
  '0/0/0/null', 'the bounty intent stores no fee');

-- the solver's networks
select tests.authenticate_as(current_setting('t.us')::uuid);
select public.set_receive_networks('{arbitrum}');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.create_bounty_payment_intent(%L, 84532, 1000000)$$, current_setting('t.b1')),
  'network_not_accepted', 'a solver on {arbitrum} refuses a payment on Base Sepolia');
select tests.authenticate_as(current_setting('t.us')::uuid);
select public.set_receive_networks('{base,arbitrum}');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is(public.create_bounty_payment_intent(current_setting('t.b1')::uuid, 84532, 1000000) ->> 'id',
  current_setting('t.pb')::jsonb ->> 'id', 'once accepted again, the live intent on 84532 comes back');

-- confirm: created on 421614, paid on 84532 (ruling #4)
select public.attach_intent_tx((current_setting('t.pb')::jsonb ->> 'id')::uuid, 'main', tests.hash(9961));
select tests.clear_authentication();
set local role service_role;
select lives_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.pb')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(9961), 'logIndex', 1, 'blockNumber', 10, 'blockTimestamp', now())),
  'a payment on another network than the announced one is confirmed');
reset role;
select is((select b.paid_at is not null and t.chain_id = 84532 from public.bounties b join public.tips t on t.id = b.paid_tip_id
           where b.message_id = current_setting('t.b1')::uuid), true, 'the bounty is paid by a tip on 84532');

-- confirm still refuses a disabled network
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b2', public.create_bounty(current_setting('t.ch')::uuid, tests.td('bounty base'), 84532, 'USDC', 1000000)::text, true);
select tests.authenticate_as(current_setting('t.us')::uuid);
select set_config('t.r2', tests.post(current_setting('t.ch')::uuid, tests.td('solution 2'), current_setting('t.b2')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b2')::uuid, current_setting('t.r2')::uuid);
select set_config('t.pc', public.create_bounty_payment_intent(current_setting('t.b2')::uuid, 421614, 1000000)::text, true);
select public.attach_intent_tx((current_setting('t.pc')::jsonb ->> 'id')::uuid, 'main', tests.hash(9962));
select public.set_chain_enabled(421614, false);
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.pc')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(9962), 'logIndex', 1, 'blockNumber', 10, 'blockTimestamp', now())),
  'chain_invalid', 'confirm refuses a payment on a network disabled since');
reset role;
update public.chains set enabled = true where chain_id = 421614;
select results_eq(
  format($$select public.bounty_status(b) from public.bounties b where b.message_id = %L$$, current_setting('t.b2')),
  $$values ('solution_marked'::text)$$, 'the refused confirmation paid nothing');

-- ===== 4. bounty_status never says other_chain =====
select ok(position('other_chain' in pg_get_functiondef('public.bounty_status(public.bounties)'::regprocedure)) = 0,
  'bounty_status has no other_chain branch');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b3', public.create_bounty(current_setting('t.ch')::uuid, tests.td('open base'), 84532, 'USDC', 1000000)::text, true);
select set_config('t.b4', public.create_bounty(current_setting('t.ch')::uuid, tests.td('open arb'), 421614, 'ETH', 100000000000000)::text, true);
select set_config('t.b5', public.create_bounty(current_setting('t.ch')::uuid, tests.td('legacy'), 84532, 'USDC', 1000000)::text, true);
select tests.clear_authentication();
update public.bounties set chain_id = 59141 where message_id = current_setting('t.b5')::uuid;
update public.app_config set value = '59144'::jsonb where key = 'active_chain_id';
select is((select count(*)::int from public.bounties b where public.bounty_status(b) = 'other_chain'), 0,
  'no bounty is other_chain, whatever the legacy active chain');
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b5')::uuid), 'open',
  'a leftover Linea bounty is just open');

-- ===== 5. reads filter on the enabled networks =====
select tests.authenticate_as(current_setting('t.ud')::uuid);
select is((select array_agg(h.message_id::text order by h.message_id) from public.home_open_bounties(20, current_setting('t.ch')::uuid) h
           where h.message_id in (current_setting('t.b3')::uuid, current_setting('t.b4')::uuid, current_setting('t.b5')::uuid)),
  (select array_agg(x order by x) from unnest(array[current_setting('t.b3'), current_setting('t.b4')]) x),
  'home_open_bounties lists 84532 and 421614 and leaves out 59141');
select is((public.member_bounty_record(current_setting('t.a')::uuid)).open, 2,
  'member_bounty_record counts the open bounties on both enabled networks only');
select is((select count(*)::int from public.club_activity(50) c where c.kind = 'bounty' and c.message_id = current_setting('t.b5')::uuid), 0,
  'club_activity leaves out the Linea bounty');
select is((select count(*)::int from public.club_activity(50) c
           where c.kind = 'bounty' and c.message_id in (current_setting('t.b3')::uuid, current_setting('t.b4')::uuid)), 2,
  'club_activity shows bounties of both networks');
select tests.clear_authentication();
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';

-- member_tips_totals: one row per token across the enabled networks, Linea left out
select tests.seed_tip(current_setting('t.d')::uuid, current_setting('t.t')::uuid, 84532, 1000000, 99601);
select tests.seed_tip(current_setting('t.d')::uuid, current_setting('t.t')::uuid, 421614, 2000000, 99602);
select tests.seed_tip(current_setting('t.d')::uuid, current_setting('t.t')::uuid, 59141, 4000000, 99603);
select tests.authenticate_as(current_setting('t.ud')::uuid);
select results_eq(
  format($$select token, total_text, tip_count from public.member_tips_totals(%L::uuid)$$, current_setting('t.t')),
  $$values ('USDC'::text, '3000000'::text, 2)$$,
  'member_tips_totals sums 84532 and 421614 in one row per token and skips 59141');
select tests.clear_authentication();
update public.chains set enabled = false where chain_id = 421614;
select tests.authenticate_as(current_setting('t.ud')::uuid);
select results_eq(
  format($$select token, total_text, tip_count from public.member_tips_totals(%L::uuid)$$, current_setting('t.t')),
  $$values ('USDC'::text, '1000000'::text, 1)$$,
  'a network disabled later stops counting');
select tests.clear_authentication();

select * from finish();
rollback;
