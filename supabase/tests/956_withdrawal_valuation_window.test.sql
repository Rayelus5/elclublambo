-- F4c final review C1/I1, ruling F4c-R7 (migration 20261019300007): no valuation counts an approved withdrawal as a
-- liability once its payout left the Safe in the assets being valued.
--   (a) while the chain has approved, unpaid requests, credit_donation / quote / approve / record_nav_snapshot refuse
--       (assets_stale) a Safe read at a block past the scan cursor; dao_valuation_cap tells the server which block to
--       read at;
--   (b) _dao_liabilities_usd6(B) leaves out an approved request whose linked payout candidate (inside its window) is
--       at or before B.
-- Worked example of the review: NAV 1000 USDC, A's 400 USDC withdrawal paid on chain at block 110 but not recorded yet.
-- Without the fix a 100 USDC donation in that window got 3x the fair shares and the next approval 1/3 of its value.
begin;
select plan(51);

-- ===== helpers (rolled back with the test) =====
create function tests.zh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.zsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.zw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.zpend(p_user uuid, p_amount numeric, p_n int, p_block bigint)
returns uuid language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.zh(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_id := public.record_donation((v ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.zh(p_n), 'logIndex', 0, 'blockNumber', p_block), null);
  reset role;
  return v_id;
end;
$$;
create function tests.zcredit(p_ledger uuid, p_assets numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.credit_donation(p_ledger, p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.zquote(p_req uuid, p_assets numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.quote_withdrawal(p_req, tests.zsafe(), p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.za(p_req uuid, p_assets numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.approve_withdrawal(p_req, current_setting('t.t')::uuid, tests.zsafe(), p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.zliab(p_block bigint) returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_liabilities_usd6(59141, p_block);
  reset role;
  return v;
end;
$$;
create function tests.zcap() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.dao_valuation_cap(59141);
  reset role;
  return v;
end;
$$;
-- a snapshot of p_usdc USDC (no ETH) read at p_block; the 55-minute throttle is bypassed by ageing the last one
create function tests.zsnap(p_usdc numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  update public.dao_nav_snapshots set taken_at = taken_at - interval '1 hour' where chain_id = 59141;
  set local role service_role;
  v := public.record_nav_snapshot(59141, tests.zsafe(), jsonb_build_object(
    'usdcUnits', p_usdc::text, 'ethWei', '0', 'wethWei', '0', 'ethPriceE8', '200000000000',
    'priceSource', 'chainlink', 'blockNumber', p_block::text, 'assetsUsd6', p_usdc::text));
  reset role;
  return v;
end;
$$;
create function tests.zprice() returns text language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(current_setting('t.ut')::uuid);
  v := public.dao_overview();
  perform tests.clear_authentication();
  return v ->> 'sharePriceUsd6';
end;
$$;
create function tests.zreq(p_user uuid, p_shares numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.request_withdrawal(p_shares);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.zstate() returns text language sql as $$
  select total_shares::text || ':' || approved_locked_shares::text || ':' || value_usdc::text
  from public.dao_state where chain_id = 59141
$$;
create function tests.zop(p_n int, p_amount numeric, p_to text, p_at timestamptz, p_block bigint) returns jsonb
language sql as $$
  select jsonb_build_object('txHash', tests.zh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out',
                            'amount', p_amount::text, 'counterparty', p_to, 'blockNumber', p_block,
                            'occurredAt', p_at)
$$;
create function tests.zops(p_ops jsonb, p_to_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_operations(59141, tests.zsafe(), p_ops, p_to_block);
  reset role;
  return v;
end;
$$;
create function tests.zpay(p_n int, p_block bigint, p_to text, p_amount numeric) returns jsonb language sql as $$
  select jsonb_build_object('txHash', tests.zh(p_n), 'logIndex', '0', 'blockNumber', p_block::text,
                            'blockTime', now() + interval '1 minute', 'to', p_to, 'amount', p_amount::text)
$$;
create function tests.zrec(p_req uuid, p_payout jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_withdrawal_payout(p_req, tests.zsafe(), p_payout, null);
  reset role;
  return v;
end;
$$;
create function tests.zrev(p_req uuid) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.revert_withdrawal_payout(p_req);
  reset role;
end;
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9560', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9561', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9562', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('f9563', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9564', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T956 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T956 tesorero';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.ud', (select auth_user_id::text from public.members where id = current_setting('t.d')::uuid), true);
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);

update public.chain_config set safe_address = '0x' || lpad('5afe95601', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
delete from public.dao_scan_state where chain_id = 59141;
-- A 400, B 300, C 300 (x 10^18): S = 1000 * 10^18 valued at 1000 USDC
update public.dao_state set total_shares = 1000000000000000000000, club_shares = 0, value_usdc = 1000000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 400000000000000000000, 400000000),
  (59141, current_setting('t.b')::uuid, 300000000000000000000, 300000000),
  (59141, current_setting('t.c')::uuid, 300000000000000000000, 300000000);
select set_config('t.p0', tests.zprice(), true);

-- ===== 1. grants and the cap read =====
select ok(has_function_privilege('service_role', 'public.dao_valuation_cap(int)', 'execute')
      and not has_function_privilege('authenticated', 'public.dao_valuation_cap(int)', 'execute')
      and not has_function_privilege('anon', 'public.dao_valuation_cap(int)', 'execute'),
  'dao_valuation_cap is service-only');
select ok(not has_function_privilege('authenticated', 'public._dao_assets_covered(int,bigint)', 'execute')
      and not has_function_privilege('anon', 'public._dao_assets_covered(int,bigint)', 'execute'),
  '_dao_assets_covered is not callable by members');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.dao_valuation_cap(int)'::regprocedure,
                         'public._dao_assets_covered(int,bigint)'::regprocedure,
                         'public._dao_liabilities_usd6(int,bigint,numeric)'::regprocedure,
                         'public.credit_donation(uuid,numeric,bigint,numeric)'::regprocedure,
                         'public.record_nav_snapshot(int,text,jsonb)'::regprocedure,
                         'public._withdrawal_valuation(public.withdrawal_requests,text,numeric,bigint,boolean,numeric)'::regprocedure,
                         'public.withdrawals_awaiting_finality(int)'::regprocedure,
                         'public.treasury_withdrawals()'::regprocedure)),
  'the new and replaced functions are definer with an empty search_path');
select is(tests.zcap(), jsonb_build_object('capped', false, 'block', null),
  'no approved, unpaid request: the server may read the Safe at the latest block');

-- the scan has covered block 100; A asks for all of it and is approved at 400 USDC (400 * 1000 / 1000)
select tests.zops('[]'::jsonb, 100);
select set_config('t.ra', tests.zreq(current_setting('t.ua')::uuid, 400000000000000000000)::text, true);
select is(tests.za(current_setting('t.ra')::uuid, 1000000000, 100) ->> 'amountUsdc', '400000000', 'A approved for 400 USDC');
select is(tests.zstate(), '1000000000000000000000:400000000000000000000:600000000', 'NAV 600 over S_eff 600');
select is(tests.zcap(), jsonb_build_object('capped', true, 'block', '100'),
  'an approved, unpaid request caps the valuation at the scan cursor');

-- ===== 2. (b) the Safe pays A at block 110; the scan links it (not recorded yet) =====
select is(tests.zops(jsonb_build_array(tests.zop(301, 400000000, tests.zw('a'), now() + interval '1 minute', 110)), 120),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'the payout to A is linked by the scan (cursor 120)');
select is((select payout_tx_hash from public.withdrawal_requests where id = current_setting('t.ra')::uuid), null,
  'the payout is not recorded yet');
select is(tests.zliab(109), 400000000::numeric, 'before the payout block A''s fixed amount is still a liability');
select is(tests.zliab(110), 0::numeric, 'from the linked payout''s block on it is not (the USDC left the Safe)');
select is(tests.zliab(120), 0::numeric, 'nor after it');
-- a link outside the payout window does not count as a payout
update public.dao_safe_operations set occurred_at = now() - interval '1 day' where tx_hash = tests.zh(301);
select is(tests.zliab(120), 400000000::numeric, 'a linked outflow outside the window leaves the liability in place');
update public.dao_safe_operations set occurred_at = now() + interval '1 minute' where tx_hash = tests.zh(301);

-- ===== 3. a donation credited in that window gets fair shares =====
-- D gave 100 USDC at block 115. Safe at 120: 1000 - 400 + 100 = 700. NAV before it: 700 - 100 = 600 over S_eff 600.
select set_config('t.l1', tests.zpend(current_setting('t.ud')::uuid, 100000000, 302, 115)::text, true);
select is(tests.zliab(120), 100000000::numeric, 'only the pending donation is a liability at 120');
select is(tests.zcredit(current_setting('t.l1')::uuid, 700000000, 120) ->> 'shares', '100000000000000000000',
  'the donation gets 100 shares (price 1), not 300');
select is(tests.zstate(), '1100000000000000000000:400000000000000000000:700000000', 'NAV 700 over S_eff 700');
select is(tests.zprice(), current_setting('t.p0'), 'the share price did not move');

-- ===== 4. a quote / approval of another request in that window is fair =====
select set_config('t.rb', tests.zreq(current_setting('t.ub')::uuid, 300000000000000000000)::text, true);
select is(tests.zquote(current_setting('t.rb')::uuid, 700000000, 120) ->> 'amountUsdc', '300000000',
  'B''s quote is 300 USDC (300 * 700 / 700), not 100');
select is(tests.zquote(current_setting('t.rb')::uuid, 700000000, 120) ->> 'navUsd6', '700000000', 'at NAV 700');
select is(tests.za(current_setting('t.rb')::uuid, 700000000, 120) ->> 'amountUsdc', '300000000', 'B approved for 300 USDC');
select is(tests.zstate(), '1100000000000000000000:700000000000000000000:400000000', 'NAV 400 over S_eff 400');
select is(tests.zprice(), current_setting('t.p0'), 'the share price did not move');
-- final review minor 5: the panel shows the destination snapshotted at approval, not the current wallet
update public.withdrawal_requests set destination_address = '0x' || lpad('de57956', 40, '0') where id = current_setting('t.rb')::uuid;
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select wallet from public.treasury_withdrawals() where id = current_setting('t.rb')::uuid), '0x' || lpad('de57956', 40, '0'),
  'treasury_withdrawals shows an approved row''s snapshotted destination');
select tests.clear_authentication();
update public.withdrawal_requests set destination_address = tests.zw('b') where id = current_setting('t.rb')::uuid;

-- ===== 5. the snapshot in that window has the right NAV =====
select is(tests.zsnap(700000000, 120) ->> 'navUsd6', '400000000', 'the snapshot at 120 values the fund at 400 (not 0)');
select is((select liabilities_usd6::text from public.dao_nav_snapshots where chain_id = 59141 order by taken_at desc limit 1),
  '300000000', 'its liabilities are only B''s unpaid 300');
select is(tests.zstate(), '1100000000000000000000:700000000000000000000:400000000', 'the cache is unchanged');
select is(tests.zprice(), current_setting('t.p0'), 'the share price did not move');

-- ===== 6. (a) a read past the scan cursor is refused while approved, unpaid requests exist =====
select set_config('t.rc', tests.zreq(current_setting('t.uc')::uuid, 300000000000000000000)::text, true);
select set_config('t.l2', tests.zpend(current_setting('t.ud')::uuid, 50000000, 303, 116)::text, true);
select throws_ok(format('select tests.zcredit(%L, 750000000, 121)', current_setting('t.l2')), 'assets_stale',
  'credit_donation refuses a read at 121 with the scan at 120');
select throws_ok(format('select tests.zquote(%L, 750000000, 121)', current_setting('t.rc')), 'assets_stale',
  'quote_withdrawal refuses it');
select throws_ok(format('select tests.za(%L, 750000000, 121)', current_setting('t.rc')), 'assets_stale',
  'approve_withdrawal refuses it');
select throws_ok('select tests.zsnap(750000000, 121)', 'assets_stale', 'record_nav_snapshot refuses it');
select is((select status from public.withdrawal_requests where id = current_setting('t.rc')::uuid), 'pending',
  'C stays pending');
select is(tests.zstate(), '1100000000000000000000:700000000000000000000:400000000', 'nothing moved');
-- the read at the cursor itself is fine (C: 300 * (750 - 300 - 50) / 400 = 300)
select is(tests.zquote(current_setting('t.rc')::uuid, 750000000, 120) ->> 'amountUsdc', '300000000',
  'a quote read at the scan cursor goes through');
-- without any scan cursor nothing can be trusted
delete from public.dao_scan_state where chain_id = 59141;
select is(tests.zcap(), jsonb_build_object('capped', true, 'block', null), 'no cursor: capped with no block to read at');
select throws_ok(format('select tests.zquote(%L, 750000000, 120)', current_setting('t.rc')), 'assets_stale',
  'and every valuation is refused');
select tests.zops('[]'::jsonb, 120);
select is(tests.zcap(), jsonb_build_object('capped', true, 'block', '120'), 'the cursor is back at 120');

-- ===== 7. record / revert after such a valuation keep the price =====
select is(tests.zrec(current_setting('t.ra')::uuid, tests.zpay(301, 110, tests.zw('a'), 400000000)) ->> 'status', 'recorded',
  'A''s payout is recorded');
select is(tests.zstate(), '1100000000000000000000:700000000000000000000:400000000', 'recording leaves the cache alone');
select is(tests.zprice(), current_setting('t.p0'), 'the share price did not move');
select is(tests.zliab(120), 350000000::numeric, 'at 120: B''s 300 and the pending 50');
set local role service_role;
select is((select payout_log_index from public.withdrawals_awaiting_finality(59141)
           where request_id = current_setting('t.ra')::uuid), 0,
  'withdrawals_awaiting_finality returns the recorded log (final review minor 1)');
reset role;
select tests.zrev(current_setting('t.ra')::uuid);
select is(tests.zstate(), '1100000000000000000000:700000000000000000000:400000000', 'a revert leaves the cache alone');
select is(tests.zprice(), current_setting('t.p0'), 'the share price did not move');
select is(tests.zliab(120), 750000000::numeric, 'a reverted payout (its link removed) is a liability again');
select is(tests.zrec(current_setting('t.ra')::uuid, tests.zpay(301, 110, tests.zw('a'), 400000000)) ->> 'status', 'recorded',
  'recorded again');

-- ===== 8. no approved, unpaid request left: reads at the latest block are fine again =====
select is(tests.zrec(current_setting('t.rb')::uuid, tests.zpay(304, 130, tests.zw('b'), 300000000)) ->> 'status', 'recorded',
  'B''s payout is recorded (block 130, past the cursor)');
select is(tests.zcap(), jsonb_build_object('capped', false, 'block', '120'), 'nothing approved and unpaid: no cap');
-- Safe at 500: 700 - 300 + 50 = 450; liabilities: the pending 50; NAV 400 over S_eff 400
select is(tests.zcredit(current_setting('t.l2')::uuid, 450000000, 500) ->> 'shares', '50000000000000000000',
  'a credit read at 500 (past the cursor) goes through at price 1');
select is(tests.zsnap(450000000, 500) ->> 'navUsd6', '450000000', 'and so does a snapshot');
select is(tests.zprice(), current_setting('t.p0'), 'the share price did not move');

select * from finish();
rollback;
