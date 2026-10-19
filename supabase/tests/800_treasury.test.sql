begin;
select plan(129);

-- helpers (rolled back with the test)
create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- a donation intent created and its hashes attached, as the donor
create function tests.mkdon(p_user uuid, p_amount numeric, p_n int, p_fee int default 0)
returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, p_fee, true);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.hash(p_n));
  if p_fee > 0 then
    perform public.attach_intent_tx((v ->> 'id')::uuid, 'fee', tests.hash(p_n + 5000));
  end if;
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
-- record_donation as the service
create function tests.rec(p_intent uuid, p_n int, p_block bigint default 100, p_fee boolean default false, p_fee_block bigint default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  set local role service_role;
  v := public.record_donation(p_intent,
    jsonb_build_object('txHash', tests.hash(p_n), 'logIndex', 0, 'blockNumber', p_block),
    case when p_fee then jsonb_build_object('txHash', tests.hash(p_n + 5000), 'logIndex', 1, 'blockNumber', coalesce(p_fee_block, p_block)) end);
  reset role;
  return v;
end;
$$;
-- F4a: credit at NAV with assets = value_usdc + every pending donation of the chain, so NAV_previo = value_usdc
-- and the F3 share math (floor(d * S / V)) is what these assertions keep checking
create function tests.cr(p_ledger uuid) returns void language plpgsql as $$
declare v_assets numeric;
begin
  select coalesce((select s.value_usdc
                          + (select coalesce(sum(x.amount_usdc), 0) from public.dao_ledger x
                             where x.chain_id = l.chain_id and x.status = 'pending_finality')
                   from public.dao_ledger l join public.dao_state s on s.chain_id = l.chain_id
                   where l.id = p_ledger), 0)
    into v_assets;
  set local role service_role;
  perform public.credit_donation(p_ledger, v_assets, 9223372036854775807);
  reset role;
end;
$$;
create function tests.rv(p_ledger uuid) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.revert_donation(p_ledger);
  reset role;
end;
$$;
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
create function tests.led(p_intent uuid) returns uuid language sql as $$
  select id from public.dao_ledger where intent_id = p_intent
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d8000', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d8001', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('d8002', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('d8003', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.e', tests.create_member('0x' || lpad('d8004', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.f', tests.create_member('0x' || lpad('d8005', 40, '0'), current_setting('t.a')::uuid)::text, true);
update public.members set status = 'banned' where id = current_setting('t.e')::uuid;
update public.members set handle = 'author1' where id = current_setting('t.a')::uuid;
update public.members set handle = 'second2' where id = current_setting('t.b')::uuid;
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.ud', (select auth_user_id::text from public.members where id = current_setting('t.d')::uuid), true);
select set_config('t.ue', (select auth_user_id::text from public.members where id = current_setting('t.e')::uuid), true);
select set_config('t.uf', (select auth_user_id::text from public.members where id = current_setting('t.f')::uuid), true);
update public.chain_config set platform_wallet = '0x' || lpad('f00', 40, '0') where chain_id in (59141, 59144);

-- ===== schema / privileges =====
select ok((select relrowsecurity from pg_class where oid = 'public.dao_ledger'::regclass), 'RLS on dao_ledger');
select ok((select relrowsecurity from pg_class where oid = 'public.dao_state'::regclass), 'RLS on dao_state');
select ok((select relrowsecurity from pg_class where oid = 'public.dao_positions'::regclass), 'RLS on dao_positions');
select ok(not has_table_privilege('authenticated', 'public.dao_ledger', 'select')
      and not has_table_privilege('authenticated', 'public.dao_state', 'select')
      and not has_table_privilege('authenticated', 'public.dao_positions', 'select'), 'authenticated cannot select the ledger tables');
select ok(not has_table_privilege('authenticated', 'public.dao_ledger', 'insert')
      and not has_table_privilege('authenticated', 'public.dao_state', 'update')
      and not has_table_privilege('authenticated', 'public.dao_positions', 'delete'), 'authenticated cannot write the ledger tables');
select ok(not has_table_privilege('anon', 'public.dao_ledger', 'select')
      and not has_table_privilege('anon', 'public.dao_state', 'select')
      and not has_table_privilege('anon', 'public.dao_positions', 'select'), 'anon cannot select the ledger tables');
select is((select count(*)::int from public.dao_state where total_shares = 0 and value_usdc = 0 and chain_id in (59144, 59141)),
  2, 'dao_state is seeded with zeros for both chains');
select ok(not has_function_privilege('authenticated', 'public.record_donation(uuid,jsonb,jsonb)', 'execute'), 'authenticated cannot record_donation');
select ok(not has_function_privilege('authenticated', 'public.credit_donation(uuid,numeric,bigint,numeric)', 'execute'), 'authenticated cannot credit_donation');
select ok(not has_function_privilege('authenticated', 'public.revert_donation(uuid)', 'execute'), 'authenticated cannot revert_donation');
select ok(not has_function_privilege('anon', 'public.credit_donation(uuid,numeric,bigint,numeric)', 'execute'), 'anon cannot credit_donation');
select ok(not has_function_privilege('anon', 'public.record_donation(uuid,jsonb,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.revert_donation(uuid)', 'execute'), 'anon cannot record or revert donations');
select ok(not has_function_privilege('anon', 'public.dao_ranking(int)', 'execute')
      and not has_function_privilege('anon', 'public.dao_history(int)', 'execute')
      and not has_function_privilege('anon', 'public.set_dao_ranking_visible(boolean)', 'execute'), 'anon cannot call the read RPCs or the visibility toggle');
select ok(not has_function_privilege('authenticated', 'public._record_payment_transfers(public.payment_intents,jsonb,jsonb)', 'execute'), 'authenticated cannot call the internal recording helper');
select ok(has_function_privilege('service_role', 'public.record_donation(uuid,jsonb,jsonb)', 'execute')
      and has_function_privilege('service_role', 'public.credit_donation(uuid,numeric,bigint,numeric)', 'execute')
      and has_function_privilege('service_role', 'public.revert_donation(uuid)', 'execute'), 'service_role runs the donation pipeline');
select ok(has_function_privilege('authenticated', 'public.create_donation_intent(numeric,int,boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.dao_overview()', 'execute')
      and has_function_privilege('authenticated', 'public.dao_ranking(int)', 'execute')
      and has_function_privilege('authenticated', 'public.dao_history(int)', 'execute')
      and has_function_privilege('authenticated', 'public.set_dao_ranking_visible(boolean)', 'execute'), 'authenticated gets the member-facing RPCs');
select ok(not has_function_privilege('anon', 'public.create_donation_intent(numeric,int,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.dao_overview()', 'execute'), 'anon cannot call the member-facing RPCs');
select is((select dao_ranking_visible from public.members where id = current_setting('t.a')::uuid), false, 'members are anonymous in the ranking by default');

-- ===== donation intent =====
select tests.authenticate_as(current_setting('t.uf')::uuid);
select throws_ok($$select public.create_donation_intent(1000000, 0, true)$$, 'P0001', 'safe_not_configured', 'no Safe on the active chain');
select tests.clear_authentication();
update public.chain_config set safe_address = '0x' || lpad('5afe59141', 40, '0') where chain_id = 59141;
update public.chain_config set safe_address = '0x' || lpad('5afe59144', 40, '0') where chain_id = 59144;
select tests.authenticate_as(current_setting('t.uf')::uuid);
select throws_ok($$select public.create_donation_intent(999999, 0, true)$$, 'P0001', 'amount_out_of_range', 'below 1 USDC');
select throws_ok($$select public.create_donation_intent(1000000000001, 0, true)$$, 'P0001', 'amount_out_of_range', 'above 1000000 USDC');
select throws_ok($$select public.create_donation_intent(1000000.5, 0, true)$$, 'P0001', 'invalid_input', 'fractional base units');
select throws_ok($$select public.create_donation_intent(null, 0, true)$$, 'P0001', 'invalid_input', 'null amount');
select throws_ok($$select public.create_donation_intent(1000000, null, true)$$, 'P0001', 'invalid_input', 'null fee');
select throws_ok($$select public.create_donation_intent(1000000, 5001, true)$$, 'P0001', 'fee_out_of_range', 'fee above 50 %');
select tests.clear_authentication();
update public.app_config set value = '100'::jsonb where key = 'min_fee_bps';
select tests.authenticate_as(current_setting('t.uf')::uuid);
select throws_ok($$select public.create_donation_intent(1000000, 50, true)$$, 'P0001', 'fee_below_minimum', 'fee below the platform minimum');
select set_config('t.fi', public.create_donation_intent(1000001, 100, true)::text, true);
select tests.clear_authentication();
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
select is(current_setting('t.fi')::jsonb ->> 'recipientAddress', '0x' || lpad('5afe59141', 40, '0'), 'the recipient is the Safe of the active chain');
select is(current_setting('t.fi')::jsonb ->> 'feeAmount', '10001', 'the fee rounds up and sits on top');
select is(current_setting('t.fi')::jsonb ->> 'platformAddress', '0x' || lpad('f00', 40, '0'), 'the fee goes to the platform wallet');
select is(current_setting('t.fi')::jsonb ->> 'amount', '1000001', 'the amount is the donation, fee excluded');
select is((select token || ':' || purpose || ':' || target_type || ':' || anonymous::text || ':' || coalesce(recipient_member_id::text, 'null') || ':' || chain_id::text
           from public.payment_intents where id = (current_setting('t.fi')::jsonb ->> 'id')::uuid),
  'USDC:donation:dao:false:null:59141', 'the intent snapshot: USDC donation to the dao, not anonymous, no member recipient');
update public.chain_config set platform_wallet = null where chain_id = 59141;
select tests.authenticate_as(current_setting('t.uf')::uuid);
select throws_ok($$select public.create_donation_intent(1000000, 100, true)$$, 'P0001', 'platform_not_configured', 'fee > 0 needs the platform wallet');
select lives_ok($$select public.create_donation_intent(1000000, 0, true)$$, 'no fee needs no platform wallet');
select tests.clear_authentication();
update public.chain_config set platform_wallet = '0x' || lpad('f00', 40, '0') where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok($$select public.create_donation_intent(1000000, 0, true)$$, 'P0001', 'forbidden', 'a banned member cannot donate');
select tests.clear_authentication();
-- cap: f already holds 2 pending intents, 18 more reach 20
select tests.authenticate_as(current_setting('t.uf')::uuid);
select lives_ok($$select count(public.create_donation_intent(1000000, 0, true)) from generate_series(1, 18)$$, '20 pending intents are allowed');
select throws_ok($$select public.create_donation_intent(1000000, 0, true)$$, 'P0001', 'too_many_intents', 'the 21st pending intent is refused');
select tests.clear_authentication();

-- ===== two-phase crediting and the share math =====
-- a donates 10 USDC (first donor)
select set_config('t.ia', tests.mkdon(current_setting('t.ua')::uuid, 10000000, 1)::text, true);
select set_config('t.la', tests.rec(current_setting('t.ia')::uuid, 1, 100)::text, true);
select is((select status from public.dao_ledger where id = current_setting('t.la')::uuid), 'pending_finality', 'record_donation leaves the row pending_finality');
select is((select status from public.payment_intents where id = current_setting('t.ia')::uuid), 'confirmed', 'record_donation confirms the intent');
select is((select count(*)::int from public.onchain_transfers where intent_id = current_setting('t.ia')::uuid and role = 'main'), 1, 'record_donation claims the main transfer');
select is((select amount_usdc::text || ':' || block_number::text || ':' || chain_id::text || ':' || kind || ':' || (shares_delta is null)::text
           from public.dao_ledger where id = current_setting('t.la')::uuid), '10000000:100:59141:donation:true', 'the pending row carries the amount, block and chain, no shares yet');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is(public.dao_overview() ->> 'totalShares', '0', 'pending donations do not count in the state');
select is(jsonb_array_length(public.dao_overview() -> 'myPending'), 1, 'the donor sees the pending donation');
select is(public.dao_overview() -> 'myPending' -> 0 ->> 'amount', '10000000', 'pending donation amount as text');
select tests.clear_authentication();
select is(tests.rec(current_setting('t.ia')::uuid, 1, 100), current_setting('t.la')::uuid, 'record_donation is idempotent on a confirmed intent');
select is((select count(*)::int from public.dao_ledger), 1, 'no second ledger row from the retry');

select tests.cr(current_setting('t.la')::uuid);
select is((select shares_delta from public.dao_ledger where id = current_setting('t.la')::uuid), 10000000::numeric * 1000000000000, 'the first credit gives d * 10^12 shares');
select is((select status from public.dao_ledger where id = current_setting('t.la')::uuid), 'credited', 'credit_donation marks the row credited');
select is((select total_shares || ':' || value_usdc from public.dao_state where chain_id = 59141), '10000000000000000000:10000000', 'dao_state follows the first credit');
-- replay: a credit retry changes nothing
select tests.cr(current_setting('t.la')::uuid);
select is((select total_shares || ':' || value_usdc from public.dao_state where chain_id = 59141), '10000000000000000000:10000000', 'a second credit_donation is a no-op');
select is((select shares::text || ':' || net_contributed_usdc::text from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.a')::uuid),
  '10000000000000000000:10000000', 'the position is not double credited');

-- b donates 10 USDC: equal shares
select set_config('t.ib', tests.mkdon(current_setting('t.ub')::uuid, 10000000, 2)::text, true);
select set_config('t.lb', tests.rec(current_setting('t.ib')::uuid, 2, 101)::text, true);
select tests.cr(current_setting('t.lb')::uuid);
select is((select shares_delta from public.dao_ledger where id = current_setting('t.lb')::uuid), 10000000::numeric * 1000000000000, 'a second donor of the same amount gets equal shares');

-- c donates 1 USDC with a fee: floor(d * S / V), shares computed on the amount only
select set_config('t.s1', (select total_shares::text from public.dao_state where chain_id = 59141), true);
select set_config('t.v1', (select value_usdc::text from public.dao_state where chain_id = 59141), true);
select set_config('t.ic', tests.mkdon(current_setting('t.uc')::uuid, 1000000, 3, 100)::text, true);
select set_config('t.lc', tests.rec(current_setting('t.ic')::uuid, 3, 102, true)::text, true);
select is((select count(*)::int from public.onchain_transfers where intent_id = current_setting('t.ic')::uuid), 2, 'record_donation claims main and fee transfers');
select tests.cr(current_setting('t.lc')::uuid);
select is((select shares_delta from public.dao_ledger where id = current_setting('t.lc')::uuid),
  div(1000000::numeric * current_setting('t.s1')::numeric, current_setting('t.v1')::numeric), 'a later donor gets floor(d * S / V)');
select is((select total_shares from public.dao_state where chain_id = 59141),
  current_setting('t.s1')::numeric + div(1000000::numeric * current_setting('t.s1')::numeric, current_setting('t.v1')::numeric), 'S grows by the shares');
select is((select value_usdc from public.dao_state where chain_id = 59141), 21000000::numeric, 'V grows by the donation, never by the fee');

-- a huge donation, then a tiny one: no zero or absurd shares
select set_config('t.ih', tests.mkdon(current_setting('t.ua')::uuid, 1000000000000, 4)::text, true);
select set_config('t.lh', tests.rec(current_setting('t.ih')::uuid, 4, 103)::text, true);
select tests.cr(current_setting('t.lh')::uuid);
select set_config('t.s2', (select total_shares::text from public.dao_state where chain_id = 59141), true);
select set_config('t.v2', (select value_usdc::text from public.dao_state where chain_id = 59141), true);
select set_config('t.id', tests.mkdon(current_setting('t.ud')::uuid, 1000000, 5)::text, true);
select set_config('t.ld', tests.rec(current_setting('t.id')::uuid, 5, 104)::text, true);
select tests.cr(current_setting('t.ld')::uuid);
select ok((select shares_delta from public.dao_ledger where id = current_setting('t.ld')::uuid) > 0, 'a tiny donation after a huge one still gets shares');
select is((select shares_delta from public.dao_ledger where id = current_setting('t.ld')::uuid),
  div(1000000::numeric * current_setting('t.s2')::numeric, current_setting('t.v2')::numeric), 'the tiny donation follows floor(d * S / V)');
select is((select total_shares from public.dao_state where chain_id = 59141), (select sum(shares) from public.dao_positions where chain_id = 59141), 'S equals the sum of the positions');
select is((select value_usdc from public.dao_state where chain_id = 59141), (select sum(net_contributed_usdc) from public.dao_positions where chain_id = 59141), 'V equals the sum of the contributions');
select is((select net_contributed_usdc from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.a')::uuid), 1000010000000::numeric, 'a net contribution accumulates over two donations');
select is((select shares from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.a')::uuid),
  10000000::numeric * 1000000000000 + (select shares_delta from public.dao_ledger where id = current_setting('t.lh')::uuid), 'a position accumulates shares over two donations');

-- ===== replay protection =====
select set_config('t.ir1', tests.mkdon(current_setting('t.ub')::uuid, 1000000, 1)::text, true);   -- a's tx hash again
select throws_ok(format($$select tests.rec(%L::uuid, 1, 100)$$, current_setting('t.ir1')), 'P0001', 'tx_already_used', 'the same tx cannot be claimed by another donation');
select tests.clear_authentication();
select is((select count(*)::int from public.dao_ledger), 5, 'a replayed claim adds no ledger row');
select is((select total_shares::text || ':' || value_usdc::text from public.dao_state where chain_id = 59141),
  (current_setting('t.s2')::numeric + (select shares_delta from public.dao_ledger where id = current_setting('t.ld')::uuid))::text || ':' || (current_setting('t.v2')::numeric + 1000000)::text,
  'a replayed claim changes neither S nor V');
-- a tip tx cannot be claimed as a donation, and a donation tx cannot be claimed as a tip
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.it', public.create_tip_intent('profile', current_setting('t.c')::uuid, 'USDC', 1000000, 0, false)::text, true);
select public.attach_intent_tx((current_setting('t.it')::jsonb ->> 'id')::uuid, 'main', tests.hash(900));
select set_config('t.it2', public.create_tip_intent('profile', current_setting('t.c')::uuid, 'USDC', 1000000, 0, false)::text, true);
select public.attach_intent_tx((current_setting('t.it2')::jsonb ->> 'id')::uuid, 'main', tests.hash(2));   -- b's donation tx
select tests.clear_authentication();
set local role service_role;
select lives_ok(format($$select public.confirm_tip(%L::uuid, '{"txHash":"%s","logIndex":0,"blockNumber":105}'::jsonb, null)$$, current_setting('t.it')::jsonb ->> 'id', tests.hash(900)), 'a tip confirms normally');
select throws_ok(format($$select public.confirm_tip(%L::uuid, '{"txHash":"%s","logIndex":0,"blockNumber":105}'::jsonb, null)$$, current_setting('t.it2')::jsonb ->> 'id', tests.hash(2)),
  'P0001', 'tx_already_used', 'a donation tx cannot be re-claimed as a tip');
reset role;
select set_config('t.ir2', tests.mkdon(current_setting('t.ub')::uuid, 1000000, 900)::text, true);
select throws_ok(format($$select tests.rec(%L::uuid, 900, 105)$$, current_setting('t.ir2')), 'P0001', 'tx_already_used', 'a tip tx cannot be claimed as a donation');
select tests.clear_authentication();
select throws_ok(format($$select tests.rec(%L::uuid, 77, 105)$$, current_setting('t.ir2')), 'P0001', 'tx_mismatch', 'the claimed hash must be the attached one');
select tests.clear_authentication();
select throws_ok(format($$select tests.rec(%L::uuid, 900, 105)$$, current_setting('t.it')::jsonb ->> 'id'), 'P0001', 'not_found', 'a tip intent is not a donation');
select tests.clear_authentication();
select throws_ok($$select tests.rec(gen_random_uuid(), 1)$$, 'P0001', 'not_found', 'unknown intent');
select tests.clear_authentication();
select throws_ok($$select tests.cr(gen_random_uuid())$$, 'P0001', 'not_found', 'credit_donation on an unknown row');
select tests.clear_authentication();

-- expiry (F3b-R2): hashes signed before expiry still record, a hashless expired intent does not
select set_config('t.ix1', tests.mkdon(current_setting('t.ud')::uuid, 1000000, 31)::text, true);
update public.payment_intents set expires_at = now() - interval '1 hour', hashes_attached_at = now() - interval '2 hours'
  where id = current_setting('t.ix1')::uuid;
select lives_ok(format($$select tests.rec(%L::uuid, 31, 106)$$, current_setting('t.ix1')), 'a late claim of a pre-expiry payment records');
select set_config('t.ix2', tests.mkdon(current_setting('t.ud')::uuid, 1000000, 32)::text, true);
update public.payment_intents set expires_at = now() - interval '1 hour', hashes_attached_at = null where id = current_setting('t.ix2')::uuid;
select throws_ok(format($$select tests.rec(%L::uuid, 32, 106)$$, current_setting('t.ix2')), 'P0001', 'intent_expired', 'an expired intent without pre-expiry hashes is refused');
select tests.clear_authentication();
-- F3d-R2: the intent snapshot is the authority, a Safe changed after the intent does not strand the payment
select set_config('t.ix3', tests.mkdon(current_setting('t.ud')::uuid, 1000000, 33)::text, true);
update public.chain_config set safe_address = '0x' || lpad('dead', 40, '0') where chain_id = 59141;
select lives_ok(format($$select tests.rec(%L::uuid, 33, 106)$$, current_setting('t.ix3')), 'a payment to the Safe snapshotted in the intent records even if the Safe changed');
select tests.clear_authentication();
update public.chain_config set safe_address = '0x' || lpad('5afe59141', 40, '0') where chain_id = 59141;
select is((select status from public.dao_ledger where intent_id = current_setting('t.ix3')::uuid), 'pending_finality', 'and it is a pending ledger row');
-- F3d-R2 / M2: the finality gate block is the later of the main and fee blocks
select set_config('t.ix4', tests.mkdon(current_setting('t.ud')::uuid, 1000000, 34, 100)::text, true);
select tests.rec(current_setting('t.ix4')::uuid, 34, 100, true, 150);
select is((select block_number from public.dao_ledger where intent_id = current_setting('t.ix4')::uuid), 150::bigint, 'block_number is greatest(main block, fee block)');

-- ===== revert =====
select set_config('t.ir', tests.mkdon(current_setting('t.uc')::uuid, 2000000, 50, 100)::text, true);
select set_config('t.lr', tests.rec(current_setting('t.ir')::uuid, 50, 107, true)::text, true);
select is((select count(*)::int from public.onchain_transfers where intent_id = current_setting('t.ir')::uuid), 2, 'main and fee are claimed');
select tests.rv(current_setting('t.lr')::uuid);
select is((select status from public.dao_ledger where id = current_setting('t.lr')::uuid), 'reverted', 'revert_donation marks the row reverted');
select is((select count(*)::int from public.onchain_transfers where intent_id = current_setting('t.ir')::uuid), 0, 'revert_donation frees the transfer rows');
select throws_ok(format($$select tests.cr(%L::uuid)$$, current_setting('t.lr')), 'P0001', 'invalid_state', 'a reverted row cannot be credited');
select tests.clear_authentication();
select lives_ok(format($$select tests.rv(%L::uuid)$$, current_setting('t.lr')), 'reverting twice is a no-op');
select throws_ok(format($$select tests.rv(%L::uuid)$$, current_setting('t.la')), 'P0001', 'invalid_state', 'a credited row cannot be reverted');
select tests.clear_authentication();
select is((select total_shares::text from public.dao_state where chain_id = 59141),
  (select sum(shares)::text from public.dao_positions where chain_id = 59141), 'the revert never touched the state');
-- the freed transfer can be claimed again by a corrected intent
select set_config('t.ir3', tests.mkdon(current_setting('t.uc')::uuid, 2000000, 50)::text, true);
select lives_ok(format($$select tests.rec(%L::uuid, 50, 108)$$, current_setting('t.ir3')), 'a corrected claim of the freed tx records');

-- ===== per chain =====
select set_config('t.s59141', (select total_shares::text from public.dao_state where chain_id = 59141), true);
select set_config('t.v59141', (select value_usdc::text from public.dao_state where chain_id = 59141), true);
update public.app_config set value = '59144'::jsonb where key = 'active_chain_id';
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is(public.dao_overview() ->> 'chainId', '59144', 'dao_overview follows the active chain');
select is(public.dao_overview() ->> 'myShares', '0', 'testnet shares do not show on the other chain');
select is((select count(*)::int from public.dao_ranking(50)), 0, 'the ranking of a fresh chain is empty');
select set_config('t.im', public.create_donation_intent(5000000, 0, true)::text, true);
select is(current_setting('t.im')::jsonb ->> 'recipientAddress', '0x' || lpad('5afe59144', 40, '0'), 'the intent targets the Safe of the new active chain');
select public.attach_intent_tx((current_setting('t.im')::jsonb ->> 'id')::uuid, 'main', tests.hash(60));
select tests.clear_authentication();
select set_config('t.lm', tests.rec((current_setting('t.im')::jsonb ->> 'id')::uuid, 60, 200)::text, true);
select tests.cr(current_setting('t.lm')::uuid);
select is((select chain_id from public.dao_ledger where id = current_setting('t.lm')::uuid), 59144, 'the ledger row carries the intent chain');
select is((select total_shares::text || ':' || value_usdc::text from public.dao_state where chain_id = 59144), '5000000000000000000:5000000', 'chain 59144 has its own state');
select is((select total_shares::text || ':' || value_usdc::text from public.dao_state where chain_id = 59141), current_setting('t.s59141') || ':' || current_setting('t.v59141'), 'crediting on 59144 does not move 59141');
select is((select count(*)::int from public.dao_positions where chain_id = 59144), 1, 'only the 59144 donor has a 59144 position');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is(public.dao_overview() ->> 'myShareBps', '10000', 'the sole donor of 59144 holds 100 %');
select is((select count(*)::int from public.dao_history(50)), 1, 'the history is per chain');
select tests.clear_authentication();
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is(public.dao_overview() ->> 'totalShares', current_setting('t.s59141'), 'back on 59141 the overview shows the 59141 ledger');
select tests.clear_authentication();

-- ===== reads and anonymity =====
select tests.authenticate_as(current_setting('t.uc')::uuid);
select is(public.dao_overview() ->> 'donors', '4', 'donors counts the members with shares on the chain');
select is(public.dao_overview() ->> 'valueUsdc', current_setting('t.v59141'), 'valueUsdc as text');
select cmp_ok((select coalesce(sum(share_bps), 0)::int from public.dao_ranking(100)), '<=', 10000, 'the bps sum to at most 10000');
select is((select count(*)::int from public.dao_ranking(1)), 1, 'p_limit caps the ranking');
select is((select rank from public.dao_ranking(50) order by rank limit 1), 1, 'the ranking starts at 1');
select is((select count(*)::int from public.dao_ranking(50) where member_id is not null), 1, 'a viewer only sees themself unmasked');
select is((select label from public.dao_ranking(50) where member_id = current_setting('t.c')::uuid),
  (select '@' || left(wallet_address, 6) || '…' || right(wallet_address, 4) from public.members where id = current_setting('t.c')::uuid), 'the caller sees themself with the @ label rule');
select is((select count(*)::int from public.dao_ranking(50) where member_id is null and label = 'Anónimo'), 3, 'hidden members show as Anónimo with no member_id');
select is((select count(*)::int from public.dao_history(50) where member_id is not null), 1, 'history masks hidden donors but not the caller');
select is((select count(*)::int from public.dao_history(50)), 5, 'history lists the credited donations only');
select is((select count(*)::int from public.dao_history(50) where tx_hash is not null), 1, 'F3d-R3: history hides the tx hash of masked donors');
select is((select tx_hash from public.dao_history(50) where member_id = current_setting('t.c')::uuid), tests.hash(3), 'but the donor sees their own hash');
select is((select ledger_id from public.dao_history(50) limit 1), current_setting('t.ld')::uuid, 'history is newest first');
select is((select amount::text from public.dao_history(50) limit 1), '1000000', 'history amounts');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($$select public.set_dao_ranking_visible(true)$$, 'a member opts in to the ranking');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ud')::uuid);
select is((select label from public.dao_ranking(50) where label = '@author1'), '@author1', 'a visible member shows with the @handle label');
select is((select member_id from public.dao_ranking(50) where label = '@author1'), current_setting('t.a')::uuid, 'and with their member_id');
select is((select count(*)::int from public.dao_history(50) where label = '@author1'), 2, 'visible donors show in the history');
select is((select count(*)::int from public.dao_history(50) where label = '@author1' and tx_hash is not null), 2, 'and their hash is public');
select throws_ok($$select public.set_dao_ranking_visible(null)$$, 'P0001', 'invalid_input', 'null is not a visibility');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok($$select public.set_dao_ranking_visible(true)$$, 'P0001', 'forbidden', 'a banned member cannot toggle');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select label from public.dao_ranking(50) where member_id = current_setting('t.b')::uuid), '@second2', 'a hidden member still sees themself');
select is((select label from public.dao_history(50) where member_id = current_setting('t.b')::uuid), '@second2', 'and in the history');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select ok(not exists (select 1 from public.dao_ranking(50) r where r.label = '@second2'), 'others never see a hidden label');
select tests.clear_authentication();

-- ===== F3d-R3: anonymous tips never leak their tx hash =====
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.cat', tests.create_channel(null, 'category', 'T800cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't800')::text, true);
select tests.authenticate_as(current_setting('t.uc')::uuid);
select set_config('t.msg', public.post_message(current_setting('t.ch')::uuid,
  jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
    'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'hola'))))), 'x', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.ta', public.create_tip_intent('message', current_setting('t.msg')::uuid, 'USDC', 1000000, 0, true)::text, true);
select public.attach_intent_tx((current_setting('t.ta')::jsonb ->> 'id')::uuid, 'main', tests.hash(800));
select set_config('t.tb', public.create_tip_intent('message', current_setting('t.msg')::uuid, 'USDC', 1000000, 0, false)::text, true);
select public.attach_intent_tx((current_setting('t.tb')::jsonb ->> 'id')::uuid, 'main', tests.hash(801));
select tests.clear_authentication();
set local role service_role;
select set_config('t.tipa', public.confirm_tip((current_setting('t.ta')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(800), 'logIndex', 0, 'blockNumber', 300), null)::text, true);
select set_config('t.tipb', public.confirm_tip((current_setting('t.tb')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(801), 'logIndex', 0, 'blockNumber', 301), null)::text, true);
reset role;
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select main_tx_hash from public.message_tips(current_setting('t.msg')::uuid) where tip_id = current_setting('t.tipa')::uuid), null, 'message_tips hides the hash of an anonymous tip');
select is((select main_tx_hash from public.message_tips(current_setting('t.msg')::uuid) where tip_id = current_setting('t.tipb')::uuid), tests.hash(801), 'message_tips keeps the hash of a public tip');
select is((select main_tx_hash from public.member_tips(current_setting('t.c')::uuid) where tip_id = current_setting('t.tipa')::uuid), null, 'member_tips hides the hash of an anonymous tip');
select is((select main_tx_hash from public.member_tips(current_setting('t.c')::uuid) where tip_id = current_setting('t.tipb')::uuid), tests.hash(801), 'member_tips keeps the hash of a public tip');
select is((select main_tx_hash from public.tips_by_ids(array[current_setting('t.tipa')::uuid]) ), null, 'tips_by_ids hides the hash of an anonymous tip');
select is((select main_tx_hash from public.tips_by_ids(array[current_setting('t.tipb')::uuid]) ), tests.hash(801), 'tips_by_ids keeps the hash of a public tip');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select main_tx_hash from public.message_tips(current_setting('t.msg')::uuid) where tip_id = current_setting('t.tipa')::uuid), tests.hash(800), 'the donor sees their own anonymous hash in message_tips');
select is((select main_tx_hash from public.member_tips(current_setting('t.c')::uuid) where tip_id = current_setting('t.tipa')::uuid), tests.hash(800), 'and in member_tips');
select is((select main_tx_hash from public.tips_by_ids(array[current_setting('t.tipa')::uuid])), tests.hash(800), 'and in tips_by_ids');
select tests.clear_authentication();

-- ===== M1: a half-empty state is refused, not guessed =====
update public.dao_state set value_usdc = 0 where chain_id = 59141;
select throws_ok(format($$select tests.cr(%L::uuid)$$, (select id from public.dao_ledger where intent_id = current_setting('t.ix1')::uuid)),
  'P0001', 'invalid_state', 'credit_donation refuses S > 0 with V = 0');
select tests.clear_authentication();

select * from finish();
rollback;
