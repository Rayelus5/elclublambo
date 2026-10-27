-- P1 Task 3 (migration 20261024200003): donations, the Mecenas role, donor visibility and reads.
--   - create_donation_intent(chain, token, amount, anonymous): to the club Safe, chain_invalid / amount_out_of_range /
--     forbidden; the legacy (numeric, int, boolean) overload stays frozen.
--   - confirm_donation (service_role) records the donation and grants Mecenas once the total reaches 1 USD (never twice).
--   - donor_ranking hides donors who left the list (but shows the caller), donation_overview hides anonymous ones.
--   - club_activity reads the donations table.
begin;
select plan(35);

create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- creates an intent as the member, attaches its tx hash and confirms it as service_role; returns the confirm result
create function tests.donate(p_user uuid, p_token text, p_amount numeric, p_anon boolean, p_n int, p_usd6 numeric,
                             p_price numeric default null)
returns jsonb language plpgsql as $$
declare
  v_intent jsonb;
  v_res jsonb;
begin
  perform tests.authenticate_as(p_user);
  v_intent := public.create_donation_intent(84532, p_token, p_amount, p_anon);
  perform public.attach_intent_tx((v_intent ->> 'id')::uuid, 'main', tests.hash(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_res := public.confirm_donation((v_intent ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.hash(p_n), 'logIndex', case when p_token = 'ETH' then -1 else 1 end,
                       'blockNumber', 10 + p_n), p_usd6, p_price);
  reset role;
  return v_res;
end;
$$;

-- ===== fixtures: admin, donors d1 (visible), d2 (leaves the list), d3 (anonymous), and a wallet without member =====
select set_config('t.a', tests.create_member('0x' || lpad('d9c30', 40, '0'), null, true)::text, true);
select set_config('t.d1', tests.create_member('0x' || lpad('d9c31', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.d2', tests.create_member('0x' || lpad('d9c32', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.d3', tests.create_member('0x' || lpad('d9c33', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.u1', (select auth_user_id::text from public.members where id = current_setting('t.d1')::uuid), true);
select set_config('t.u2', (select auth_user_id::text from public.members where id = current_setting('t.d2')::uuid), true);
select set_config('t.u3', (select auth_user_id::text from public.members where id = current_setting('t.d3')::uuid), true);
select set_config('t.stranger', tests.create_wallet_user('0x' || lpad('d9c3f', 40, '0'))::text, true);

-- ===== 1. schema, privileges, config =====
select ok(to_regprocedure('public.create_donation_intent(numeric,int,boolean)') is not null, 'the frozen legacy create_donation_intent overload still exists');
select ok(has_function_privilege('authenticated', 'public.create_donation_intent(int,text,numeric,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.create_donation_intent(int,text,numeric,boolean)', 'execute'),
  'create_donation_intent: authenticated yes, anon no');
select ok(has_function_privilege('service_role', 'public.confirm_donation(uuid,jsonb,numeric,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.confirm_donation(uuid,jsonb,numeric,numeric)', 'execute'),
  'confirm_donation: service_role yes, authenticated no');
select ok(exists (select 1 from public.roles where name = 'Mecenas' and system_key = 'donor' and not is_system
                  and position = 15 and permissions = 0 and color = '#C6F36B'), 'the Mecenas role exists, pinned by system_key donor');
select is((select count(*)::int from public.roles where system_key = 'donor'), 1, 'exactly one donor role after the seed');
select is((select value #>> '{}' from public.app_config where key = 'donor_role_min_usd6'), '1000000',
  'the Mecenas threshold is 1 USD (1000000 in usd6)');
select tests.authenticate_as(current_setting('t.u1')::uuid);
select throws_ok($$select count(*) from public.donations$$, '42501', null, 'donations has no direct read for members');
select tests.clear_authentication();

-- ===== 2. create_donation_intent =====
select tests.authenticate_as(current_setting('t.u1')::uuid);
select set_config('t.i0', public.create_donation_intent(84532, 'USDC', 5000000, false)::text, true);
select is(current_setting('t.i0')::jsonb ->> 'recipientAddress',
  (select safe_address from public.chains where chain_id = 84532), 'the intent pays the Safe of the network, lowercase');
select throws_ok($$select public.create_donation_intent(59141, 'USDC', 5000000, false)$$, 'P0001', 'chain_invalid',
  'Linea Sepolia is chain_invalid');
select throws_ok($$select public.create_donation_intent(84532, 'USDC', 0, false)$$, 'P0001', 'amount_out_of_range',
  'an amount of 0 is out of range');
select tests.authenticate_as(current_setting('t.stranger')::uuid);
select throws_ok($$select public.create_donation_intent(84532, 'USDC', 5000000, false)$$, 'P0001', 'forbidden',
  'a wallet without member is forbidden');
select tests.clear_authentication();

-- ===== 3. confirm_donation and Mecenas =====
select is(tests.donate(current_setting('t.u1')::uuid, 'USDC', 5000000, false, 9301, 5000000) ->> 'status', 'confirmed',
  'a 5 USDC donation is confirmed');
select is((select count(*)::int from public.donations where member_id = current_setting('t.d1')::uuid and usd6 = 5000000
           and token = 'USDC' and price_source = 'usdc' and chain_id = 84532
           and donor_address = '0x' || lpad('d9c31', 40, '0')), 1, 'the donation is stored with its donor address');
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
           where mr.member_id = current_setting('t.d1')::uuid and r.system_key = 'donor'), 1, 'the donor gets Mecenas');
select is((select count(*)::int from public.audit_log where action = 'donor_role_granted'
           and target_id = current_setting('t.d1')::uuid), 1, 'the grant is audited');

select is(tests.donate(current_setting('t.u1')::uuid, 'USDC', 3000000, false, 9302, 3000000) ->> 'status', 'confirmed',
  'a second donation is confirmed');
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
           where mr.member_id = current_setting('t.d1')::uuid and r.system_key = 'donor')
        + (select count(*)::int from public.audit_log where action = 'donor_role_granted'
           and target_id = current_setting('t.d1')::uuid), 2, 'the second donation neither duplicates the role nor the audit');

-- under 1 USD: no role
select tests.donate(current_setting('t.u2')::uuid, 'USDC', 500000, false, 9303, 500000);
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
           where mr.member_id = current_setting('t.d2')::uuid and r.system_key = 'donor'), 0,
  'a total under 1 USD does not grant Mecenas');

-- the same (chain, tx, log) cannot be used by another intent
select tests.authenticate_as(current_setting('t.u2')::uuid);
select set_config('t.i4', public.create_donation_intent(84532, 'USDC', 5000000, false)::text, true);
select public.attach_intent_tx((current_setting('t.i4')::jsonb ->> 'id')::uuid, 'main', tests.hash(9301));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_donation(%L, %L::jsonb, 5000000, null)$$, current_setting('t.i4')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(9301), 'logIndex', 1, 'blockNumber', 10)), 'tx_already_used',
  'a transfer already used is tx_already_used');
reset role;

-- ETH needs the price; confirming an already confirmed intent is idempotent
select tests.authenticate_as(current_setting('t.u3')::uuid);
select set_config('t.i5', public.create_donation_intent(84532, 'ETH', 1000000000000000, true)::text, true);
select public.attach_intent_tx((current_setting('t.i5')::jsonb ->> 'id')::uuid, 'main', tests.hash(9304));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_donation(%L, %L::jsonb, 2000000, null)$$, current_setting('t.i5')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(9304), 'logIndex', -1, 'blockNumber', 14)), 'invalid_input',
  'an ETH donation without a price is invalid_input');
select is(public.confirm_donation((current_setting('t.i5')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(9304), 'logIndex', -1, 'blockNumber', 14), 2000000, 200000000000) ->> 'status', 'confirmed',
  'an anonymous ETH donation with its Chainlink price is confirmed');
select is((select price_source || ':' || eth_price_e8::text from public.donations where tx_hash = tests.hash(9304)),
  'chainlink:200000000000', 'the ETH donation stores its price and source');
select is(public.confirm_donation((select intent_id from public.donations where tx_hash = tests.hash(9301)),
  jsonb_build_object('txHash', tests.hash(9301), 'logIndex', 1, 'blockNumber', 10), 5000000, null) ->> 'status', 'already',
  'confirming a confirmed intent again is already');
reset role;

-- a non-donation intent is not_found for confirm_donation
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
  recipient_member_id, recipient_address, target_type)
values ('9c300000-0000-4000-8000-000000000001', current_setting('t.d1')::uuid, 'tip', 84532, 'USDC', 1000000, 0, 0, 0,
  current_setting('t.d2')::uuid, '0x' || lpad('abc', 40, '0'), 'profile');
set local role service_role;
select throws_ok($$select public.confirm_donation('9c300000-0000-4000-8000-000000000001', '{}'::jsonb, 1000000, null)$$,
  'not_found', 'a tip intent cannot be confirmed as a donation');
reset role;

-- ===== 4. visibility: ranking, overview, status =====
select tests.authenticate_as(current_setting('t.u2')::uuid);
select public.set_donor_visible(false);
select tests.authenticate_as(current_setting('t.u1')::uuid);
select is((select count(*)::int from public.donor_ranking()), 1,
  'd1 sees only itself: d2 left the list and d3 only gave anonymously');
select results_eq($$select is_me, total_usd6 from public.donor_ranking()$$, $$values (true, '8000000'::text)$$,
  'd1 row is marked is_me with its total');
select tests.authenticate_as(current_setting('t.u2')::uuid);
select is((select count(*)::int from public.donor_ranking()), 2, 'd2 sees d1 and its own hidden row');
select results_eq($$select total_usd6 from public.donor_ranking() where is_me$$, $$values ('500000'::text)$$,
  'd2 own row is shown with is_me');

select tests.authenticate_as(current_setting('t.u1')::uuid);
select is((select count(*)::int from jsonb_array_elements(public.donation_overview() -> 'recent') e
           where e ->> 'donorLabel' is null), 2, 'an anonymous donation and a hidden donor have a null donorLabel');
select is((select (public.donation_overview() ->> 'totalUsd6') || ':' || (public.donation_overview() ->> 'donorCount')),
  '10500000:3', 'the overview totals every donation and counts the donors');
select tests.authenticate_as(current_setting('t.u3')::uuid);
select is((select count(*)::int from jsonb_array_elements(public.donation_overview() -> 'recent') e
           where e ->> 'usd6' = '2000000' and e ->> 'donorLabel' is not null), 1, 'the donor sees its own anonymous donation labelled');

select tests.authenticate_as(current_setting('t.u1')::uuid);
select is((select (s ->> 'totalUsd6') || ':' || (s ->> 'isMecenas') || ':' || (s ->> 'visible')
           from (select public.my_donor_status() as s) q), '8000000:true:true', 'my_donor_status of d1');
select is((select count(*)::int from public.club_activity(15) where kind = 'donation'), 4,
  'club_activity returns the donations');
select is((select count(*)::int from public.club_activity(15) where kind = 'donation' and actor_label = 'Anónimo'), 2,
  'club_activity masks the anonymous and the hidden donor');
select tests.authenticate_as(current_setting('t.u2')::uuid);
select is((select (s ->> 'isMecenas') || ':' || (s ->> 'visible') from (select public.my_donor_status() as s) q), 'false:false',
  'my_donor_status of d2: no Mecenas, hidden');
select tests.clear_authentication();

select * from finish();
rollback;
