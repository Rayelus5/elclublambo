-- F4a Task 1: market-value (NAV) share issuance, the club fund and hourly NAV snapshots.
begin;
select plan(82);

-- ===== helpers (rolled back with the test) =====
create function tests.nh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- a pending_finality donation of p_amount on the active chain, by p_user, paid in tx p_n
create function tests.npend(p_user uuid, p_amount numeric, p_n int)
returns uuid language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.nh(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_id := public.record_donation((v ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.nh(p_n), 'logIndex', 0, 'blockNumber', 100), null);
  reset role;
  return v_id;
end;
$$;
create function tests.ncr(p_ledger uuid, p_assets numeric) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.credit_donation(p_ledger, p_assets);
  reset role;
  return v;
end;
$$;
create function tests.nsnap(p_chain int, p_snap jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_nav_snapshot(p_chain, p_snap);
  reset role;
  return v;
end;
$$;
create function tests.nliab(p_chain int) returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_liabilities_usd6(p_chain);
  reset role;
  return v;
end;
$$;
-- a snapshot payload; assetsUsd6 = usdc + (eth + weth) * price / 10^20 unless p_assets overrides it
create function tests.njs(p_usdc numeric, p_eth numeric default 0, p_weth numeric default 0,
                          p_price numeric default 200000000000, p_assets text default null,
                          p_source text default 'chainlink')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'usdcUnits', p_usdc::text, 'ethWei', p_eth::text, 'wethWei', p_weth::text, 'ethPriceE8', p_price::text,
    'priceSource', p_source, 'blockNumber', '12345',
    'assetsUsd6', coalesce(p_assets, (p_usdc + div((p_eth + p_weth) * p_price, 100000000000000000000))::text))
$$;
create function tests.st(p_chain int) returns text language sql as $$
  select total_shares::text || ':' || club_shares::text || ':' || value_usdc::text from public.dao_state where chain_id = p_chain
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9100', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9101', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9102', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
update public.chain_config set safe_address = '0x' || lpad('5afe59141', 40, '0') where chain_id = 59141;
update public.chain_config set safe_address = '0x' || lpad('5afe59144', 40, '0') where chain_id = 59144;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';

-- ===== 1. signatures and privileges =====
select has_function('public', 'credit_donation', array['uuid', 'numeric'], 'credit_donation(uuid, numeric) exists');
select hasnt_function('public', 'credit_donation', array['uuid'], 'the one-argument credit_donation is dropped');
select ok(not has_function_privilege('authenticated', 'public.credit_donation(uuid,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.credit_donation(uuid,numeric)', 'execute'), 'members cannot credit_donation');
select ok(not has_function_privilege('authenticated', 'public.record_nav_snapshot(int,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.record_nav_snapshot(int,jsonb)', 'execute'), 'members cannot record_nav_snapshot');
select ok(not has_function_privilege('authenticated', 'public._dao_liabilities_usd6(int)', 'execute')
      and not has_function_privilege('anon', 'public._dao_liabilities_usd6(int)', 'execute'), 'members cannot read _dao_liabilities_usd6');
select ok(has_function_privilege('service_role', 'public.credit_donation(uuid,numeric)', 'execute')
      and has_function_privilege('service_role', 'public.record_nav_snapshot(int,jsonb)', 'execute')
      and has_function_privilege('service_role', 'public._dao_liabilities_usd6(int)', 'execute'), 'service_role runs the NAV pipeline');
select ok(has_function_privilege('authenticated', 'public.dao_nav_history(text)', 'execute')
      and not has_function_privilege('anon', 'public.dao_nav_history(text)', 'execute'), 'dao_nav_history is for members only');
select ok((select relrowsecurity from pg_class where oid = 'public.dao_nav_snapshots'::regclass)
      and not has_table_privilege('authenticated', 'public.dao_nav_snapshots', 'select')
      and not has_table_privilege('anon', 'public.dao_nav_snapshots', 'select'), 'dao_nav_snapshots has RLS and no client access');
select is((select count(*)::int from public.dao_state where club_shares = 0 and not nav_initialized and nav_at is null), 2,
  'dao_state gains club_shares, nav_initialized and nav_at');

-- ===== 2. empty fund (59141): S = 0, nothing else in the Safe =====
select set_config('t.l1', tests.npend(current_setting('t.ua')::uuid, 10000000, 1)::text, true);
select is(tests.nliab(59141), 10000000::numeric, 'a pending donation is a liability');
select set_config('t.r1', tests.ncr(current_setting('t.l1')::uuid, 10000000)::text, true);
select is(current_setting('t.r1')::jsonb ->> 'shares', (10000000::numeric * 1000000000000)::text, 'the first donor gets d * 10^12 shares');
select is(current_setting('t.r1')::jsonb ->> 'clubMinted', '0', 'nothing for the club when the Safe held only the donation');
select is(tests.st(59141), '10000000000000000000:0:10000000', 'dao_state: S = shares, value_usdc = NAV after the credit');
select ok((select nav_initialized and nav_at is not null from public.dao_state where chain_id = 59141), 'a credit is a valuation');
select is(tests.nliab(59141), 0::numeric, 'a credited donation is no longer a liability');
select is(tests.ncr(current_setting('t.l1')::uuid, 999)::text, '{"shares": "10000000000000000000", "clubMinted": "0"}',
  'a credited row returns its stored shares (idempotent)');
select is(tests.st(59141), '10000000000000000000:0:10000000', 'the replay changes nothing');

-- ===== 3. the club fund on an empty chain (59144): the Safe already holds 1 USDC =====
update public.app_config set value = '59144'::jsonb where key = 'active_chain_id';
select set_config('t.l2', tests.npend(current_setting('t.ub')::uuid, 4000000, 2)::text, true);
select set_config('t.r2', tests.ncr(current_setting('t.l2')::uuid, 1000000 + 4000000)::text, true);
select is(current_setting('t.r2')::jsonb ->> 'clubMinted', (1000000::numeric * 1000000000000)::text, 'the club fund owns what the Safe held before');
select is(current_setting('t.r2')::jsonb ->> 'shares', (4000000::numeric * 1000000000000)::text, 'the first donor gets exactly d * 10^12');
select is(tests.st(59144), '5000000000000000000:1000000000000000000:5000000', 'club shares count in total_shares');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is(public.dao_overview() ->> 'myShareBps', '8000', 'the donor holds 8000 bps');
select is((select share_bps from public.dao_ranking(50) where label = 'Fondo del club'), 2000, 'the club holds 2000 bps');
select is(public.dao_overview() -> 'composition', 'null'::jsonb, 'no snapshot yet: composition is null');
select is(public.dao_overview() ->> 'sharePriceUsd6', '1000000', 'a fresh fund prices one participación at 1 USD');
select tests.clear_authentication();

-- ===== 4. issuance at NAV =====
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 20000000, nav_initialized = true
  where chain_id = 59144;
select set_config('t.l3', tests.npend(current_setting('t.uc')::uuid, 10000000, 3)::text, true);
select set_config('t.r3', tests.ncr(current_setting('t.l3')::uuid, 20000000 + 10000000)::text, true);
select is(current_setting('t.r3')::jsonb ->> 'shares', '5000000000000000000', 'shares = floor(d * S / NAV_previo)');
select is(current_setting('t.r3')::jsonb ->> 'clubMinted', '0', 'no club mint once S > 0');
select is(tests.st(59144), '15000000000000000000:0:30000000', 'S and NAV grow by the donation');

-- ===== 5. two pending donations: both are liabilities =====
select set_config('t.l4', tests.npend(current_setting('t.ua')::uuid, 2000000, 4)::text, true);
select set_config('t.l5', tests.npend(current_setting('t.ub')::uuid, 3000000, 5)::text, true);
select is(tests.nliab(59144), 5000000::numeric, 'both pending donations are liabilities');
select is(tests.ncr(current_setting('t.l4')::uuid, 30000000 + 2000000 + 3000000) ->> 'shares', '1000000000000000000',
  'the first is priced on NAV_previo with the other still a liability');
select is(tests.nliab(59144), 3000000::numeric, 'afterwards only the second is a liability');
select is(tests.ncr(current_setting('t.l5')::uuid, 30000000 + 2000000 + 3000000) ->> 'shares', '1500000000000000000',
  'the second is priced on the NAV after the first');
select is(tests.st(59144), '17500000000000000000:0:35000000', 'state after both credits');

-- ===== 6. zero shares =====
update public.dao_state set total_shares = 1, value_usdc = 1000000000000 where chain_id = 59144;
select set_config('t.l6', tests.npend(current_setting('t.uc')::uuid, 1000000, 6)::text, true);
select throws_ok(format($$select tests.ncr(%L::uuid, %s)$$, current_setting('t.l6'), 1000000000000 + 1000000),
  'P0001', 'shares_zero', 'a donation worth 0 shares is not credited');
select tests.clear_authentication();
select is((select status from public.dao_ledger where id = current_setting('t.l6')::uuid), 'pending_finality', 'and stays pending for review');
select is(tests.st(59144), '1:0:1000000000000', 'nothing was written');

-- ===== 7. negative NAV =====
select throws_ok(format($$select tests.ncr(%L::uuid, 500000)$$, current_setting('t.l6')),
  'P0001', 'invalid_state', 'assets below the liabilities with S > 0 is refused');
select tests.clear_authentication();
select is(tests.st(59144), '1:0:1000000000000', 'nothing was written');
select throws_ok(format($$select tests.ncr(%L::uuid, -1)$$, current_setting('t.l6')), 'P0001', 'invalid_input', 'negative assets');
select tests.clear_authentication();
select throws_ok(format($$select tests.ncr(%L::uuid, 1.5)$$, current_setting('t.l6')), 'P0001', 'invalid_input', 'fractional assets');
select tests.clear_authentication();
select throws_ok(format($$select tests.ncr(%L::uuid, null)$$, current_setting('t.l6')), 'P0001', 'invalid_input', 'null assets');
select tests.clear_authentication();
select throws_ok($$select tests.ncr(gen_random_uuid(), 1)$$, 'P0001', 'not_found', 'unknown ledger row');
select tests.clear_authentication();

-- ===== 7b. a credit that is the first valuation of an F3 ledger behaves like a snapshot then a credit =====
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 10000000, nav_initialized = false
  where chain_id = 59144;
select set_config('t.r6', tests.ncr(current_setting('t.l6')::uuid, 12000000 + 1000000)::text, true);
select is(current_setting('t.r6')::jsonb ->> 'clubMinted', '2000000000000000000', 'the excess over the ledger value goes to the club');
select is(current_setting('t.r6')::jsonb ->> 'shares', '1000000000000000000', 'the donor is priced as at the ledger price (d * S / V)');
select is(tests.st(59144) || ':' || (select nav_initialized::text from public.dao_state where chain_id = 59144),
  '13000000000000000000:2000000000000000000:13000000:true', 'the chain is initialized by the credit');

-- ===== 8. snapshot (59141: S = 10e18, NAV 10 USDC, plus a 2 USDC pending donation) =====
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
select set_config('t.l7', tests.npend(current_setting('t.ua')::uuid, 2000000, 7)::text, true);
-- 13 USDC + 0.001 ETH at 2000 USD = 15 USDC of assets; minus 2 USDC pending = 13 USDC
select set_config('t.s1', tests.nsnap(59141, tests.njs(13000000, 1000000000000000))::text, true);
select is(current_setting('t.s1')::jsonb ->> 'skipped', 'false', 'the first snapshot is recorded');
select is(current_setting('t.s1')::jsonb ->> 'navUsd6', '13000000', 'navUsd6 = assets - liabilities');
select is(current_setting('t.s1')::jsonb ->> 'clubMinted', '0', 'an initialized chain mints nothing on a snapshot');
select is((select assets_usd6::text || ':' || liabilities_usd6::text || ':' || nav_usd6::text || ':' || total_shares::text || ':'
                  || usdc_units::text || ':' || eth_wei::text || ':' || weth_wei::text || ':' || eth_price_e8::text || ':'
                  || price_source || ':' || block_number::text
           from public.dao_nav_snapshots where id = (current_setting('t.s1')::jsonb ->> 'id')::uuid),
  '15000000:2000000:13000000:10000000000000000000:13000000:1000000000000000:0:200000000000:chainlink:12345',
  'the snapshot row stores the composition, the liabilities and the NAV');
select is(tests.st(59141), '10000000000000000000:0:13000000', 'value_usdc caches the NAV');
select ok((select nav_at is not null from public.dao_state where chain_id = 59141), 'nav_at is set');
select is(tests.nsnap(59141, tests.njs(20000000)) ->> 'skipped', 'true', 'a second snapshot within 55 minutes is skipped');
select is((select count(*)::int from public.dao_nav_snapshots where chain_id = 59141), 1, 'and inserts nothing');
select is(tests.st(59141), '10000000000000000000:0:13000000', 'and leaves the NAV alone');
select throws_ok($$select tests.nsnap(59141, tests.njs(13000000, 0, 0, 200000000000, '-1'))$$, 'P0001', 'invalid_input', 'negative assets are refused');
select tests.clear_authentication();
select throws_ok($$select tests.nsnap(59141, tests.njs(13000000, 0, 0, 200000000000, '14000000'))$$, 'P0001', 'invalid_input',
  'assets that do not match the composition are refused');
select tests.clear_authentication();
select throws_ok($$select tests.nsnap(59141, tests.njs(13000000, 0, 0, 200000000000, null, 'oracle'))$$, 'P0001', 'invalid_input', 'unknown price source');
select tests.clear_authentication();
select throws_ok($$select tests.nsnap(59141, tests.njs(13000000) - 'blockNumber')$$, 'P0001', 'invalid_input', 'a missing key');
select tests.clear_authentication();
select throws_ok($$select tests.nsnap(1, tests.njs(13000000))$$, 'P0001', 'chain_invalid', 'unknown chain');
select tests.clear_authentication();

-- ===== 9. first valuation of a chain with an F3 ledger =====
update public.dao_state set nav_initialized = false, value_usdc = 10000000 where chain_id = 59141;
update public.dao_nav_snapshots set taken_at = taken_at - interval '1 hour' where chain_id = 59141;
-- 14 USDC in the Safe - 2 USDC pending = NAV 12 USDC against a ledger value of 10 USDC
select set_config('t.s2', tests.nsnap(59141, tests.njs(14000000))::text, true);
select is(current_setting('t.s2')::jsonb ->> 'clubMinted', '2000000000000000000', 'the excess goes to the club at the ledger price');
select is(tests.st(59141), '12000000000000000000:2000000000000000000:12000000', 'club shares join total_shares');
select ok((select nav_initialized from public.dao_state where chain_id = 59141), 'the chain is now initialized');
select is((select total_shares::text from public.dao_nav_snapshots where id = (current_setting('t.s2')::jsonb ->> 'id')::uuid),
  '12000000000000000000', 'the snapshot stores S after the mint');
update public.dao_nav_snapshots set taken_at = taken_at - interval '1 hour' where chain_id = 59141;
select set_config('t.s3', tests.nsnap(59141, tests.njs(16000000))::text, true);
select is(current_setting('t.s3')::jsonb ->> 'clubMinted', '0', 'a later, higher NAV mints nothing');
select is(tests.st(59141), '12000000000000000000:2000000000000000000:14000000', 'only the NAV moves');

-- ===== 10. member reads =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is(public.dao_overview() ->> 'navUsd6', '14000000', 'navUsd6');
select ok(public.dao_overview() ->> 'navAt' is not null, 'navAt');
select is(public.dao_overview() ->> 'sharePriceUsd6', '1166666', 'sharePriceUsd6 = floor(NAV * 10^18 / S): one participación');
select is(public.dao_overview() ->> 'myValueUsd6', div(10000000000000000000::numeric * 14000000, 12000000000000000000)::text, 'myValueUsd6 = myShares * NAV / S');
select is(public.dao_overview() ->> 'clubShares', '2000000000000000000', 'clubShares');
select is(public.dao_overview() -> 'composition' ->> 'priceSource', 'chainlink', 'composition from the latest snapshot');
select is(public.dao_overview() -> 'composition' ->> 'usdcUnits', '16000000', 'composition is the latest snapshot');
select is(public.dao_overview() ->> 'valueUsdc', '14000000', 'valueUsdc is kept (the cached NAV)');
select is((select share_bps::text || ':' || net_usdc::text || ':' || rank::text || ':' || (member_id is null)::text
           from public.dao_ranking(50) where label = 'Fondo del club'), '1666:0:2:true', 'the club row: bps, net 0, ranked by shares');
select is((select rank from public.dao_ranking(50) where member_id = current_setting('t.a')::uuid), 1, 'the biggest holder ranks first');
select tests.clear_authentication();

-- ===== 11. NAV history =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select array_agg(taken_at) from public.dao_nav_history('7d')),
  (select array_agg(taken_at order by taken_at) from public.dao_nav_history('7d')), 'oldest first');
select is((select array_agg(nav_usd6) from public.dao_nav_history('7d')), array['13000000', '12000000', '14000000'], 'the 7d history lists the snapshots');
select is((select share_price_usd6 from public.dao_nav_history('24h') order by taken_at desc limit 1),
  '1166666', 'share price per point (per 10^18 shares)');
select throws_ok($$select * from public.dao_nav_history('1y')$$, 'P0001', 'invalid_input', 'an unknown range');
select tests.clear_authentication();
insert into public.dao_nav_snapshots (chain_id, taken_at, usdc_units, eth_wei, weth_wei, eth_price_e8, assets_usd6,
                                      liabilities_usd6, nav_usd6, total_shares, price_source, block_number)
select 59141, now() - interval '20 days' + g * interval '1 minute', 1, 0, 0, 1, 1, 0, 1, 1, 'chainlink', g
from generate_series(1, 1200) g;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select cmp_ok((select count(*)::int from public.dao_nav_history('all')), '<=', 500, 'at most 500 points');
select cmp_ok((select count(*)::int from public.dao_nav_history('all')), '>=', 400, 'evenly thinned, not truncated');
select is((select nav_usd6 from public.dao_nav_history('all') order by taken_at desc limit 1), '14000000', 'the newest point is always kept');
select tests.clear_authentication();
update public.app_config set value = '59144'::jsonb where key = 'active_chain_id';
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select count(*)::int from public.dao_nav_history('all')), 0, 'history is per chain');
select tests.clear_authentication();

select * from finish();
rollback;
