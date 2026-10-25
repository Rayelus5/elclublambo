-- P3 Task 6 (migration 20261025200002): donations from people outside the club (P3-R7, P3-R8, P3-R9).
--   - public_donation_intents: own table, RLS on and closed. A confirmed public donation lands in donations with
--     member_id null and public_intent_id (exactly one of intent_id / public_intent_id).
--   - create_public_donation_intent: public accounts only (a banned member is forbidden), an active member is sent to the
--     club donation (use_club_donation); same ranges, Safe and 20-pending cap as create_donation_intent.
--   - attach_public_donation_tx (owner), confirm_public_donation / fail_public_donation / public_donation_overview
--     (service_role), my_public_donations (authenticated).
--   - Anti-reuse against onchain_transfers and donations; confirming twice is already.
--   - donor_ranking keeps its signature and adds listed, non-anonymous external donors as «Donante externo · 0x…».
--   - Entering the club (redeem_invite or bootstrap) claims the wallet's public donations and grants Mecenas (P3-R9);
--     a public donation confirmed after its donor joined is recorded for that member at confirm time.
--   - confirm_donation (club) answers tx_already_used when a public donation already recorded its transfer.
begin;
select plan(65);

create function tests.p3hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.p3addr(p_tag text) returns text language sql immutable as $$
  select '0x' || lpad(p_tag, 40, '0')
$$;
-- creates a public intent as p_user, attaches hash p_n and confirms it as service_role; returns the confirm result
create function tests.p3_donate(p_user uuid, p_token text, p_amount numeric, p_anon boolean, p_listed boolean, p_n int,
                                p_usd6 numeric, p_price numeric default null)
returns jsonb language plpgsql as $$
declare
  v_intent jsonb;
  v_res jsonb;
begin
  perform tests.authenticate_as(p_user);
  v_intent := public.create_public_donation_intent(84532, p_token, p_amount, p_anon, p_listed);
  perform public.attach_public_donation_tx((v_intent ->> 'id')::uuid, tests.p3hash(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_res := public.confirm_public_donation((v_intent ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.p3hash(p_n), 'logIndex', case when p_token = 'ETH' then -1 else 1 end,
                       'blockNumber', 10 + p_n), p_usd6, p_price);
  reset role;
  return v_res || jsonb_build_object('intentId', v_intent ->> 'id');
end;
$$;
create function tests.p3_mecenas(p_member uuid) returns int language sql as $$
  select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where mr.member_id = p_member and r.system_key = 'donor'
$$;
create function pg_temp.code(p_invite uuid) returns text language sql security definer as
  $$ select code from public.invites where id = p_invite $$;
grant execute on function pg_temp.code(uuid) to public;

-- ===== 0. bootstrap path (P3-R9): a wallet that donated publicly becomes the SuperAdmin and claims its donations =====
select set_config('t.ub', tests.create_wallet_user(tests.p3addr('e6b0'))::text, true);
select is(tests.p3_donate(current_setting('t.ub')::uuid, 'USDC', 2000000, false, false, 9601, 2000000) ->> 'status',
  'confirmed', 'a wallet outside the club donates 2 USD');
set local role service_role;
select set_config('t.boot', public.bootstrap_super_admin(current_setting('t.ub')::uuid, tests.p3addr('e6b0'))::text, true);
reset role;
select ok(exists (select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id
                  where mr.member_id = current_setting('t.boot')::uuid and r.name = 'SuperAdmin'),
  'bootstrap_super_admin still works with the members insert trigger');
select is((select count(*)::int from public.donations where donor_address = tests.p3addr('e6b0')
           and member_id = current_setting('t.boot')::uuid), 1, 'bootstrap claims the public donation of its wallet');
select is(tests.p3_mecenas(current_setting('t.boot')::uuid), 1, 'and grants Mecenas (2 USD >= 1 USD)');
select is((select count(*)::int from public.audit_log where action = 'donor_role_granted'
           and target_id = current_setting('t.boot')::uuid), 1, 'the grant on entry is audited');

-- ===== fixtures =====
select set_config('t.m1', tests.create_member(tests.p3addr('e6a1'), current_setting('t.boot')::uuid)::text, true);
select set_config('t.um1', (select auth_user_id::text from public.members where id = current_setting('t.m1')::uuid), true);
select set_config('t.mb', tests.create_member(tests.p3addr('e6a2'), current_setting('t.boot')::uuid)::text, true);
select set_config('t.umb', (select auth_user_id::text from public.members where id = current_setting('t.mb')::uuid), true);
update public.members set status = 'banned' where id = current_setting('t.mb')::uuid;
select set_config('t.ux', tests.create_wallet_user(tests.p3addr('e6c1'))::text, true);   -- listed
select set_config('t.uy', tests.create_wallet_user(tests.p3addr('e6c2'))::text, true);   -- not listed
select set_config('t.uz', tests.create_wallet_user(tests.p3addr('e6c3'))::text, true);   -- anonymous + listed
select set_config('t.up', tests.create_wallet_user(tests.p3addr('e6c4'))::text, true);   -- joins with 2 USD
select set_config('t.uq', tests.create_wallet_user(tests.p3addr('e6c5'))::text, true);   -- joins with 0.5 USD
select set_config('t.ucap', tests.create_wallet_user(tests.p3addr('e6c6'))::text, true); -- pending cap
select set_config('t.ur', tests.create_wallet_user(tests.p3addr('e6c7'))::text, true);   -- joins before confirm

-- ===== 1. schema and privileges =====
select ok(has_function_privilege('authenticated', 'public.create_public_donation_intent(int,text,numeric,boolean,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.create_public_donation_intent(int,text,numeric,boolean,boolean)', 'execute'),
  'create_public_donation_intent: authenticated yes, anon no');
select ok(has_function_privilege('authenticated', 'public.attach_public_donation_tx(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'public.attach_public_donation_tx(uuid,text)', 'execute'),
  'attach_public_donation_tx: authenticated yes, anon no');
select ok(has_function_privilege('authenticated', 'public.my_public_donations()', 'execute')
      and not has_function_privilege('anon', 'public.my_public_donations()', 'execute'),
  'my_public_donations: authenticated yes, anon no');
select ok(has_function_privilege('service_role', 'public.confirm_public_donation(uuid,jsonb,numeric,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.confirm_public_donation(uuid,jsonb,numeric,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.confirm_public_donation(uuid,jsonb,numeric,numeric)', 'execute'),
  'confirm_public_donation: service_role only');
select ok(has_function_privilege('service_role', 'public.fail_public_donation(uuid,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.fail_public_donation(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'public.fail_public_donation(uuid,text)', 'execute'),
  'fail_public_donation: service_role only');
select ok(has_function_privilege('service_role', 'public.public_donation_overview()', 'execute')
      and not has_function_privilege('authenticated', 'public.public_donation_overview()', 'execute')
      and not has_function_privilege('anon', 'public.public_donation_overview()', 'execute'),
  'public_donation_overview: service_role only');
select ok(not has_function_privilege('authenticated', 'public._claim_public_donations()', 'execute')
      and not has_function_privilege('anon', 'public._claim_public_donations()', 'execute')
      and exists (select 1 from pg_proc p where p.oid = 'public._claim_public_donations()'::regprocedure
                  and p.prosecdef and p.proconfig @> array['search_path=""']),
  'the claim trigger function runs as definer with an empty search_path and is not callable by clients');
select is(pg_get_function_result('public.donor_ranking(int)'::regprocedure),
  'TABLE(member_id uuid, label text, total_usd6 text, is_me boolean)', 'donor_ranking keeps its output');
select tests.authenticate_as(current_setting('t.ux')::uuid);
select throws_ok($$select count(*) from public.public_donation_intents$$, '42501', null,
  'public_donation_intents has no direct read');
select tests.clear_authentication();
select throws_ok($$insert into public.donations (chain_id, token, amount, usd6, price_source, donor_address, tx_hash,
                     log_index, block_number) values (84532, 'USDC', 1, 1, 'usdc', '0x' || repeat('c', 40),
                     '0x' || repeat('c', 64), 1, 1)$$, '23514', null,
  'a donation needs exactly one of intent_id / public_intent_id');

-- ===== 2. create_public_donation_intent =====
select tests.authenticate_as(current_setting('t.ux')::uuid);
select set_config('t.ix', public.create_public_donation_intent(84532, 'USDC', 3000000, false, true)::text, true);
select tests.clear_authentication();
select ok((current_setting('t.ix')::jsonb ->> 'recipientAddress') = (select safe_address from public.chains where chain_id = 84532)
      and (current_setting('t.ix')::jsonb ->> 'feeAmount') = '0'
      and (current_setting('t.ix')::jsonb -> 'platformAddress') = 'null'::jsonb
      and (current_setting('t.ix')::jsonb ->> 'amount') = '3000000'
      and (current_setting('t.ix')::jsonb ->> 'chainId') = '84532'
      and (current_setting('t.ix')::jsonb ->> 'token') = 'USDC'
      and current_setting('t.ix')::jsonb ? 'expiresAt',
  'a public account gets an intent to the Safe with the same shape as create_donation_intent');
select ok(exists (select 1 from public.public_donation_intents i
                  where i.id = (current_setting('t.ix')::jsonb ->> 'id')::uuid and i.user_id = current_setting('t.ux')::uuid
                    and i.donor_address = tests.p3addr('e6c1') and i.listed and not i.anonymous and i.status = 'pending'
                    and i.expires_at > now() + interval '23 hours'),
  'the intent stores the session wallet as donor and expires in 24 hours');
select tests.authenticate_as(current_setting('t.um1')::uuid);
select throws_ok($$select public.create_public_donation_intent(84532, 'USDC', 3000000, false, true)$$, 'P0001',
  'use_club_donation', 'an active member is sent to the club donation');
select tests.authenticate_as(current_setting('t.umb')::uuid);
select throws_ok($$select public.create_public_donation_intent(84532, 'USDC', 3000000, false, true)$$, 'P0001',
  'forbidden', 'a banned member is forbidden');
select tests.authenticate_as(current_setting('t.uy')::uuid);
select throws_ok($$select public.create_public_donation_intent(59141, 'USDC', 3000000, false, true)$$, 'P0001',
  'chain_invalid', 'a disabled network is chain_invalid');
select throws_ok($$select public.create_public_donation_intent(84532, 'USDC', 0, false, true)$$, 'P0001',
  'amount_out_of_range', 'an amount of 0 is out of range');
select throws_ok($$select public.create_public_donation_intent(84532, 'ETH', 1000000000, false, true)$$, 'P0001',
  'amount_out_of_range', 'ETH under 0.00001 is out of range');
select throws_ok($$select public.create_public_donation_intent(84532, 'USDC', 3000000, false, null)$$, 'P0001',
  'invalid_input', 'a null listed flag is invalid_input');
select throws_ok($$select public.create_public_donation_intent(84532, 'DAI', 3000000, false, true)$$, 'P0001',
  'invalid_input', 'an unknown token is invalid_input');
select tests.authenticate_as(current_setting('t.ucap')::uuid);
select array_length(array_agg(public.create_public_donation_intent(84532, 'USDC', 1000000, false, false)), 1)
from generate_series(1, 20);
select throws_ok($$select public.create_public_donation_intent(84532, 'USDC', 1000000, false, false)$$, 'P0001',
  'too_many_intents', 'the 21st pending intent is too_many_intents');
select tests.clear_authentication();

-- ===== 3. attach_public_donation_tx =====
select tests.authenticate_as(current_setting('t.uy')::uuid);
select throws_ok(format($$select public.attach_public_donation_tx(%L, %L)$$, current_setting('t.ix')::jsonb ->> 'id',
  tests.p3hash(9611)), 'P0001', 'not_found', 'another user cannot attach to the intent');
select tests.authenticate_as(current_setting('t.ux')::uuid);
select throws_ok(format($$select public.attach_public_donation_tx(%L, 'nope')$$, current_setting('t.ix')::jsonb ->> 'id'),
  'P0001', 'invalid_input', 'a malformed hash is invalid_input');
select lives_ok(format($$select public.attach_public_donation_tx(%L, %L)$$, current_setting('t.ix')::jsonb ->> 'id',
  upper(tests.p3hash(9611))), 'the owner attaches the hash');
select throws_ok(format($$select public.attach_public_donation_tx(%L, %L)$$, current_setting('t.ix')::jsonb ->> 'id',
  tests.p3hash(9699)), 'P0001', 'tx_already_attached', 'a different hash afterwards is tx_already_attached');
select tests.clear_authentication();

-- ===== 4. confirm_public_donation =====
set local role service_role;
select throws_ok(format($$select public.confirm_public_donation(%L, %L::jsonb, 3000000, null)$$,
  current_setting('t.ix')::jsonb ->> 'id', jsonb_build_object('txHash', tests.p3hash(9698), 'logIndex', 1, 'blockNumber', 5)),
  'P0001', 'tx_mismatch', 'a transfer with another hash is tx_mismatch');
select throws_ok(format($$select public.confirm_public_donation(%L, %L::jsonb, 2999999, null)$$,
  current_setting('t.ix')::jsonb ->> 'id', jsonb_build_object('txHash', tests.p3hash(9611), 'logIndex', 1, 'blockNumber', 5)),
  'P0001', 'invalid_input', 'a USDC usd6 different from the amount is invalid_input');
select set_config('t.cx', public.confirm_public_donation((current_setting('t.ix')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.p3hash(9611), 'logIndex', 1, 'blockNumber', 5), 3000000, null)::text, true);
select is(current_setting('t.cx')::jsonb ->> 'status', 'confirmed', 'the public donation is confirmed');
select ok(exists (select 1 from public.donations d
                  where d.id = (current_setting('t.cx')::jsonb ->> 'donationId')::uuid and d.member_id is null
                    and d.intent_id is null and d.public_intent_id = (current_setting('t.ix')::jsonb ->> 'id')::uuid
                    and d.donor_address = tests.p3addr('e6c1') and d.listed and not d.anonymous and d.usd6 = 3000000
                    and d.price_source = 'usdc' and d.tx_hash = tests.p3hash(9611) and d.log_index = 1 and d.block_number = 5),
  'it is stored in donations with member_id null, its public intent, donor address and flags');
select is((select status from public.public_donation_intents where id = (current_setting('t.ix')::jsonb ->> 'id')::uuid),
  'confirmed', 'the intent is confirmed');
select is(public.confirm_public_donation((current_setting('t.ix')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.p3hash(9611), 'logIndex', 1, 'blockNumber', 5), 3000000, null),
  jsonb_build_object('status', 'already', 'donationId', current_setting('t.cx')::jsonb ->> 'donationId'),
  'confirming the same intent and hash again is already');
reset role;

-- the same transfer on another public intent
select tests.authenticate_as(current_setting('t.uy')::uuid);
select set_config('t.iy', public.create_public_donation_intent(84532, 'USDC', 3000000, false, false)::text, true);
select public.attach_public_donation_tx((current_setting('t.iy')::jsonb ->> 'id')::uuid, tests.p3hash(9611));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_public_donation(%L, %L::jsonb, 3000000, null)$$,
  current_setting('t.iy')::jsonb ->> 'id', jsonb_build_object('txHash', tests.p3hash(9611), 'logIndex', 1, 'blockNumber', 5)),
  'P0001', 'tx_already_used', 'a transfer already used by a public donation is tx_already_used');
reset role;

-- a transfer already used by a club payment (onchain_transfers)
select tests.authenticate_as(current_setting('t.um1')::uuid);
select set_config('t.im1', public.create_donation_intent(84532, 'USDC', 1000000, false)::text, true);
select public.attach_intent_tx((current_setting('t.im1')::jsonb ->> 'id')::uuid, 'main', tests.p3hash(9620));
select tests.clear_authentication();
set local role service_role;
select is(public.confirm_donation((current_setting('t.im1')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.p3hash(9620), 'logIndex', 1, 'blockNumber', 20), 1000000, null) ->> 'status',
  'confirmed', 'a club donation still confirms (P1 path)');
reset role;
select tests.authenticate_as(current_setting('t.uz')::uuid);
select set_config('t.iz', public.create_public_donation_intent(84532, 'USDC', 1000000, false, true)::text, true);
select public.attach_public_donation_tx((current_setting('t.iz')::jsonb ->> 'id')::uuid, tests.p3hash(9620));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_public_donation(%L, %L::jsonb, 1000000, null)$$,
  current_setting('t.iz')::jsonb ->> 'id', jsonb_build_object('txHash', tests.p3hash(9620), 'logIndex', 1, 'blockNumber', 20)),
  'P0001', 'tx_already_used', 'a transfer already recorded in onchain_transfers is tx_already_used');

-- fail_public_donation
select lives_ok(format($$select public.fail_public_donation(%L, 'tx_already_used')$$, current_setting('t.iy')::jsonb ->> 'id'),
  'fail_public_donation runs for the service role');
select is((select status || ':' || fail_reason from public.public_donation_intents
           where id = (current_setting('t.iy')::jsonb ->> 'id')::uuid), 'failed:tx_already_used', 'the intent is failed with its reason');
select throws_ok(format($$select public.fail_public_donation(%L, 'Bad Reason!')$$, current_setting('t.iz')::jsonb ->> 'id'),
  'P0001', 'invalid_input', 'a malformed reason is invalid_input');
select throws_ok(format($$select public.confirm_public_donation(%L, %L::jsonb, 3000000, null)$$,
  current_setting('t.iy')::jsonb ->> 'id', jsonb_build_object('txHash', tests.p3hash(9611), 'logIndex', 1, 'blockNumber', 5)),
  'P0001', 'intent_expired', 'a failed intent cannot be confirmed');
select throws_ok($$select public.confirm_public_donation(gen_random_uuid(), '{}'::jsonb, 1, null)$$, 'P0001', 'not_found',
  'an unknown intent is not_found');
reset role;

-- unlisted and anonymous external donors; ETH needs its price
select is(tests.p3_donate(current_setting('t.uy')::uuid, 'USDC', 7000000, false, false, 9612, 7000000) ->> 'status',
  'confirmed', 'an unlisted external donation is confirmed');
select tests.authenticate_as(current_setting('t.uz')::uuid);
select set_config('t.iz2', public.create_public_donation_intent(84532, 'ETH', 1000000000000000, true, true)::text, true);
select public.attach_public_donation_tx((current_setting('t.iz2')::jsonb ->> 'id')::uuid, tests.p3hash(9613));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_public_donation(%L, %L::jsonb, 4000000, null)$$,
  current_setting('t.iz2')::jsonb ->> 'id', jsonb_build_object('txHash', tests.p3hash(9613), 'logIndex', -1, 'blockNumber', 9)),
  'P0001', 'invalid_input', 'an ETH donation without a price is invalid_input');
select is(public.confirm_public_donation((current_setting('t.iz2')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.p3hash(9613), 'logIndex', -1, 'blockNumber', 9), 4000000, 400000000000) ->> 'status',
  'confirmed', 'an anonymous ETH donation with its price is confirmed');
reset role;

-- ===== 5. reads =====
select tests.authenticate_as(current_setting('t.ux')::uuid);
select ok((public.my_public_donations() ->> 'totalUsd6') = '3000000'
      and jsonb_array_length(public.my_public_donations() -> 'donations') = 1
      and (public.my_public_donations() -> 'donations' -> 0 ->> 'txHash') = tests.p3hash(9611)
      and (public.my_public_donations() -> 'donations' -> 0 ->> 'listed') = 'true',
  'my_public_donations returns the confirmed total and the own list');
select tests.authenticate_as(current_setting('t.ucap')::uuid);
select is(public.my_public_donations(), jsonb_build_object('totalUsd6', '0', 'donations', '[]'::jsonb),
  'pending intents are not donations');
select tests.clear_authentication();
set local role service_role;
select is(public.public_donation_overview(),
  jsonb_build_object('totalUsd6', (select sum(usd6)::text from public.donations), 'donationCount',
                     (select count(*)::int from public.donations)),
  'public_donation_overview returns only the total and the count');
reset role;

select tests.authenticate_as(current_setting('t.um1')::uuid);
select results_eq($$select label, total_usd6, is_me from public.donor_ranking() where member_id is null$$,
  $$values ('Donante externo · ' || left(tests.p3addr('e6c1'), 6) || '…' || right(tests.p3addr('e6c1'), 4), '3000000'::text, false)$$,
  'only the listed, non-anonymous external donor appears, labelled by its short address');
select results_eq($$select member_id, total_usd6, is_me from public.donor_ranking() where member_id is not null order by total_usd6$$,
  $$values (current_setting('t.m1')::uuid, '1000000'::text, true), (current_setting('t.boot')::uuid, '2000000'::text, false)$$,
  'member rows are unchanged (a claimed donation counts for the member)');
select is((select array_agg(total_usd6 order by ord) from public.donor_ranking() with ordinality as r(member_id, label, total_usd6, is_me, ord)),
  array['3000000', '2000000', '1000000'], 'externals and members are ranked together by total');
select tests.clear_authentication();

-- ===== 6. redeem_invite path (Review Focus 4) =====
select is(tests.p3_donate(current_setting('t.up')::uuid, 'USDC', 2000000, false, false, 9630, 2000000) ->> 'status',
  'confirmed', 'a public wallet donates 2 USD before joining');
select tests.p3_donate(current_setting('t.uq')::uuid, 'USDC', 500000, false, true, 9631, 500000);
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.boot')::uuid));
select set_config('t.inv', (public.create_invite(5, 24)).id::text, true);
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.mp', public.redeem_invite(pg_temp.code(current_setting('t.inv')::uuid))::text, true);
select tests.authenticate_as(current_setting('t.uq')::uuid);
select set_config('t.mq', public.redeem_invite(pg_temp.code(current_setting('t.inv')::uuid))::text, true);
select tests.clear_authentication();
select is((select count(*)::int from public.donations where donor_address = tests.p3addr('e6c4')
           and member_id = current_setting('t.mp')::uuid), 1, 'after redeeming, the public donations carry the member_id');
select is(tests.p3_mecenas(current_setting('t.mp')::uuid), 1, 'and the new member is Mecenas');
select is((select (payload ->> 'totalUsd6') from public.audit_log where action = 'donor_role_granted'
           and target_id = current_setting('t.mp')::uuid), '2000000', 'the grant is audited with the total');
select is((select count(*)::int from public.donations where donor_address = tests.p3addr('e6c5')
           and member_id = current_setting('t.mq')::uuid), 1, 'a small donor is claimed too');
select is(tests.p3_mecenas(current_setting('t.mq')::uuid), 0, 'but under 1 USD gets no Mecenas');

-- ===== 7. confirmed after joining (fix round 1): intent -> attach -> redeem -> confirm =====
select tests.authenticate_as(current_setting('t.ur')::uuid);
select set_config('t.ir', public.create_public_donation_intent(84532, 'ETH', 1000000000000000, false, true)::text, true);
select public.attach_public_donation_tx((current_setting('t.ir')::jsonb ->> 'id')::uuid, tests.p3hash(9640));
select set_config('t.mr', public.redeem_invite(pg_temp.code(current_setting('t.inv')::uuid))::text, true);
select tests.clear_authentication();
select is(tests.p3_mecenas(current_setting('t.mr')::uuid), 0, 'joining with only a pending intent grants nothing yet');
set local role service_role;
select is(public.confirm_public_donation((current_setting('t.ir')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.p3hash(9640), 'logIndex', -1, 'blockNumber', 40), 4000000, 400000000000) ->> 'status',
  'confirmed', 'the public donation of a wallet that joined meanwhile is confirmed');
reset role;
select is((select member_id from public.donations where tx_hash = tests.p3hash(9640)), current_setting('t.mr')::uuid,
  'it is recorded for the new member');
select is(tests.p3_mecenas(current_setting('t.mr')::uuid), 1, 'and grants Mecenas at confirm time');
select is((select payload ->> 'totalUsd6' from public.audit_log where action = 'donor_role_granted'
           and target_id = current_setting('t.mr')::uuid), '4000000', 'the grant at confirm time is audited');
select ok(not has_function_privilege('authenticated', 'public._grant_donor_role_if_due(uuid,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public._grant_donor_role_if_due(uuid,jsonb)', 'execute')
      and not has_function_privilege('service_role', 'public._grant_donor_role_if_due(uuid,jsonb)', 'execute')
      and exists (select 1 from pg_proc p where p.oid = 'public._grant_donor_role_if_due(uuid,jsonb)'::regprocedure
                  and p.prosecdef and p.proconfig @> array['search_path=""']),
  'the shared Mecenas helper is definer, empty search_path and callable by no API role');

-- ===== 8. club direction: a transfer already recorded by a public donation =====
select tests.authenticate_as(current_setting('t.um1')::uuid);
select set_config('t.im2', public.create_donation_intent(84532, 'USDC', 3000000, false)::text, true);
select public.attach_intent_tx((current_setting('t.im2')::jsonb ->> 'id')::uuid, 'main', tests.p3hash(9611));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_donation(%L, %L::jsonb, 3000000, null)$$, current_setting('t.im2')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.p3hash(9611), 'logIndex', 1, 'blockNumber', 5)), 'P0001', 'tx_already_used',
  'confirm_donation answers tx_already_used for a transfer a public donation already recorded');
reset role;

select * from finish();
rollback;
