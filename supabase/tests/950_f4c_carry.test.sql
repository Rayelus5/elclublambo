-- F4c Task 1 (carry from F4a): cron writers pinned to the configured Safe (safe_changed), chain_config locked
-- for share in create_donation_intent, cancel_open_donation_intents (bit 512) and unread treasury_outflow notices
-- cleaned on a Safe reset.
begin;
select plan(38);

-- ===== helpers (rolled back with the test) =====
create function tests.ch(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.cintent(p_user uuid, p_amount numeric) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
create function tests.csnap() returns jsonb language sql immutable as $$
  select jsonb_build_object('usdcUnits', '5000000', 'ethWei', '0', 'wethWei', '0', 'ethPriceE8', '200000000000',
                            'priceSource', 'chainlink', 'blockNumber', '12345', 'assetsUsd6', '5000000')
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9500', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9501', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.safe', '0x' || lpad('5afe95001', 40, '0'), true);
select set_config('t.safe2', '0x' || lpad('5afe95002', 40, '0'), true);
select set_config('t.safem', '0x' || lpad('5afe95144', 40, '0'), true);
select set_config('t.other', '0x' || lpad('bad95001', 40, '0'), true);
-- the configured Safe in mixed case (hex digits upper-cased)
select set_config('t.safeMixed', '0x' || upper(substr(current_setting('t.safe'), 3)), true);
update public.chain_config set safe_address = current_setting('t.safe'), platform_wallet = null where chain_id = 59141;
update public.chain_config set safe_address = null, platform_wallet = null where chain_id = 59144;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
-- whatever the local database holds for 59141 is not part of these scenarios
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.dao_state set total_shares = 0, club_shares = 0 where chain_id = 59141;
delete from public.dao_scan_state where chain_id in (59141, 59144);
delete from public.dao_nav_snapshots where chain_id = 59141;

-- ===== 1. signatures and privileges =====
select hasnt_function('public', 'record_nav_snapshot', array['integer', 'jsonb'], 'record_nav_snapshot(int, jsonb) is dropped');
select hasnt_function('public', 'record_safe_operations', array['integer', 'jsonb', 'bigint'],
  'record_safe_operations(int, jsonb, bigint) is dropped');
select hasnt_function('public', 'set_dao_eth_cursor', array['integer', 'bigint'], 'set_dao_eth_cursor(int, bigint) is dropped');
select has_function('public', 'record_nav_snapshot', array['integer', 'text', 'jsonb'], 'record_nav_snapshot(int, text, jsonb) exists');
select has_function('public', 'record_safe_operations', array['integer', 'text', 'jsonb', 'bigint'],
  'record_safe_operations(int, text, jsonb, bigint) exists');
select has_function('public', 'set_dao_eth_cursor', array['integer', 'text', 'bigint'], 'set_dao_eth_cursor(int, text, bigint) exists');
select ok(has_function_privilege('service_role', 'public.record_nav_snapshot(int,text,jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_nav_snapshot(int,text,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.record_nav_snapshot(int,text,jsonb)', 'execute'),
  'record_nav_snapshot is service_role only');
select ok(has_function_privilege('service_role', 'public.record_safe_operations(int,text,jsonb,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_safe_operations(int,text,jsonb,bigint)', 'execute')
      and not has_function_privilege('anon', 'public.record_safe_operations(int,text,jsonb,bigint)', 'execute'),
  'record_safe_operations is service_role only');
select ok(has_function_privilege('service_role', 'public.set_dao_eth_cursor(int,text,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.set_dao_eth_cursor(int,text,bigint)', 'execute')
      and not has_function_privilege('anon', 'public.set_dao_eth_cursor(int,text,bigint)', 'execute'),
  'set_dao_eth_cursor is service_role only');
select ok(has_function_privilege('authenticated', 'public.cancel_open_donation_intents(int)', 'execute')
      and not has_function_privilege('anon', 'public.cancel_open_donation_intents(int)', 'execute')
      and not has_function_privilege('public', 'public.cancel_open_donation_intents(int)', 'execute'),
  'cancel_open_donation_intents is for authenticated (bit 512 checked inside), never anon');
select is((select count(*)::int from pg_proc
           where oid in ('public.record_nav_snapshot(int,text,jsonb)'::regprocedure,
                         'public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure,
                         'public.set_dao_eth_cursor(int,text,bigint)'::regprocedure,
                         'public.cancel_open_donation_intents(int)'::regprocedure)
             and prosecdef and proconfig @> array['search_path=""']), 4,
  'the four functions are security definer with an empty search_path');

-- ===== 2. the cron writers refuse a Safe other than the configured one =====
set local role service_role;
select throws_ok(format($$select public.record_safe_operations(59141, %L, '[]'::jsonb, 500)$$, current_setting('t.other')),
  'P0001', 'safe_changed', 'record_safe_operations: another Safe is refused');
select throws_ok($$select public.record_safe_operations(59141, null, '[]'::jsonb, 500)$$,
  'P0001', 'safe_changed', 'record_safe_operations: a null Safe is refused');
reset role;
select is((select count(*)::int from public.dao_scan_state where chain_id = 59141), 0,
  'a refused scan wrote nothing (no cursor)');
set local role service_role;
select lives_ok(format($$select public.record_safe_operations(59141, %L, '[]'::jsonb, 500)$$, current_setting('t.safeMixed')),
  'record_safe_operations: the configured Safe in any case is accepted');

select lives_ok(format($$select public.set_dao_eth_cursor(59141, %L, 700)$$, current_setting('t.safeMixed')),
  'set_dao_eth_cursor: the configured Safe in any case is accepted');
select throws_ok(format($$select public.set_dao_eth_cursor(59141, %L, 900)$$, current_setting('t.other')),
  'P0001', 'safe_changed', 'set_dao_eth_cursor: another Safe is refused');
select throws_ok($$select public.set_dao_eth_cursor(59141, null, 900)$$,
  'P0001', 'safe_changed', 'set_dao_eth_cursor: a null Safe is refused');
select is(public.dao_eth_scan_from(59141), 700::bigint, 'the refused cursor moves did not move it');

select throws_ok(format($$select public.record_nav_snapshot(59141, %L, tests.csnap())$$, current_setting('t.other')),
  'P0001', 'safe_changed', 'record_nav_snapshot: another Safe is refused');
select throws_ok($$select public.record_nav_snapshot(59141, null, tests.csnap())$$,
  'P0001', 'safe_changed', 'record_nav_snapshot: a null Safe is refused');
select lives_ok(format($$select public.record_nav_snapshot(59141, %L, tests.csnap())$$, current_setting('t.safeMixed')),
  'record_nav_snapshot: the configured Safe in any case is accepted');

-- a chain without a Safe refuses any Safe
select throws_ok(format($$select public.record_safe_operations(59144, %L, '[]'::jsonb, 500)$$, current_setting('t.other')),
  'P0001', 'safe_changed', 'a chain with no Safe configured refuses every Safe');
reset role;

-- ===== 3. create_donation_intent reads chain_config for share (carry b) =====
select ok(pg_get_functiondef('public.create_donation_intent(numeric,int,boolean)'::regprocedure)
          ~ 'from public\.chain_config[^;]*for share',
  'create_donation_intent reads chain_config for share');

-- ===== 4. cancel_open_donation_intents =====
select set_config('t.i_open', tests.cintent(current_setting('t.ub')::uuid, 1000000)::text, true);
select set_config('t.i_att', tests.cintent(current_setting('t.ub')::uuid, 2000000)::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select public.attach_intent_tx(current_setting('t.i_att')::uuid, 'main', tests.ch(95001));
select tests.clear_authentication();
-- review fix: a fee donation with only its main transfer attached has hashes_attached_at null but may be paid
select set_config('t.i_main', tests.cintent(current_setting('t.ub')::uuid, 3000000)::text, true);
update public.payment_intents set main_tx_hash = tests.ch(95002) where id = current_setting('t.i_main')::uuid;
select set_config('t.i_fee', tests.cintent(current_setting('t.ub')::uuid, 4000000)::text, true);
update public.payment_intents set fee_tx_hash = tests.ch(95003) where id = current_setting('t.i_fee')::uuid;
-- an open intent on the other chain
update public.chain_config set safe_address = current_setting('t.safem') where chain_id = 59144;
update public.app_config set value = '59144'::jsonb where key = 'active_chain_id';
select set_config('t.i_other', tests.cintent(current_setting('t.ub')::uuid, 1000000)::text, true);
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';

select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select public.cancel_open_donation_intents(59141)$$, 'P0001', 'forbidden',
  'a member without bit 512 cannot cancel intents');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.ua')::uuid);
select is(public.cancel_open_donation_intents(59141), 1, 'SuperAdmin cancels the one intent without a transaction');
select tests.clear_authentication();
select is((select string_agg(status, ',' order by amount) from public.payment_intents
           where id in (current_setting('t.i_open')::uuid, current_setting('t.i_att')::uuid)),
  'expired,pending', 'the unattached intent is expired; the attached one keeps pending (it may be a real payment)');
select is((select status from public.payment_intents where id = current_setting('t.i_main')::uuid
             and hashes_attached_at is null), 'pending',
  'an intent with only its main hash attached is not cancelled (it may be a real payment)');
select is((select status from public.payment_intents where id = current_setting('t.i_fee')::uuid), 'pending',
  'an intent with only its fee hash attached is not cancelled');
select is((select status from public.payment_intents where id = current_setting('t.i_other')::uuid), 'pending',
  'the other chain''s intent is untouched');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.set_chain_addresses(59141, %L, null)$$, current_setting('t.safe2')),
  'P0001', 'safe_change_blocked', 'the attached intent still blocks a Safe change');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_log
           where action = 'economy.intents_cancelled' and actor_member_id = current_setting('t.a')::uuid
             and payload = jsonb_build_object('chain', 59141, 'count', 1)), 1,
  'the cancellation is audited with {chain, count}');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is(public.cancel_open_donation_intents(59141), 0, 'a second run has nothing left to cancel');
select tests.clear_authentication();

-- ===== 5. a Safe reset deletes the unread treasury_outflow notices of that chain's operations =====
update public.payment_intents set status = 'expired'
 where id in (current_setting('t.i_att')::uuid, current_setting('t.i_main')::uuid, current_setting('t.i_fee')::uuid);
with x as (
  insert into public.dao_safe_operations (chain_id, tx_hash, log_index, asset, direction, amount, block_number, occurred_at)
  values (59141, tests.ch(95101), 0, 'USDC', 'out', 1000000, 600, now()) returning id)
select set_config('t.op1', id::text, true) from x;
with x as (
  insert into public.dao_safe_operations (chain_id, tx_hash, log_index, asset, direction, amount, block_number, occurred_at)
  values (59144, tests.ch(95102), 0, 'USDC', 'out', 1000000, 600, now()) returning id)
select set_config('t.opm', id::text, true) from x;
insert into public.notifications (recipient_id, kind, data, read_at) values
  (current_setting('t.a')::uuid, 'treasury_outflow', jsonb_build_object('opId', current_setting('t.op1'), 'tag', 'unread'), null),
  (current_setting('t.b')::uuid, 'treasury_outflow', jsonb_build_object('opId', current_setting('t.op1'), 'tag', 'read'), now()),
  (current_setting('t.a')::uuid, 'treasury_outflow', jsonb_build_object('opId', current_setting('t.opm'), 'tag', 'other'), null);

-- saving the same Safe is no reset: nothing is deleted
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.set_chain_addresses(59141, current_setting('t.safe'), null);
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where kind = 'treasury_outflow' and data ? 'tag'), 3,
  'the same Safe again deletes no notice');

select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($$select public.set_chain_addresses(59141, %L, null)$$, current_setting('t.safe2')),
  'the Safe change is accepted once nothing blocks it');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where kind = 'treasury_outflow' and data ->> 'tag' = 'unread'), 0,
  'the unread notice of the reset chain''s operation is deleted');
select is((select count(*)::int from public.notifications where kind = 'treasury_outflow' and data ->> 'tag' = 'read'), 1,
  'the read notice is kept');
select is((select count(*)::int from public.notifications where kind = 'treasury_outflow' and data ->> 'tag' = 'other'), 1,
  'the other chain''s unread notice is kept');

select * from finish();
rollback;
