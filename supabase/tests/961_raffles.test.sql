-- F4d Task 2 (migration 20261019400002): raffles with a private seed commitment, the weighted switch per network,
-- create / cancel as fund liabilities, and prize liabilities valued at the caller's ETH price.
--   The secret seed lives in private.raffle_seeds: no API role (anon, authenticated, service_role) can use the schema.
--   Create lowers the cached value_usdc by exactly prize_value_usd6 and cancel adds it back, so the cached share price
--   always equals what a fresh valuation gives (no jump at the next snapshot); the prize counts once as a liability.
-- Setup: 59141 valued at 100 USDC for S = 100 * 10^18 (A 60, B 40), a snapshot at ETH = 3000 USD.
begin;
select plan(117);

-- ===== helpers (rolled back with the test) =====
create function tests.rh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.rsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.rcreate(p_user uuid, p_title text, p_token text, p_amount numeric,
                              p_closes timestamptz default now() + interval '1 day', p_mode text default 'equal')
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_raffle(p_title, p_token, p_amount, p_closes, p_mode);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.rcancel(p_user uuid, p_raffle uuid, p_reason text) returns void language plpgsql as $$
begin
  perform tests.authenticate_as(p_user);
  perform public.cancel_raffle(p_raffle, p_reason);
  perform tests.clear_authentication();
end;
$$;
create function tests.rliab(p_block bigint, p_price numeric default null) returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  if p_price is null then
    v := public._dao_liabilities_usd6(59141, p_block);
  else
    v := public._dao_liabilities_usd6(59141, p_block, p_price);
  end if;
  reset role;
  return v;
end;
$$;
create function tests.rprice() returns numeric language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(current_setting('t.ua')::uuid);
  v := public.dao_overview();
  perform tests.clear_authentication();
  return (v ->> 'sharePriceUsd6')::numeric;
end;
$$;
create function tests.rvalue() returns numeric language sql as $$
  select value_usdc from public.dao_state where chain_id = 59141
$$;
create function tests.rsupply() returns numeric language sql as $$
  select total_shares - approved_locked_shares from public.dao_state where chain_id = 59141
$$;
create function tests.rpend(p_user uuid, p_amount numeric, p_n int, p_block bigint) returns uuid language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.rh(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_id := public.record_donation((v ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.rh(p_n), 'logIndex', 0, 'blockNumber', p_block), null);
  reset role;
  return v_id;
end;
$$;
create function tests.rcredit(p_ledger uuid, p_assets numeric, p_block bigint, p_price numeric default null)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  if p_price is null then
    v := public.credit_donation(p_ledger, p_assets, p_block);
  else
    v := public.credit_donation(p_ledger, p_assets, p_block, p_price);
  end if;
  reset role;
  return v;
end;
$$;
create function tests.rquote(p_req uuid, p_assets numeric, p_block bigint, p_price numeric) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.quote_withdrawal(p_req, tests.rsafe(), p_assets, p_block, p_eth_price_e8 => p_price);
  reset role;
  return v;
end;
$$;
-- a USDC-only snapshot of p_usdc read at p_block (ETH at 3000 USD); the 55-minute throttle is bypassed by ageing
create function tests.rsnap(p_usdc numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  update public.dao_nav_snapshots set taken_at = taken_at - interval '1 hour' where chain_id = 59141;
  set local role service_role;
  v := public.record_nav_snapshot(59141, tests.rsafe(), jsonb_build_object(
    'usdcUnits', p_usdc::text, 'ethWei', '0', 'wethWei', '0', 'ethPriceE8', '300000000000',
    'priceSource', 'chainlink', 'blockNumber', p_block::text, 'assetsUsd6', p_usdc::text));
  reset role;
  return v;
end;
$$;
-- security definer: the realtime.messages receive policy hides rows from a session without a joined topic
create function tests.rev() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from realtime.messages m where m.event = 'dao_changed' and m.topic = 'dao'
$$;
create function tests.rseeds(p_raffle uuid) returns int language sql as $$
  select count(*)::int from private.raffle_seeds s where s.raffle_id = p_raffle
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9610', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9611', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9612', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.s', tests.create_member('0x' || lpad('f9613', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T961 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T961 tesorero';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.s')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);
select set_config('t.us', (select auth_user_id::text from public.members where id = current_setting('t.s')::uuid), true);

update public.chain_config set safe_address = '0x' || lpad('5afe96101', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
-- whatever the local database holds for 59141 is not part of these scenarios
delete from public.raffles;
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
delete from public.dao_scan_state where chain_id = 59141;
update public.dao_state set total_shares = 100000000000000000000, club_shares = 0, value_usdc = 100000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 60000000000000000000, 60000000),
  (59141, current_setting('t.b')::uuid, 40000000000000000000, 40000000);
insert into public.dao_nav_snapshots (chain_id, taken_at, usdc_units, eth_wei, weth_wei, eth_price_e8, assets_usd6,
                                      liabilities_usd6, nav_usd6, total_shares, price_source, block_number)
  values (59141, now() - interval '2 hours', 100000000, 0, 0, 300000000000, 100000000, 0, 100000000,
          100000000000000000000, 'chainlink', 10);

-- ===== 1. grants, the private seed, schema =====
select ok(not has_function_privilege('anon', 'public.create_raffle(text,text,numeric,timestamptz,text)', 'execute')
      and not has_function_privilege('anon', 'public.cancel_raffle(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'public.set_weighted_raffles_enabled(int,boolean)', 'execute'),
  'anon cannot create_raffle, cancel_raffle or set_weighted_raffles_enabled');
select ok(has_function_privilege('authenticated', 'public.create_raffle(text,text,numeric,timestamptz,text)', 'execute')
      and has_function_privilege('authenticated', 'public.cancel_raffle(uuid,text)', 'execute')
      and has_function_privilege('authenticated', 'public.set_weighted_raffles_enabled(int,boolean)', 'execute'),
  'members can call the member-side raffle RPCs (the bits are checked inside)');
select ok(has_function_privilege('service_role', 'public._dao_liabilities_usd6(int,bigint,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public._dao_liabilities_usd6(int,bigint,numeric)', 'execute')
      and not has_function_privilege('anon', 'public._dao_liabilities_usd6(int,bigint,numeric)', 'execute')
      and has_function_privilege('service_role', 'public.credit_donation(uuid,numeric,bigint,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.credit_donation(uuid,numeric,bigint,numeric)', 'execute')
      and has_function_privilege('service_role', 'public.quote_withdrawal(uuid,text,numeric,bigint,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.quote_withdrawal(uuid,text,numeric,bigint,numeric)', 'execute')
      and has_function_privilege('service_role', 'public.approve_withdrawal(uuid,uuid,text,numeric,bigint,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.approve_withdrawal(uuid,uuid,text,numeric,bigint,numeric)', 'execute')
      and not has_function_privilege('service_role',
            'public._withdrawal_valuation(public.withdrawal_requests,text,numeric,bigint,boolean,numeric)', 'execute'),
  'the re-created valuation functions keep their grants (service-only; _withdrawal_valuation internal)');
select hasnt_function('public', '_dao_liabilities_usd6', array['integer', 'bigint'],
  'the 2-argument liabilities is replaced (callers reach the new one through the default)');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.create_raffle(text,text,numeric,timestamptz,text)'::regprocedure,
                         'public.cancel_raffle(uuid,text)'::regprocedure,
                         'public.set_weighted_raffles_enabled(int,boolean)'::regprocedure,
                         'public._dao_liabilities_usd6(int,bigint,numeric)'::regprocedure,
                         'public.credit_donation(uuid,numeric,bigint,numeric)'::regprocedure,
                         'public.record_nav_snapshot(int,text,jsonb)'::regprocedure,
                         'public._withdrawal_valuation(public.withdrawal_requests,text,numeric,bigint,boolean,numeric)'::regprocedure,
                         'public.quote_withdrawal(uuid,text,numeric,bigint,numeric)'::regprocedure,
                         'public.approve_withdrawal(uuid,uuid,text,numeric,bigint,numeric)'::regprocedure,
                         'public.set_chain_addresses(int,text,text)'::regprocedure,
                         'public._dao_assets_covered(int,bigint)'::regprocedure,
                         'public.dao_valuation_cap(int)'::regprocedure,
                         'public.broadcast_dao_event()'::regprocedure,
                         'public._raffle_prize_owed(public.raffles,bigint)'::regprocedure)),
  'the new and replaced functions are definer with an empty search_path');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use schema private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated cannot use schema private');
select ok(not has_schema_privilege('service_role', 'private', 'USAGE'), 'service_role cannot use schema private');
select ok(not has_schema_privilege('anon', 'private', 'CREATE') and not has_schema_privilege('authenticated', 'private', 'CREATE')
      and not has_schema_privilege('service_role', 'private', 'CREATE'), 'no API role can create in schema private');
select ok(not has_table_privilege('anon', 'private.raffle_seeds', 'select')
      and not has_table_privilege('authenticated', 'private.raffle_seeds', 'select')
      and not has_table_privilege('service_role', 'private.raffle_seeds', 'select')
      and not has_table_privilege('anon', 'private.raffle_seeds', 'insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('authenticated', 'private.raffle_seeds', 'insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('service_role', 'private.raffle_seeds', 'insert, update, delete, truncate, references, trigger'),
  'no API role holds any privilege on private.raffle_seeds');
select ok(not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                      where (d.defaclnamespace = 0 or d.defaclnamespace = 'private'::regnamespace)
                        and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)),
  'no default privilege hands a future object in private (or anywhere, globally) to an API role');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace),
  'schema private holds no function');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select * from private.raffle_seeds$$, '42501', null, 'authenticated cannot read private.raffle_seeds');
select tests.clear_authentication();
set local role anon;
select throws_ok($$select * from private.raffle_seeds$$, '42501', null, 'anon cannot read private.raffle_seeds');
reset role;
set local role service_role;
select throws_ok($$select * from private.raffle_seeds$$, '42501', null, 'service_role cannot read private.raffle_seeds');
reset role;
select ok((select relrowsecurity from pg_class where oid = 'public.raffles'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.raffle_entries'::regclass),
  'raffles and raffle_entries have RLS on');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('raffles', 'raffle_entries')),
  'raffles and raffle_entries have no client policy');
select ok(not has_table_privilege('authenticated', 'public.raffles', 'select')
      and not has_table_privilege('anon', 'public.raffles', 'select')
      and not has_table_privilege('authenticated', 'public.raffle_entries', 'select')
      and not has_table_privilege('anon', 'public.raffle_entries', 'select'), 'clients cannot read raffles or entries');
select has_column('public', 'dao_safe_operations', 'raffle_id', 'dao_safe_operations.raffle_id exists');
select throws_ok($$insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at,
                                               seed_commit, status, created_by)
                   values (59141, 'x', 'USDC', 1000000, 1000000, 'equal', now() + interval '1 day', tests.rh(1), 'drawn',
                           current_setting('t.t')::uuid)$$, '23514', null,
  'a drawn raffle needs its winner, draw block and reveal');
select throws_ok($$insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at,
                                               seed_commit, seed_reveal, created_by)
                   values (59141, 'x', 'USDC', 1000000, 1000000, 'equal', now() + interval '1 day', tests.rh(1), tests.rh(2),
                           current_setting('t.t')::uuid)$$, '23514', null,
  'an open raffle cannot carry a revealed seed');
select throws_ok($$insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at,
                                               seed_commit, payout_tx_hash, created_by)
                   values (59141, 'x', 'USDC', 1000000, 1000000, 'equal', now() + interval '1 day', tests.rh(1), tests.rh(3),
                           current_setting('t.t')::uuid)$$, '23514', null,
  'payout columns are all set or all null, and only on drawn/paid');

-- ===== 3. create guards (before any raffle exists) =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select public.create_raffle('  ', 'DOGE', 1, now(), 'x')$$, 'forbidden',
  'a member without bit 256 gets forbidden first');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select public.create_raffle('  ', 'DOGE', 1, now(), 'x')$$, 'title_required', 'a blank title → title_required');
select throws_ok($$select public.create_raffle(repeat('a', 81), 'USDC', 10000000, now() + interval '1 day', 'equal')$$,
  'title_required', 'an 81-character title → title_required');
select throws_ok($$select public.create_raffle('Sorteo', 'DOGE', 10000000, now() + interval '1 day', 'equal')$$,
  'invalid_input', 'an unknown token → invalid_input');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 10000000, now() + interval '1 day', 'lottery')$$,
  'invalid_input', 'an unknown mode → invalid_input');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 1000000.5, now() + interval '1 day', 'equal')$$,
  'invalid_input', 'a non-integer amount → invalid_input');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 999999, now() + interval '1 day', 'equal')$$,
  'prize_too_small', '999999 USDC units → prize_too_small');
select throws_ok($$select public.create_raffle('Sorteo', 'WETH', 999999999999999, now() + interval '1 day', 'equal')$$,
  'prize_too_small', '10^15 - 1 wei → prize_too_small');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 0, now() + interval '1 day', 'equal')$$,
  'prize_too_small', 'a zero prize → prize_too_small');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 10000000, now() + interval '30 minutes', 'equal')$$,
  'closes_at_invalid', 'closing in 30 minutes → closes_at_invalid');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 10000000, now() + interval '31 days', 'equal')$$,
  'closes_at_invalid', 'closing in 31 days → closes_at_invalid');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 10000000, null, 'equal')$$,
  'closes_at_invalid', 'no close date → closes_at_invalid');
select tests.clear_authentication();
update public.dao_state set nav_initialized = false where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 10000000, now() + interval '1 day', 'equal')$$,
  'nav_not_ready', 'a fund with no valuation → nav_not_ready');
select tests.clear_authentication();
update public.dao_state set nav_initialized = true where chain_id = 59141;
update public.dao_nav_snapshots set chain_id = 59144 where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select public.create_raffle('Sorteo', 'WETH', 10000000000000000, now() + interval '1 day', 'equal')$$,
  'nav_not_ready', 'a WETH prize with no snapshot price → nav_not_ready');
select tests.clear_authentication();
update public.dao_nav_snapshots set chain_id = 59141 where block_number = 10 and assets_usd6 = 100000000 and taken_at < now();
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 100000001, now() + interval '1 day', 'equal')$$,
  'prize_too_large', '100.000001 USDC on a 100 USDC fund → prize_too_large');
select throws_ok($$select public.create_raffle('Sorteo', 'WETH', 34000000000000000, now() + interval '1 day', 'equal')$$,
  'prize_too_large', '0.034 WETH (102 USD at 3000) on a 100 USDC fund → prize_too_large');
select lives_ok($$select public.create_raffle('Sorteo', 'USDC', 100000000, now() + interval '1 hour 1 minute', 'equal')$$,
  'a prize worth exactly the fund, closing just over an hour from now, passes');
select tests.clear_authentication();
-- that one only proved the boundaries: drop it and restore the fund
delete from public.raffles;
update public.dao_state set value_usdc = 100000000 where chain_id = 59141;
select is((select count(*)::int from public.audit_log where action = 'raffle_created'
           and payload ->> 'valueUsd6' = '100000000' and actor_member_id = current_setting('t.t')::uuid), 1,
  'the boundary raffle was audited (and its seed went with it on delete)');

-- ===== 2. the weighted switch =====
select is((select weighted_raffles_enabled from public.chain_config where chain_id = 59141), true, 'weighted raffles are on for 59141');
select is((select weighted_raffles_enabled from public.chain_config where chain_id = 59144), false, 'weighted raffles are off for 59144');
select is((select value from public.app_config where key = 'weighted_raffles_enabled'), 'false'::jsonb,
  'the legacy app_config key is untouched');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is(public.economy_config() #> '{chains,59141,weightedRafflesEnabled}', 'true'::jsonb,
  'economy_config shows weightedRafflesEnabled per chain');
select throws_ok($$select public.set_weighted_raffles_enabled(59141, false)$$, 'forbidden',
  'a treasurer (256 only) cannot flip the switch');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.us')::uuid);
select throws_ok($$select public.set_weighted_raffles_enabled(1, false)$$, 'chain_invalid', 'unknown chain → chain_invalid');
select throws_ok($$select public.set_weighted_raffles_enabled(59141, null)$$, 'invalid_input', 'a null value → invalid_input');
select lives_ok($$select public.set_weighted_raffles_enabled(59141, false)$$, 'SuperAdmin turns weighted raffles off for 59141');
select tests.clear_authentication();
select is((select payload from public.audit_log where action = 'economy.weighted_raffles'
           and actor_member_id = current_setting('t.s')::uuid order by id desc limit 1),
  jsonb_build_object('chain', 59141, 'old', true, 'new', false), 'the switch is audited as economy.weighted_raffles {chain, old, new}');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is(public.economy_config() #> '{chains,59141,weightedRafflesEnabled}', 'false'::jsonb, 'economy_config follows the switch');
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 10000000, now() + interval '1 day', 'weighted')$$,
  'weighted_raffles_disabled', 'a weighted raffle with the switch off → weighted_raffles_disabled');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.us')::uuid);
select public.set_weighted_raffles_enabled(59141, true);
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select public.create_raffle('Sorteo', 'USDC', 100000001, now() + interval '1 day', 'weighted')$$,
  'prize_too_large', 'with the switch back on a weighted raffle passes the switch check (and stops at the next one)');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.us')::uuid);
select public.set_weighted_raffles_enabled(59141, false);
select tests.clear_authentication();

-- ===== 4. create a USDC raffle (equal: the switch only gates weighted) =====
select set_config('t.p0', tests.rprice()::text, true);
select is(current_setting('t.p0')::numeric, 1000000::numeric, 'price before: 100 USDC / 100 shares');
select set_config('t.c1', tests.rcreate(current_setting('t.ut')::uuid, '  Sorteo de octubre  ', 'USDC', 10000000)::text, true);
select set_config('t.r1', current_setting('t.c1')::jsonb ->> 'id', true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t.c1')::jsonb) k), array['commit', 'id'],
  'create_raffle returns only {id, commit}: never the seed');
select ok(current_setting('t.c1')::jsonb ->> 'commit' ~ '^0x[0-9a-f]{64}$', 'the commit is lowercase 0x + 32 bytes');
select is((select row(chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, status, seed_commit, seed_reveal,
                      created_by)::text
           from public.raffles where id = current_setting('t.r1')::uuid),
  row(59141, 'Sorteo de octubre', 'USDC', 10000000::numeric, 10000000::numeric, 'equal', 'open',
      current_setting('t.c1')::jsonb ->> 'commit', null::text, current_setting('t.t')::uuid)::text,
  'the raffle is open on the active chain, title trimmed, valued at its USDC amount, seed not revealed');
select is(tests.rseeds(current_setting('t.r1')::uuid), 1, 'the seed is stored in private.raffle_seeds');
select is((select '0x' || encode(public._keccak256(s.seed), 'hex') from private.raffle_seeds s
           where s.raffle_id = current_setting('t.r1')::uuid),
  (select seed_commit from public.raffles where id = current_setting('t.r1')::uuid), 'seed_commit = keccak256(seed)');
select ok((select length(s.seed) = 32 from private.raffle_seeds s where s.raffle_id = current_setting('t.r1')::uuid),
  'the seed is 32 bytes');
select is(tests.rvalue(), 90000000::numeric, 'the cached value drops by exactly the prize: 90 USDC');
select is(tests.rprice(), current_setting('t.p0')::numeric - div(10000000 * 1000000000000000000::numeric, 100000000000000000000),
  'the share price drops by exactly prize * 10^18 / S');
select is(tests.rliab(null), 10000000::numeric, 'the open prize is a liability (read path)');
select is(tests.rliab(100), 10000000::numeric, 'the open prize is a liability at any block (no payout yet)');
select is((select payload from public.audit_log where action = 'raffle_created' and target_id = current_setting('t.r1')::uuid),
  jsonb_build_object('raffle', current_setting('t.r1')::uuid, 'token', 'USDC', 'amount', '10000000', 'valueUsd6', '10000000',
                     'mode', 'equal', 'closesAt', (select closes_at from public.raffles where id = current_setting('t.r1')::uuid),
                     'commit', current_setting('t.c1')::jsonb ->> 'commit'),
  'raffle_created is audited with {raffle, token, amount, valueUsd6, mode, closesAt, commit}');
-- the invariant: a fresh valuation of the same 100 USDC Safe gives exactly the cached value (no jump for others)
select is(tests.rsnap(100000000, 20) ->> 'navUsd6', '90000000', 'a fresh snapshot of the same Safe values the fund at 90 USDC');
select is(tests.rprice(), current_setting('t.p0')::numeric - div(10000000 * 1000000000000000000::numeric, 100000000000000000000),
  'the price after the fresh snapshot is the cached one: the prize counted exactly once');

-- ===== 5. a WETH prize: valued at the snapshot price on creation, at the caller's price as a liability =====
select set_config('t.r2', (tests.rcreate(current_setting('t.ut')::uuid, 'Sorteo WETH', 'WETH', 10000000000000000) ->> 'id'), true);
select is((select prize_value_usd6 from public.raffles where id = current_setting('t.r2')::uuid), 30000000::numeric,
  '0.01 WETH at the snapshot''s 3000 USD is worth 30 USDC');
select is(tests.rvalue(), 60000000::numeric, 'the cached value drops by 30 USDC');
select is(tests.rliab(100, 200000000000), 30000000::numeric, 'at the caller''s 2000 USD the prizes owe 10 + 20 USDC');
select is(tests.rliab(100), 40000000::numeric, 'with no price given the snapshot''s 3000 USD is used: 10 + 30');
select is(tests.rliab(null), 40000000::numeric, 'the read path too');
select is(tests.rliab(100, 0), 10000000::numeric, 'a zero price values the WETH prize at 0 (the price is the caller''s)');

-- ===== 6. a donation credited while the WETH prize is open (Review Focus 4) =====
select set_config('t.l1', tests.rpend(current_setting('t.ub')::uuid, 10000000, 101, 30)::text, true);
select set_config('t.s0', tests.rsupply()::text, true);
-- the Safe holds 110 USDC at block 40; liabilities: the pending 10 + R1 10 + R2 at 2000 USD = 20  →  NAV 70
select is(tests.rcredit(current_setting('t.l1')::uuid, 110000000, 40, 200000000000) ->> 'shares',
  div(10000000 * current_setting('t.s0')::numeric, 70000000)::text,
  'credit_donation with a price mints at a NAV net of the WETH prize at that price (70 USDC)');
select is(tests.rvalue(), 80000000::numeric, 'the cached value is that NAV plus the donation');
select set_config('t.l2', tests.rpend(current_setting('t.ua')::uuid, 10000000, 102, 50)::text, true);
select set_config('t.s1', tests.rsupply()::text, true);
-- the 3-argument call still works: R2 at the snapshot's 3000 USD = 30  →  NAV 120 - 10 - 10 - 30 = 70
select is(tests.rcredit(current_setting('t.l2')::uuid, 120000000, 60) ->> 'shares',
  div(10000000 * current_setting('t.s1')::numeric, 70000000)::text,
  'the 3-argument credit_donation still works and values the WETH prize at the snapshot price');

-- ===== 7. a withdrawal quote sees both prizes =====
select set_config('t.bs', (select shares::text from public.dao_positions
                           where chain_id = 59141 and member_id = current_setting('t.b')::uuid), true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.w1', public.request_withdrawal(current_setting('t.bs')::numeric)::text, true);
select tests.clear_authentication();
select set_config('t.q1', tests.rquote(current_setting('t.w1')::uuid, 120000000, 60, 300000000000)::text, true);
select is(current_setting('t.q1')::jsonb ->> 'navUsd6', '80000000', 'quote: NAV = 120 - 10 (R1) - 30 (R2 at 3000)');
select is(current_setting('t.q1')::jsonb ->> 'amountUsdc',
  div((select shares from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.b')::uuid)
      * 80000000, tests.rsupply())::text,
  'quote: the amount is the position over S_eff at the NAV net of both prizes');
select is(tests.rquote(current_setting('t.w1')::uuid, 120000000, 60, 200000000000) ->> 'navUsd6', '90000000',
  'quote at 2000 USD values the WETH prize at 20');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select public.cancel_withdrawal(current_setting('t.w1')::uuid);
select tests.clear_authentication();

-- ===== 8. cancel =====
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format($$select public.cancel_raffle(%L, '   ')$$, current_setting('t.r1')), 'reason_required',
  'a blank reason → reason_required');
select throws_ok(format($$select public.cancel_raffle(%L, E'\t\n')$$, current_setting('t.r1')), 'reason_required',
  'a whitespace-only reason → reason_required');
select throws_ok(format($$select public.cancel_raffle(%L, %L)$$, current_setting('t.r1'), repeat('a', 281)), 'reason_required',
  'a 281-character reason → reason_required');
select throws_ok(format($$select public.cancel_raffle(%L, 'x')$$, gen_random_uuid()), 'not_found', 'an unknown raffle → not_found');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($$select public.cancel_raffle(%L, 'x')$$, current_setting('t.r1')), 'forbidden',
  'a member without bit 256 cannot cancel');
select tests.clear_authentication();
select set_config('t.v0', tests.rvalue()::text, true);
select set_config('t.s2', tests.rsupply()::text, true);
select set_config('t.lb', tests.rliab(null)::text, true);
select lives_ok(format($$select tests.rcancel(%L, %L, '  Premio mal configurado  ')$$, current_setting('t.ut'), current_setting('t.r1')),
  'a treasurer cancels the open USDC raffle');
select is((select row(status, cancelled_by, cancel_reason, cancelled_at is not null, seed_reveal)::text
           from public.raffles where id = current_setting('t.r1')::uuid),
  row('cancelled', current_setting('t.t')::uuid, 'Premio mal configurado', true, null::text)::text,
  'cancelled with actor, trimmed reason and time; the seed is never revealed');
select is(tests.rseeds(current_setting('t.r1')::uuid), 0, 'the seed row is deleted');
select is(tests.rvalue(), current_setting('t.v0')::numeric + 10000000, 'the cached value is back up by exactly the prize');
select is(tests.rprice(), div((current_setting('t.v0')::numeric + 10000000) * 1000000000000000000, current_setting('t.s2')::numeric),
  'the share price is the cached value over S_eff: restored by exactly the prize');
select is(tests.rliab(null), current_setting('t.lb')::numeric - 10000000, 'the cancelled prize is no longer a liability');
select is(tests.rliab(100), 30000000::numeric, 'only R2 is left (at the snapshot''s 3000 USD)');
select is((select payload - 'reason' from public.audit_log where action = 'raffle_cancelled'
           and target_id = current_setting('t.r1')::uuid and actor_member_id = current_setting('t.t')::uuid),
  jsonb_build_object('raffle', current_setting('t.r1')::uuid, 'valueUsd6', '10000000'), 'raffle_cancelled is audited');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format($$select public.cancel_raffle(%L, 'otra vez')$$, current_setting('t.r1')), 'invalid_state',
  'cancelling again → invalid_state');
select tests.clear_authentication();
-- R3 forced to drawn (Task 3 draws): the prize is the winner's
select set_config('t.r3', (tests.rcreate(current_setting('t.ut')::uuid, 'Sorteo 3', 'USDC', 1000000) ->> 'id'), true);
update public.raffles set status = 'drawn', closed_at = now(), total_weight = 1, draw_block_number = 200,
                          draw_block_hash = tests.rh(200), draw_block_time = now(), draw_random = '1',
                          winner_position = 1, winner_member_id = current_setting('t.a')::uuid,
                          winner_address = (select lower(wallet_address) from public.members where id = current_setting('t.a')::uuid),
                          drawn_at = now(), seed_reveal = tests.rh(7)
  where id = current_setting('t.r3')::uuid;
delete from private.raffle_seeds where raffle_id = current_setting('t.r3')::uuid;
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format($$select public.cancel_raffle(%L, 'no')$$, current_setting('t.r3')), 'raffle_drawn',
  'a drawn raffle cannot be cancelled → raffle_drawn');
select tests.clear_authentication();
select is(tests.rliab(null), 31000000::numeric, 'a drawn, unpaid prize is still a liability (R2 30 + R3 1)');
select is(public.dao_valuation_cap(59141) ->> 'capped', 'true',
  'F4c-R7 extended: a drawn, unpaid prize caps valuations at the scan cursor (its payout may already have left)');
select is(public._dao_assets_covered(59141, 1), false, 'no scan cursor yet: a Safe read is not covered while a prize awaits payout');
-- a linked prize payout at block 150 (Task 4 links them): from that block on it is paid for valuation (F4c-R7 b)
insert into public.dao_safe_operations (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number,
                                        occurred_at, raffle_id)
  values (59141, tests.rh(300), 0, 'USDC', 'out', 1000000,
          (select lower(wallet_address) from public.members where id = current_setting('t.a')::uuid), 150, now(),
          current_setting('t.r3')::uuid);
select is(tests.rliab(149), 31000000::numeric, 'before the linked payout block the drawn prize counts');
select is(tests.rliab(150), 30000000::numeric, 'at the linked payout block it no longer counts');
select is(tests.rliab(null), 31000000::numeric, 'the read path still counts it until the payout is recorded');
select throws_ok($$update public.dao_safe_operations set withdrawal_id = (select id from public.withdrawal_requests limit 1)
                   where raffle_id is not null$$, '23514', null, 'an outflow links a withdrawal or a raffle, never both');
delete from public.dao_safe_operations where raffle_id = current_setting('t.r3')::uuid;
-- the same raffle as void (Task 3): nothing to cancel
update public.raffles set status = 'void', winner_position = null, winner_member_id = null, winner_address = null,
                          drawn_at = null, draw_block_hash = null
  where id = current_setting('t.r3')::uuid;
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format($$select public.cancel_raffle(%L, 'no')$$, current_setting('t.r3')), 'invalid_state',
  'a void raffle → invalid_state');
select tests.clear_authentication();
select is(tests.rliab(null), 30000000::numeric, 'a void raffle is not a liability');
delete from public.raffles where id = current_setting('t.r3')::uuid;

-- ===== 9. the Safe cannot change while a raffle is open, closed or drawn =====
-- clear the other blockers (shares, pending donations, intents): only R2 is left
update public.dao_positions set shares = 0, locked_shares = 0 where chain_id = 59141;
update public.dao_state set total_shares = 0, club_shares = 0, approved_locked_shares = 0 where chain_id = 59141;
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
select tests.authenticate_as(current_setting('t.us')::uuid);
select throws_ok($$select public.set_chain_addresses(59141, '0x' || lpad('5afe96199', 40, '0'), null)$$, 'safe_change_blocked',
  'an open raffle blocks a Safe change');
select tests.clear_authentication();
update public.raffles set status = 'closed', closed_at = now() where id = current_setting('t.r2')::uuid;
select tests.authenticate_as(current_setting('t.us')::uuid);
select throws_ok($$select public.set_chain_addresses(59141, '0x' || lpad('5afe96199', 40, '0'), null)$$, 'safe_change_blocked',
  'a closed raffle blocks a Safe change');
select tests.clear_authentication();
update public.raffles set status = 'drawn', draw_block_number = 200, draw_block_hash = tests.rh(200), draw_block_time = now(),
                          winner_position = 1, winner_member_id = current_setting('t.a')::uuid,
                          winner_address = (select lower(wallet_address) from public.members where id = current_setting('t.a')::uuid),
                          drawn_at = now(), seed_reveal = tests.rh(8)
  where id = current_setting('t.r2')::uuid;
select tests.authenticate_as(current_setting('t.us')::uuid);
select throws_ok($$select public.set_chain_addresses(59141, '0x' || lpad('5afe96199', 40, '0'), null)$$, 'safe_change_blocked',
  'a drawn raffle blocks a Safe change');
select tests.clear_authentication();
update public.raffles set status = 'closed', winner_position = null, winner_member_id = null, winner_address = null,
                          drawn_at = null, draw_block_hash = null, seed_reveal = null
  where id = current_setting('t.r2')::uuid;
select lives_ok(format($$select tests.rcancel(%L, %L, 'cierre')$$, current_setting('t.ut'), current_setting('t.r2')),
  'a closed raffle can still be cancelled');
select tests.authenticate_as(current_setting('t.us')::uuid);
select lives_ok($$select public.set_chain_addresses(59141, '0x' || lpad('5afe96199', 40, '0'), null)$$,
  'with the raffle cancelled the Safe can change');
select tests.clear_authentication();

-- ===== 10. realtime =====
select set_config('t.e0', tests.rev()::text, true);
insert into public.raffles (id, chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at, seed_commit, created_by)
  values ('00000000-0000-0000-0000-000000961010', 59141, 'Directo', 'USDC', 1000000, 1000000, 'equal',
          now() + interval '1 day', tests.rh(9), current_setting('t.t')::uuid);
select is(tests.rev(), current_setting('t.e0')::int + 1, 'inserting a raffle emits one dao_changed');
update public.raffles set title = 'Directo 2' where id = '00000000-0000-0000-0000-000000961010';
select is(tests.rev(), current_setting('t.e0')::int + 1, 'a non-status update emits nothing');
insert into public.raffle_entries (raffle_id, member_id) values ('00000000-0000-0000-0000-000000961010', current_setting('t.a')::uuid);
select is(tests.rev(), current_setting('t.e0')::int + 2, 'an entry insert emits one dao_changed');
delete from public.raffle_entries where raffle_id = '00000000-0000-0000-0000-000000961010';
select is(tests.rev(), current_setting('t.e0')::int + 3, 'an entry delete emits one dao_changed');
select ok((select (payload - 'id') = jsonb_build_object('chain_id', 59141) and private from realtime.messages
           where event = 'dao_changed' and topic = 'dao' order by inserted_at desc, id desc limit 1),
  'the entry broadcast carries the raffle''s chain only');
update public.raffles set status = 'closed', closed_at = now() where id = '00000000-0000-0000-0000-000000961010';
select is(tests.rev(), current_setting('t.e0')::int + 4, 'a status change emits one dao_changed');
select has_trigger('public', 'raffles', 'raffles_broadcast', 'raffles trigger');
select has_trigger('public', 'raffle_entries', 'raffle_entries_broadcast', 'raffle_entries trigger');
select throws_ok($$insert into public.notifications (recipient_id, kind, data)
                   values (current_setting('t.a')::uuid, 'raffle_nope', '{}'::jsonb)$$, '23514', null,
  'unknown notification kinds are still refused');
select lives_ok($$insert into public.notifications (recipient_id, kind, data)
                  values (current_setting('t.a')::uuid, 'raffle_won', '{}'::jsonb)$$, 'raffle_won is a notification kind');

select * from finish();
rollback;
