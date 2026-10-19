-- F4a final review fixes: the donation acknowledgement in SQL (F4a-R11), the Safe-change guard and reset (F4a-R12)
-- and credit_donation refusing an assets read older than a block already credited on the chain.
begin;
select plan(44);

-- ===== helpers (rolled back with the test) =====
create function tests.fh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- a donation intent (fee 0) by p_user on the active chain
create function tests.fintent(p_user uuid, p_amount numeric) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
-- a pending_finality donation of p_amount by p_user, paid in tx p_n at p_block
create function tests.fpend(p_user uuid, p_amount numeric, p_n int, p_block bigint) returns uuid language plpgsql as $$
declare
  v_intent uuid := tests.fintent(p_user, p_amount);
  v_id uuid;
begin
  perform tests.authenticate_as(p_user);
  perform public.attach_intent_tx(v_intent, 'main', tests.fh(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_id := public.record_donation(v_intent, jsonb_build_object('txHash', tests.fh(p_n), 'logIndex', 0, 'blockNumber', p_block), null);
  reset role;
  return v_id;
end;
$$;
create function tests.fcr(p_ledger uuid, p_assets numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.credit_donation(p_ledger, p_assets, p_block);
  reset role;
  return v;
end;
$$;
-- F4a state of one chain, as "scan:snapshots:operations:nav_initialized:value:nav_at_set"
create function tests.fstate(p_chain int) returns text language sql as $$
  select (select count(*) from public.dao_scan_state where chain_id = p_chain)::text
      || ':' || (select count(*) from public.dao_nav_snapshots where chain_id = p_chain)::text
      || ':' || (select count(*) from public.dao_safe_operations where chain_id = p_chain)::text
      || ':' || (select nav_initialized::text || ':' || value_usdc::text || ':' || (nav_at is not null)::text
                 from public.dao_state where chain_id = p_chain)
$$;
-- seeds scan state, one snapshot and one operation on a chain, as an earlier Safe would have left them
create function tests.fseed(p_chain int) returns void language plpgsql as $$
begin
  insert into public.dao_scan_state (chain_id, last_block, eth_block) values (p_chain, 700, 650);
  insert into public.dao_nav_snapshots (chain_id, usdc_units, eth_wei, weth_wei, eth_price_e8, assets_usd6,
                                        liabilities_usd6, nav_usd6, total_shares, price_source, block_number)
  values (p_chain, 5000000, 0, 0, 250000000000, 5000000, 0, 5000000, 0, 'chainlink', 650);
  insert into public.dao_safe_operations (chain_id, tx_hash, log_index, asset, direction, amount, block_number, occurred_at)
  values (p_chain, tests.fh(p_chain * 10 + 7), 0, 'USDC', 'out', 1000000, 660, now());
  update public.dao_state set nav_initialized = true, value_usdc = 5000000, nav_at = now() where chain_id = p_chain;
end;
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9300', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9301', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.safe1', '0x' || lpad('5afe93001', 40, '0'), true);
select set_config('t.safe2', '0x' || lpad('5afe93002', 40, '0'), true);
select set_config('t.safem', '0x' || lpad('5afe93144', 40, '0'), true);
select set_config('t.plat', '0x' || lpad('91a793001', 40, '0'), true);
update public.chain_config set safe_address = current_setting('t.safe1'), platform_wallet = null where chain_id = 59141;
update public.chain_config set safe_address = current_setting('t.safem') where chain_id = 59144;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';

-- ===== 1. F4a-R11: the acknowledgement is a parameter of the RPC =====
select hasnt_function('public', 'create_donation_intent', array['numeric', 'integer'],
  'the 2-argument create_donation_intent is gone (no door without the acknowledgement)');
select has_function('public', 'create_donation_intent', array['numeric', 'integer', 'boolean'],
  'create_donation_intent(numeric, int, boolean) exists');
select ok(has_function_privilege('authenticated', 'public.create_donation_intent(numeric,int,boolean)', 'execute'),
  'authenticated can create_donation_intent');
select ok(not has_function_privilege('anon', 'public.create_donation_intent(numeric,int,boolean)', 'execute')
      and not has_function_privilege('public', 'public.create_donation_intent(numeric,int,boolean)', 'execute'),
  'anon / public cannot create_donation_intent');
select ok(not has_function_privilege('service_role', 'public.create_donation_intent(numeric,int,boolean)', 'execute'),
  'service_role cannot create_donation_intent (it is a member action)');
select is((select prosecdef from pg_proc where oid = 'public.create_donation_intent(numeric,int,boolean)'::regprocedure),
  true, 'create_donation_intent is security definer');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select public.create_donation_intent(1000000, 0, false)$$, 'P0001', 'acknowledgement_required',
  'acknowledged = false is refused');
select throws_ok($$select public.create_donation_intent(1000000, 0, null)$$, 'P0001', 'acknowledgement_required',
  'acknowledged = null is refused');
select throws_ok($$select public.create_donation_intent(1, 0, false)$$, 'P0001', 'acknowledgement_required',
  'the acknowledgement is checked before the amount');
select lives_ok($$select public.create_donation_intent(1000000, 0, true)$$, 'acknowledged = true creates the intent');
select is((select count(*)::int from public.payment_intents where member_id = current_setting('t.b')::uuid and purpose = 'donation'),
  1, 'only the acknowledged call created an intent');
select tests.clear_authentication();
-- that intent is not part of the Safe-change scenarios below
update public.payment_intents set status = 'expired' where member_id = current_setting('t.b')::uuid;

-- ===== 2. F4a-R12: set_chain_addresses and the Safe =====
select tests.fseed(59141);
select tests.fseed(59144);
update public.dao_state set total_shares = 7000000000000000000 where chain_id = 59144;

-- 2a. shares on the chain block a Safe change
update public.dao_state set total_shares = 3000000000000000000 where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.set_chain_addresses(59141, %L, null)$$, current_setting('t.safe2')),
  'P0001', 'safe_change_blocked', 'shares on the chain block a Safe change');
select throws_ok($$select public.set_chain_addresses(59141, null, null)$$,
  'P0001', 'safe_change_blocked', 'shares on the chain block removing the Safe');
-- the same Safe (any case) with a new platform wallet is no Safe change: allowed, F4a state untouched
select lives_ok(format($$select public.set_chain_addresses(59141, %L, %L)$$, upper(current_setting('t.safe1')), current_setting('t.plat')),
  'the same Safe is accepted while shares exist (only the platform wallet changes)');
select tests.clear_authentication();
select is((select safe_address || ' ' || platform_wallet from public.chain_config where chain_id = 59141),
  current_setting('t.safe1') || ' ' || current_setting('t.plat'), 'platform wallet saved, Safe kept');
select is(tests.fstate(59141), '1:1:1:true:5000000:true', 'same Safe: scan state, snapshots, operations and NAV kept');
select is((select total_shares::text from public.dao_state where chain_id = 59141), '3000000000000000000',
  'same Safe: shares kept');

-- 2b. a pending (not yet credited) donation blocks a Safe change
update public.dao_state set total_shares = 0 where chain_id = 59141;
select set_config('t.l1', tests.fpend(current_setting('t.ub')::uuid, 2000000, 1, 600)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.set_chain_addresses(59141, %L, %L)$$, current_setting('t.safe2'), current_setting('t.plat')),
  'P0001', 'safe_change_blocked', 'a pending_finality donation blocks a Safe change');
select tests.clear_authentication();
update public.dao_ledger set status = 'reverted' where id = current_setting('t.l1')::uuid;

-- 2c. an open donation intent to the current Safe blocks it too (paid later, it would be valued against the new Safe)
select set_config('t.i1', tests.fintent(current_setting('t.ub')::uuid, 1000000)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.set_chain_addresses(59141, %L, %L)$$, current_setting('t.safe2'), current_setting('t.plat')),
  'P0001', 'safe_change_blocked', 'an open donation intent blocks a Safe change');
select tests.clear_authentication();
-- expired without a transaction: it can no longer be confirmed, so it does not block
update public.payment_intents set expires_at = now() - interval '1 minute' where id = current_setting('t.i1')::uuid;
-- but an expired intent whose hashes were attached in time can still be confirmed: it blocks
update public.payment_intents set hashes_attached_at = now() - interval '2 minutes', main_tx_hash = tests.fh(2)
  where id = current_setting('t.i1')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.set_chain_addresses(59141, %L, %L)$$, current_setting('t.safe2'), current_setting('t.plat')),
  'P0001', 'safe_change_blocked', 'an expired intent with hashes attached in time still blocks');
select tests.clear_authentication();
update public.payment_intents set status = 'expired' where id = current_setting('t.i1')::uuid;
-- an open donation intent on the OTHER chain does not block this one (2d below succeeds with it open)
update public.app_config set value = '59144'::jsonb where key = 'active_chain_id';
select set_config('t.i2', tests.fintent(current_setting('t.ub')::uuid, 1000000)::text, true);
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
select is((select count(*)::int from public.audit_log where action = 'economy.addresses'
           and payload ->> 'chain' = '59141' and payload #>> '{new,safe}' = current_setting('t.safe2')), 0,
  'no Safe change was recorded while blocked');
select is((select safe_address from public.chain_config where chain_id = 59141), current_setting('t.safe1'),
  'the Safe is unchanged after the refusals');

-- 2d. a clean change: the new Safe starts with no scan cursor, no snapshots, no operations and nav_initialized = false
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($$select public.set_chain_addresses(59141, %L, %L)$$, current_setting('t.safe2'), current_setting('t.plat')),
  'a Safe change with no shares and no pending donations is accepted');
select tests.clear_authentication();
select is((select safe_address from public.chain_config where chain_id = 59141), current_setting('t.safe2'), 'new Safe saved');
select is(tests.fstate(59141), '0:0:0:false:0:false', 'scan state (incl. ETH cursor), snapshots, operations and NAV cleared');
select is((select club_shares::text || ':' || total_shares::text from public.dao_state where chain_id = 59141), '0:0',
  'no club or member shares on the chain');
select is((select count(*)::int from public.audit_log where action = 'economy.addresses'
           and payload ->> 'chain' = '59141' and payload #>> '{new,safe}' = current_setting('t.safe2')
           and (payload ->> 'reset')::boolean), 1, 'the audit entry records the reset');
-- the other chain is untouched
select is(tests.fstate(59144), '1:1:1:true:5000000:true', 'other chain: F4a state untouched');
select is((select total_shares::text from public.dao_state where chain_id = 59144), '7000000000000000000', 'other chain: shares untouched');
select is((select safe_address from public.chain_config where chain_id = 59144), current_setting('t.safem'), 'other chain: Safe untouched');
-- the ledger keeps its history
select is((select status from public.dao_ledger where id = current_setting('t.l1')::uuid), 'reverted', 'ledger history kept');

-- 2e. setting the same Safe again is a no-op for the F4a state
insert into public.dao_scan_state (chain_id, last_block, eth_block) values (59141, 900, 880);
update public.dao_state set nav_initialized = true, value_usdc = 1000000, nav_at = now() where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($$select public.set_chain_addresses(59141, %L, %L)$$, current_setting('t.safe2'), current_setting('t.plat')),
  'saving the same addresses again is accepted');
select tests.clear_authentication();
select is(tests.fstate(59141), '1:0:0:true:1000000:true', 'same Safe again: nothing is cleared');
select is((select eth_block from public.dao_scan_state where chain_id = 59141), 880::bigint, 'same Safe again: ETH cursor kept');

-- 2f. a first Safe on a chain that had none; a non-admin is still refused first
update public.chain_config set safe_address = null where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($$select public.set_chain_addresses(59141, %L, %L)$$, current_setting('t.safe1'), current_setting('t.plat')),
  'a first Safe on a chain is accepted');
select tests.clear_authentication();
select is(tests.fstate(59141), '0:0:0:false:0:false', 'a first Safe also starts from a clean F4a state');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($$select public.set_chain_addresses(59141, %L, null)$$, current_setting('t.safe2')),
  'P0001', 'forbidden', 'a non-admin is still refused first');
select tests.clear_authentication();

-- ===== 3. credit_donation refuses a read older than a block already credited on the chain =====
update public.dao_state set total_shares = 0, club_shares = 0, value_usdc = 0, nav_initialized = false, nav_at = null
  where chain_id = 59141;
-- d1 mined at 500 is credited first (read at 1000); d2 was mined earlier (100) but recorded late
select set_config('t.d1', tests.fpend(current_setting('t.ub')::uuid, 3000000, 11, 500)::text, true);
select set_config('t.d2', tests.fpend(current_setting('t.ub')::uuid, 1000000, 12, 100)::text, true);
select lives_ok(format($$select tests.fcr(%L, 4000000, 1000)$$, current_setting('t.d1')), 'd1 credited with a read at 1000');
-- a read at 300 is after d2 (100) but before d1 (500): d1's money is missing from it while d1 is no longer a liability
select throws_ok(format($$select tests.fcr(%L, 1000000, 300)$$, current_setting('t.d2')),
  'P0001', 'assets_stale', 'a read older than a credited donation block is stale');
select is((select status from public.dao_ledger where id = current_setting('t.d2')::uuid), 'pending_finality',
  'the stale credit left d2 pending (transient, retried)');
select throws_ok(format($$select tests.fcr(%L, 4000000, 499)$$, current_setting('t.d2')),
  'P0001', 'assets_stale', 'one block before the credited block is still stale');
select lives_ok(format($$select tests.fcr(%L, 4000000, 500)$$, current_setting('t.d2')),
  'a read at exactly the credited block is accepted');
select is((select status from public.dao_ledger where id = current_setting('t.d2')::uuid), 'credited', 'd2 credited');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'dao_ledger'
                  and indexname = 'dao_ledger_credited_block_idx'), 'credited blocks are indexed per chain');

select * from finish();
rollback;
