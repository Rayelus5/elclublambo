-- F4c Task 4: verified withdrawal payouts. Outflow matching in the scan, payout recording (no longer a liability from
-- its block on), burn at finality, revert, the candidate reads and the public feed. Plus the Task 3 carries: liabilities
-- bounded by payout_block also for paid requests (iv), re-approval replaces the cached NAV (v), blank reasons (vi), and
-- the share-price invariant across approve -> record -> burn / revert at an unchanged Safe valuation.
begin;
select plan(139);

-- ===== helpers (rolled back with the test) =====
create function tests.xh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.xsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.xw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.xpend(p_user uuid, p_amount numeric, p_n int, p_block bigint)
returns uuid language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.xh(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_id := public.record_donation((v ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.xh(p_n), 'logIndex', 0, 'blockNumber', p_block), null);
  reset role;
  return v_id;
end;
$$;
create function tests.xa(p_req uuid, p_actor uuid, p_assets numeric, p_block bigint) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.approve_withdrawal(p_req, p_actor, tests.xsafe(), p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.xexp() returns int language plpgsql as $$
declare v int;
begin
  set local role service_role;
  v := public.expire_withdrawal_approvals(59141, now() + interval '100 days'); -- R5: scan far ahead
  reset role;
  return v;
end;
$$;
create function tests.xliab(p_block bigint) returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_liabilities_usd6(59141, p_block);
  reset role;
  return v;
end;
$$;
create function tests.xsupply() returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_supply(59141);
  reset role;
  return v;
end;
$$;
-- a snapshot of p_usdc USDC (no ETH) read at p_block; the 55-minute throttle is bypassed by ageing the last one
create function tests.xsnap(p_usdc numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  update public.dao_nav_snapshots set taken_at = taken_at - interval '1 hour' where chain_id = 59141;
  set local role service_role;
  v := public.record_nav_snapshot(59141, tests.xsafe(), jsonb_build_object(
    'usdcUnits', p_usdc::text, 'ethWei', '0', 'wethWei', '0', 'ethPriceE8', '200000000000',
    'priceSource', 'chainlink', 'blockNumber', p_block::text, 'assetsUsd6', p_usdc::text));
  reset role;
  return v;
end;
$$;
create function tests.xov(p_user uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.dao_overview();
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.xprice() returns text language sql as $$
  select tests.xov(current_setting('t.ut')::uuid) ->> 'sharePriceUsd6'
$$;
create function tests.xreq(p_user uuid, p_shares numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.request_withdrawal(p_shares);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.xstate() returns text language sql as $$
  select total_shares::text || ':' || approved_locked_shares::text || ':' || value_usdc::text
  from public.dao_state where chain_id = 59141
$$;
-- one USDC outflow of the Safe (tx p_n, log 0)
create function tests.xop(p_n int, p_amount numeric, p_to text, p_at timestamptz, p_block bigint) returns jsonb
language sql as $$
  select jsonb_build_object('txHash', tests.xh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out',
                            'amount', p_amount::text, 'counterparty', p_to, 'blockNumber', p_block,
                            'occurredAt', p_at)
$$;
create function tests.xops(p_ops jsonb, p_to_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_operations(59141, tests.xsafe(), p_ops, p_to_block);
  reset role;
  return v;
end;
$$;
create function tests.xopid(p_n int) returns uuid language sql as $$
  select o.id from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.xh(p_n)
$$;
create function tests.xopw(p_n int) returns uuid language sql as $$
  select o.withdrawal_id from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.xh(p_n)
$$;
create function tests.xalerts(p_n int) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.kind = 'treasury_outflow' and n.data ->> 'opId' = tests.xopid(p_n)::text
$$;
create function tests.xtreas() returns int language sql as $$
  select count(*)::int from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0
$$;
create function tests.xpay(p_n int, p_block bigint, p_at timestamptz, p_to text, p_amount numeric) returns jsonb
language sql as $$
  select jsonb_build_object('txHash', tests.xh(p_n), 'logIndex', '0', 'blockNumber', p_block::text,
                            'blockTime', p_at, 'to', p_to, 'amount', p_amount::text)
$$;
create function tests.xrec(p_req uuid, p_payout jsonb, p_actor uuid default null, p_safe text default null) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_withdrawal_payout(p_req, coalesce(p_safe, tests.xsafe()), p_payout, p_actor);
  reset role;
  return v;
end;
$$;
create function tests.xrecnull(p_req uuid, p_payout jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_withdrawal_payout(p_req, null, p_payout, null);
  reset role;
  return v;
end;
$$;
create function tests.xfin(p_req uuid, p_block bigint, p_safe text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.finalize_withdrawal(p_req, coalesce(p_safe, tests.xsafe()), p_block);
  reset role;
  return v;
end;
$$;
create function tests.xrev(p_req uuid) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.revert_withdrawal_payout(p_req);
  reset role;
end;
$$;
create function tests.xcand() returns text language plpgsql as $$
declare v text;
begin
  set local role service_role;
  select coalesce(string_agg(c.request_id || ':' || c.tx_hash || ':' || c.log_index || ':' || c.destination || ':'
                             || c.amount_usdc_locked || ':' || (c.approved_at = w.approved_at), ',' order by c.tx_hash), '')
    into v
  from public.withdrawal_payout_candidates(59141) c
  join public.withdrawal_requests w on w.id = c.request_id;
  reset role;
  return v;
end;
$$;
create function tests.xawait() returns text language plpgsql as $$
declare v text;
begin
  set local role service_role;
  select coalesce(string_agg(f.request_id || ':' || f.tx_hash || ':' || f.destination || ':' || f.amount_usdc_locked
                             || ':' || f.payout_block || ':' || (f.payout_recorded_at is not null)
                             || ':' || (f.approved_at is not null), ',' order by f.payout_block), '')
    into v
  from public.withdrawals_awaiting_finality(59141) f;
  reset role;
  return v;
end;
$$;
create function tests.xfeed(p_user uuid, p_n int) returns text language plpgsql as $$
declare
  v text;
  v_op uuid := tests.xopid(p_n); -- read before authenticating (members cannot read the table)
begin
  perform tests.authenticate_as(p_user);
  select coalesce(o.tx_hash, '-') || '|' || coalesce(o.note, '-') || '|' || o.explained into v
  from public.dao_operations(100) o where o.id = v_op;
  perform tests.clear_authentication();
  return v;
end;
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9530', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9531', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9532', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9533', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T953 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T953 tesorero';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);
select set_config('t.other', '0x' || lpad('5afe95399', 40, '0'), true);

update public.chain_config set safe_address = '0x' || lpad('5afe95301', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
-- whatever the local database holds is not part of these scenarios
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
-- F4c-R7 (a): the scan has covered every block these scenarios read the Safe at (956 tests the cursor guard)
insert into public.dao_scan_state (chain_id, last_block) values (59141, 1000000000)
  on conflict (chain_id) do update set last_block = excluded.last_block;
-- A 5, B 2, C 1, T 2 (x 10^18): S = 10 * 10^18 valued at 20 USDC (price 2 USDC)
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 20000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 5000000000000000000, 10000000),
  (59141, current_setting('t.b')::uuid, 2000000000000000000, 2000000),
  (59141, current_setting('t.c')::uuid, 1000000000000000000, 1000000),
  (59141, current_setting('t.t')::uuid, 2000000000000000000, 2000000);

-- C asks and cancels; A asks for 4 and the treasurer approves 8 USDC (4 * 20 / 10)
select set_config('t.rc', tests.xreq(current_setting('t.uc')::uuid, 1000000000000000000)::text, true);
select tests.authenticate_as(current_setting('t.uc')::uuid);
select public.cancel_withdrawal(current_setting('t.rc')::uuid);
select tests.clear_authentication();
select set_config('t.ra', tests.xreq(current_setting('t.ua')::uuid, 4000000000000000000)::text, true);
select tests.xa(current_setting('t.ra')::uuid, current_setting('t.t')::uuid, 20000000, 100);

-- ===== 1. grants =====
select ok(has_function_privilege('service_role', 'public.record_withdrawal_payout(uuid,text,jsonb,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_withdrawal_payout(uuid,text,jsonb,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.record_withdrawal_payout(uuid,text,jsonb,uuid)', 'execute'),
  'record_withdrawal_payout is service-only');
select ok(has_function_privilege('service_role', 'public.finalize_withdrawal(uuid,text,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.finalize_withdrawal(uuid,text,bigint)', 'execute')
      and not has_function_privilege('anon', 'public.finalize_withdrawal(uuid,text,bigint)', 'execute'),
  'finalize_withdrawal is service-only');
select ok(has_function_privilege('service_role', 'public.revert_withdrawal_payout(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.revert_withdrawal_payout(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.revert_withdrawal_payout(uuid)', 'execute'),
  'revert_withdrawal_payout is service-only');
select ok(has_function_privilege('service_role', 'public.withdrawal_payout_candidates(int)', 'execute')
      and not has_function_privilege('authenticated', 'public.withdrawal_payout_candidates(int)', 'execute')
      and not has_function_privilege('anon', 'public.withdrawal_payout_candidates(int)', 'execute'),
  'withdrawal_payout_candidates is service-only');
select ok(has_function_privilege('service_role', 'public.withdrawals_awaiting_finality(int)', 'execute')
      and not has_function_privilege('authenticated', 'public.withdrawals_awaiting_finality(int)', 'execute')
      and not has_function_privilege('anon', 'public.withdrawals_awaiting_finality(int)', 'execute'),
  'withdrawals_awaiting_finality is service-only');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.record_withdrawal_payout(uuid,text,jsonb,uuid)'::regprocedure,
                         'public.finalize_withdrawal(uuid,text,bigint)'::regprocedure,
                         'public.revert_withdrawal_payout(uuid)'::regprocedure,
                         'public.withdrawal_payout_candidates(int)'::regprocedure,
                         'public.withdrawals_awaiting_finality(int)'::regprocedure,
                         'public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure,
                         'public.dao_operations(int)'::regprocedure)),
  'the new and replaced functions are definer with an empty search_path');

-- ===== 2. matching scan =====
select is(tests.xstate(), '10000000000000000000:4000000000000000000:12000000', 'setup: A approved for 8 USDC, NAV 12');
select ok(tests.xtreas() >= 1, 'there is at least one treasurer to alert');
select is(tests.xops(jsonb_build_array(tests.xop(201, 8000000, tests.xw('a'), now() + interval '1 minute', 110)), 110),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'a USDC out of 8 to A after approved_at is inserted without an alert');
select is(tests.xopw(201), current_setting('t.ra')::uuid, 'the outflow is linked to A''s request');
select is(tests.xalerts(201), 0, 'no treasurer gets treasury_outflow for it');
select is((select alerted_at from public.dao_safe_operations where id = tests.xopid(201)), null, 'and it is not marked alerted');
select is(tests.xcand(),
  current_setting('t.ra') || ':' || tests.xh(201) || ':0:' || tests.xw('a') || ':8000000:true',
  'withdrawal_payout_candidates lists it with the destination, fixed amount and approved_at');

-- ===== 3. non-matching outflows alert =====
select is(tests.xops(jsonb_build_array(
    tests.xop(202, 7999999, tests.xw('a'), now() + interval '1 minute', 111),
    tests.xop(203, 8000000, tests.xw('b'), now() + interval '1 minute', 111),
    tests.xop(204, 2000000, tests.xw('c'), now() + interval '1 minute', 111),
    tests.xop(205, 8000000, tests.xw('a'), now() - interval '121 seconds', 111)), 111),
  jsonb_build_object('inserted', 4, 'alerts', 4 * tests.xtreas()), 'four non-matching outflows: four alerts per treasurer');
select ok(tests.xopw(202) is null and tests.xalerts(202) = tests.xtreas(), '7.999999 to A: not linked, one alert per treasurer');
select ok(tests.xopw(203) is null and tests.xalerts(203) = tests.xtreas(), '8 to B (no request): not linked, alerted');
select ok(tests.xopw(204) is null and tests.xalerts(204) = tests.xtreas(), 'to C (cancelled request): not linked, alerted');
select ok(tests.xopw(205) is null and tests.xalerts(205) = tests.xtreas(), 'dated before approved_at - 120 s: not linked, alerted');
select is(tests.xcand(),
  current_setting('t.ra') || ':' || tests.xh(201) || ':0:' || tests.xw('a') || ':8000000:true',
  'the candidates are unchanged');
-- fix round 1: a linked candidate is a real payment awaiting verification; the request cannot be rejected meanwhile
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra'), 'motivo'),
  'invalid_state', 'an approved request with a linked payout candidate cannot be rejected');
select tests.clear_authentication();
select is((select status from public.withdrawal_requests where id = current_setting('t.ra')::uuid), 'approved',
  'and stays approved');
-- the scan's match locks the request row (a concurrent record / reject is waited for and re-checked)
select ok((select pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure)
           ~* 'limit 1\s+for update of w'), 'the scan''s match query takes the request row lock (for update of w)');

-- ===== 4. record =====
select set_config('t.pa', tests.xpay(206, 120, now() + interval '2 minutes', tests.xw('a'), 8500000)::text, true);
select is(tests.xrec(current_setting('t.ra')::uuid, current_setting('t.pa')::jsonb, current_setting('t.t')::uuid),
  '{"status": "recorded"}'::jsonb, 'an overpaid payout of 8.5 USDC is recorded');
select is((select status || ':' || payout_tx_hash || ':' || payout_log_index || ':' || payout_block || ':' || payout_amount
                  || ':' || payout_recorded_by || ':' || (payout_recorded_at = now())
           from public.withdrawal_requests where id = current_setting('t.ra')::uuid),
  'approved:' || tests.xh(206) || ':0:120:8500000:' || current_setting('t.t') || ':true',
  'the payout columns are set and the request stays approved until finality');
select is((select payload from public.audit_log where action = 'withdrawal_payout_recorded'
             and target_id = current_setting('t.ra')::uuid and actor_member_id = current_setting('t.t')::uuid),
  jsonb_build_object('request', current_setting('t.ra'), 'txHash', tests.xh(206), 'logIndex', 0,
                     'blockNumber', 120, 'amount', '8500000'),
  'audit withdrawal_payout_recorded by the treasurer');
select is(tests.xrec(current_setting('t.ra')::uuid, current_setting('t.pa')::jsonb, current_setting('t.t')::uuid),
  '{"status": "already"}'::jsonb, 'the same call again returns already');
select is((select count(*)::int from public.audit_log where action = 'withdrawal_payout_recorded'
             and target_id = current_setting('t.ra')::uuid), 1, 'and writes no second audit entry');
select is(tests.xstate(), '10000000000000000000:4000000000000000000:12000000',
  'recording leaves value_usdc alone (liability and Safe USDC drop together)');
select is(tests.xliab(119), 8000000::numeric, 'liabilities at payout_block - 1 still hold the 8 USDC');
select is(tests.xliab(120), 0::numeric, 'liabilities at payout_block are 0');
select is(tests.xliab(null), 0::numeric, 'and on the read path');
select is(tests.xsupply(), 6000000000000000000::numeric, '_dao_supply still excludes the locked shares');
select is(tests.xprice(), '2000000', 'the share price is unchanged by the recording');
-- the other outflow linked to A is no longer the payout: it becomes unexplained and alerts once
select ok(tests.xopw(201) is null and tests.xalerts(201) = tests.xtreas()
          and (select alerted_at is not null from public.dao_safe_operations where id = tests.xopid(201)),
  'the earlier candidate (another tx) is unlinked and alerts the treasurers once');
select is(tests.xops(jsonb_build_array(tests.xop(206, 8500000, tests.xw('a'), now() + interval '2 minutes', 120)), 120),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'the scan later finds the recorded payout: no alert');
select is(tests.xopw(206), current_setting('t.ra')::uuid, 'and links it to the request');
select is(tests.xcand(), '', 'a request with a recorded payout is no longer a candidate');
select is(tests.xawait(),
  current_setting('t.ra') || ':' || tests.xh(206) || ':' || tests.xw('a') || ':8000000:120:true:true',
  'withdrawals_awaiting_finality lists it');

-- ===== 5. record guards (B approved for 2 USDC, read before A's payout block) =====
select set_config('t.rb', tests.xreq(current_setting('t.ub')::uuid, 1000000000000000000)::text, true);
select is(tests.xa(current_setting('t.rb')::uuid, current_setting('t.t')::uuid, 20000000, 119) ->> 'amountUsdc', '2000000',
  'an approval read at block 119 still counts A''s 8 USDC: floor(1 * 12 / 6) = 2');
select is(tests.xstate(), '10000000000000000000:5000000000000000000:10000000', 'approved 5, NAV 10');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('a'), 2000000)),
  'tx_mismatch', 'a payout to another wallet raises tx_mismatch');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 1999999)),
  'tx_mismatch', 'a payout under the fixed amount raises tx_mismatch');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() - interval '121 seconds', tests.xw('b'), 2000000)),
  'tx_too_old', 'a block time before approved_at - 120 s raises tx_too_old');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '14 days 1 second', tests.xw('b'), 2000000)),
  'approval_expired', 'a block time after approved_at + 14 days raises approval_expired');
select set_config('t.lg', tests.xpend(current_setting('t.ub')::uuid, 1000000, 95399, 50)::text, true);
update public.dao_ledger set status = 'reverted' where id = current_setting('t.lg')::uuid;
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(95399, 130, now() + interval '1 minute', tests.xw('b'), 2000000)),
  'tx_already_used', 'a tx of a dao_ledger donation raises tx_already_used');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(206, 130, now() + interval '1 minute', tests.xw('b'), 2000000)),
  'tx_already_used', 'a tx/log already used by another request raises tx_already_used');
select throws_ok(format('select tests.xrec(%L, %L, null, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 2000000), current_setting('t.other')),
  'safe_changed', 'a different Safe raises safe_changed');
select throws_ok(format('select tests.xrecnull(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 2000000)),
  'safe_changed', 'a null Safe raises safe_changed');
select throws_ok(format('select tests.xrec(%L, %L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 2000000), current_setting('t.a')),
  'forbidden', 'a non-256 actor raises forbidden');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rc'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('c'), 2000000)),
  'invalid_state', 'a cancelled request raises invalid_state');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(203, 130, now() + interval '1 minute', tests.xw('b'), 2000000)),
  'tx_mismatch', 'a payload that disagrees with the scanned operation of the same tx/log (8 USDC) raises tx_mismatch');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'withdrawal_requests'
                  and indexname = 'withdrawal_requests_payout_block_idx'),
  'the liabilities scan has a partial index on (chain_id, payout_block)');
select throws_ok(format('select tests.xrec(%L, %L)', gen_random_uuid(),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 2000000)),
  'not_found', 'an unknown request raises not_found');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 2000000) || '{"amount": "1.5"}'),
  'invalid_input', 'a malformed amount raises invalid_input');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 2000000) || '{"blockTime": "ayer"}'),
  'invalid_input', 'a malformed block time raises invalid_input');
select is((select payout_tx_hash from public.withdrawal_requests where id = current_setting('t.rb')::uuid), null,
  'none of the refused payouts was recorded');
select is(tests.xstate(), '10000000000000000000:5000000000000000000:10000000', 'and nothing moved');

-- ===== 6. expiry skips recorded payouts; an expired request refuses the payout =====
update public.withdrawal_requests set approved_at = approved_at - interval '15 days'
  where id in (current_setting('t.ra')::uuid, current_setting('t.rb')::uuid);
select is(tests.xexp(), 1, 'only B''s approval (no payout) expires');
select is((select status from public.withdrawal_requests where id = current_setting('t.ra')::uuid), 'approved',
  'A''s request with a recorded payout stays approved after 15 days');
select is((select status || ':' || (last_expired_at is not null) from public.withdrawal_requests
           where id = current_setting('t.rb')::uuid), 'pending:true', 'B''s is pending again with last_expired_at');
select throws_ok(format('select tests.xrec(%L, %L)', current_setting('t.rb'),
                        tests.xpay(301, 130, now() + interval '1 minute', tests.xw('b'), 2000000)),
  'approval_expired', 'a payout pasted for an expired request raises approval_expired');
select is(tests.xstate(), '10000000000000000000:4000000000000000000:12000000', 'B''s 2 USDC went back to the NAV');
-- carry (v): a re-approval under another valuation replaces the cache (it does not add to it)
select is(tests.xa(current_setting('t.rb')::uuid, current_setting('t.t')::uuid, 11500000, 125) ->> 'amountUsdc', '1916666',
  're-approval at assets 11.5 (A paid at 120): floor(1 * 11.5 / 6) = 1.916666');
select is(tests.xstate(), '10000000000000000000:5000000000000000000:9583334',
  'the cached NAV is the fresh 11.5 - 1.916666, not the old 12 - 1.916666');
select is((select approval_count from public.withdrawal_requests where id = current_setting('t.rb')::uuid), 2,
  'approval_count = 2');

-- ===== 7. finalize =====
select is(tests.xfin(current_setting('t.ra')::uuid, 119), '{"status": "pending"}'::jsonb,
  'finality before payout_block: pending');
select is(tests.xfin(current_setting('t.rb')::uuid, 1000), '{"status": "pending"}'::jsonb, 'no payout recorded: pending');
select throws_ok(format('select tests.xfin(%L, 1000)', current_setting('t.rc')), 'invalid_state',
  'a cancelled request cannot be finalized');
select throws_ok(format('select tests.xfin(%L, 120, %L)', current_setting('t.ra'), current_setting('t.other')), 'safe_changed',
  'finalize with a different Safe raises safe_changed');
select throws_ok(format('select tests.xfin(%L, null)', current_setting('t.ra')), 'invalid_input', 'a null block is invalid');
select set_config('t.p7', tests.xprice(), true);
select is(current_setting('t.p7'), '1916666', 'price before the burn: 9.583334 / 5');
select is(tests.xfin(current_setting('t.ra')::uuid, 120), '{"status": "paid"}'::jsonb, 'finality at payout_block: paid');
select is((select status || ':' || (paid_at = now()) from public.withdrawal_requests where id = current_setting('t.ra')::uuid),
  'paid:true', 'the request is paid with paid_at');
select is((select shares::text || ':' || locked_shares::text || ':' || net_contributed_usdc::text from public.dao_positions
           where chain_id = 59141 and member_id = current_setting('t.a')::uuid),
  '1000000000000000000:0:1500000', 'A keeps 1 share, no lock, net = 10 - 8.5');
select is(tests.xstate(), '6000000000000000000:1000000000000000000:9583334',
  'total_shares and approved_locked_shares drop by 4; value_usdc is unchanged');
select is(tests.xprice(), current_setting('t.p7'), 'the burn leaves the share price unchanged');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.a')::uuid
             and kind = 'withdrawal_paid'
             and data = jsonb_build_object('requestId', current_setting('t.ra'), 'amount', '8500000')), 1,
  'A gets withdrawal_paid with the amount transferred');
select is(tests.xfin(current_setting('t.ra')::uuid, 500), '{"status": "already"}'::jsonb, 'a second call returns already');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.a')::uuid
             and kind = 'withdrawal_paid'), 1, 'and notifies nothing more');
select is(tests.xstate(), '6000000000000000000:1000000000000000000:9583334', 'and burns nothing more');
select is((select coalesce(actor_member_id::text, 'null') || ' ' || payload::text from public.audit_log
           where action = 'withdrawal_paid' and target_id = current_setting('t.ra')::uuid),
  'null ' || jsonb_build_object('request', current_setting('t.ra'), 'txHash', tests.xh(206), 'amount', '8500000',
                                'shares', '4000000000000000000')::text,
  'R4: finalize writes one audit withdrawal_paid (no actor) with the payout and the burned shares');
-- carry (iv): a read before the payout block still holds the paid USDC, so the paid request still counts there
select is(tests.xliab(119), 9916666::numeric, 'liabilities at 119 after the burn: A''s 8 (paid at 120) + B''s 1.916666');
select is(tests.xliab(120), 1916666::numeric, 'from 120 on only B''s');
select is(tests.xliab(null), 1916666::numeric, 'read path: only B''s');
select is((select share_bps::text || ':' || net_usdc::text from public._member_dao_standing(current_setting('t.a')::uuid)),
  '2000:1500000', 'gating: A holds 1 of S_eff 5 with net 1.5');

-- ===== 8. revert (B, detected by the scan, recorded by the cron) =====
select is(tests.xops(jsonb_build_array(tests.xop(210, 1916666, tests.xw('b'), now() + interval '3 minutes', 140)), 140),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'the scan links B''s exact payout without an alert');
select is(tests.xcand(),
  current_setting('t.rb') || ':' || tests.xh(210) || ':0:' || tests.xw('b') || ':1916666:true', 'B''s payout is a candidate');
-- R3: aged 15 days with its linked candidate inside the window, the approval does not expire
update public.withdrawal_requests set approved_at = approved_at - interval '15 days' where id = current_setting('t.rb')::uuid;
update public.dao_safe_operations set occurred_at = now() - interval '14 days' where id = tests.xopid(210);
select is(tests.xexp(), 0, 'R3: an approval with a linked candidate inside its window is not expired');
select is((select status from public.withdrawal_requests where id = current_setting('t.rb')::uuid), 'approved', 'B stays approved');
update public.withdrawal_requests set approved_at = approved_at + interval '15 days' where id = current_setting('t.rb')::uuid;
update public.dao_safe_operations set occurred_at = now() + interval '3 minutes' where id = tests.xopid(210);
select is(tests.xrec(current_setting('t.rb')::uuid, tests.xpay(210, 140, now() + interval '3 minutes', tests.xw('b'), 1916666)),
  '{"status": "recorded"}'::jsonb, 'the cron records it (no actor)');
select is((select (payout_recorded_by is null)::text from public.withdrawal_requests where id = current_setting('t.rb')::uuid),
  'true', 'detected by the cron: payout_recorded_by is null');
select is((select count(*)::int from public.audit_log where action = 'withdrawal_payout_recorded'
             and target_id = current_setting('t.rb')::uuid and actor_member_id is null), 1,
  'R4: a cron-recorded payout is audited with a null actor');
select is(tests.xawait(),
  current_setting('t.rb') || ':' || tests.xh(210) || ':' || tests.xw('b') || ':1916666:140:true:true',
  'B awaits finality (A is paid and gone from the list)');
select throws_ok(format('select tests.xrev(%L)', current_setting('t.ra')), 'invalid_state', 'a paid request cannot be reverted');
select throws_ok(format('select tests.xrev(%L)', current_setting('t.rc')), 'invalid_state', 'a cancelled request cannot be reverted');
select lives_ok(format('select tests.xrev(%L)', current_setting('t.rb')), 'B''s payout is reverted');
select is((select payload from public.audit_log where action = 'withdrawal_payout_reverted'
             and target_id = current_setting('t.rb')::uuid and actor_member_id is null),
  jsonb_build_object('request', current_setting('t.rb'), 'txHash', tests.xh(210), 'logIndex', 0, 'blockNumber', 140,
                     'amount', '1916666'),
  'R4: the revert is audited with the payout it cleared');
select is((select status || ':' || coalesce(payout_tx_hash, '-') || ':' || coalesce(payout_block::text, '-') || ':'
                  || coalesce(payout_amount::text, '-') || ':' || (payout_recorded_at is null)
           from public.withdrawal_requests where id = current_setting('t.rb')::uuid),
  'approved:-:-:-:true', 'the payout columns are cleared and the request is approved again');
select throws_ok(format('select tests.xrev(%L)', current_setting('t.rb')), 'invalid_state', 'a request without a payout cannot be reverted');
select is(tests.xopw(210), null, 'the operation is unlinked');
select is(tests.xalerts(210), tests.xtreas(), 'and alerts the treasurers once');
select is(tests.xfeed(current_setting('t.ut')::uuid, 210), tests.xh(210) || '|-|false', 'dao_operations shows it unexplained');
select is(tests.xliab(null), 1916666::numeric, 'B''s fixed amount is a liability again');
select is(tests.xstate(), '6000000000000000000:1000000000000000000:9583334', 'record and revert leave the cache alone');
select is(tests.xawait(), '', 'nothing awaits finality');

-- ===== 9. public feed =====
select is(tests.xfeed(current_setting('t.ub')::uuid, 206), '-|Retirada de un miembro|true',
  'a plain member sees the linked payout as Retirada de un miembro, explained, without the hash');
select is(tests.xfeed(current_setting('t.ut')::uuid, 206), tests.xh(206) || '|Retirada de un miembro|true',
  'a treasurer sees the hash');
select is(tests.xfeed(current_setting('t.ub')::uuid, 203), tests.xh(203) || '|-|false',
  'an unexplained outflow keeps its hash for members and stays unexplained');
select ok((select not exists (select 1 from unnest(p.proargnames) a
                              where a ~* 'counterparty|destination|wallet|member|recipient')
           from pg_proc p where p.oid = 'public.dao_operations(int)'::regprocedure),
  'no dao_operations column names the counterparty');
-- defense in depth: a link to a request that is neither approved nor paid explains nothing
update public.dao_safe_operations set withdrawal_id = current_setting('t.rc')::uuid where id = tests.xopid(204);
select is(tests.xfeed(current_setting('t.ut')::uuid, 204), tests.xh(204) || '|-|false',
  'an outflow linked to a cancelled request is unexplained for treasurers');
select is(tests.xfeed(current_setting('t.ub')::uuid, 204), tests.xh(204) || '|-|false',
  'and for members, with its hash like any unexplained outflow');
update public.dao_safe_operations set withdrawal_id = current_setting('t.ra')::uuid where id = tests.xopid(205);
select is(tests.xfeed(current_setting('t.ub')::uuid, 205), tests.xh(205) || '|-|false',
  'an outflow linked to a paid request that is not its payout is unexplained');
update public.dao_safe_operations set withdrawal_id = null where id in (tests.xopid(204), tests.xopid(205));

-- ===== 10. invariant: another holder's price at an unchanged Safe valuation =====
-- Safe: 11.916666 USDC. Liabilities: B's 1.916666. NAV 10 over S_eff 5 -> 2 USDC.
select is(tests.xsnap(11916666, 150) ->> 'navUsd6', '10000000', 'baseline snapshot: NAV 10');
select set_config('t.p0', tests.xprice(), true);
select is(current_setting('t.p0'), '2000000', '(a) before approval: 2 USDC');
select set_config('t.rc2', tests.xreq(current_setting('t.uc')::uuid, 1000000000000000000)::text, true);
select is(tests.xa(current_setting('t.rc2')::uuid, current_setting('t.t')::uuid, 11916666, 150) ->> 'amountUsdc', '2000000',
  'C''s whole share is approved at 2 USDC');
select is(tests.xprice(), current_setting('t.p0'), '(b) after approval: unchanged');
select is(tests.xrec(current_setting('t.rc2')::uuid, tests.xpay(220, 160, now() - interval '119 seconds', tests.xw('c'), 2000000),
                     current_setting('t.t')::uuid),
  '{"status": "recorded"}'::jsonb, 'C''s payout is recorded (a block time 119 s before approved_at is inside the tolerance)');
select is(tests.xprice(), current_setting('t.p0'), '(c) after recording: unchanged (cached)');
select is(tests.xsnap(9916666, 160) ->> 'navUsd6', '8000000', 'a snapshot at the payout block without the paid 2 USDC: NAV 8');
select is(tests.xprice(), current_setting('t.p0'), '(c) after a snapshot missing the paid USDC: unchanged');
select is((select total_shares from public.dao_nav_snapshots where chain_id = 59141 order by taken_at desc limit 1),
  4000000000000000000::numeric, 'the snapshot stores S_eff = 4');
select lives_ok(format('select tests.xrev(%L)', current_setting('t.rc2')), 'C''s payout is reverted (it never landed)');
select is(tests.xprice(), current_setting('t.p0'), '(e) after the revert: unchanged (cached)');
select is(tests.xsnap(11916666, 170) ->> 'navUsd6', '8000000', 'a snapshot with the 2 USDC back in the Safe: NAV 8');
select is(tests.xprice(), current_setting('t.p0'), '(e) after a snapshot with the USDC still in the Safe: unchanged');
select is(tests.xrec(current_setting('t.rc2')::uuid, tests.xpay(221, 180, now() + interval '5 minutes', tests.xw('c'), 2000000),
                     current_setting('t.t')::uuid),
  '{"status": "recorded"}'::jsonb, 'a new payout is recorded');
select is(tests.xsnap(9916666, 180) ->> 'navUsd6', '8000000', 'snapshot at the new payout block: NAV 8');
select is(tests.xprice(), current_setting('t.p0'), '(c) again: unchanged');
select is(tests.xfin(current_setting('t.rc2')::uuid, 180), '{"status": "paid"}'::jsonb, 'C''s withdrawal is burned at finality');
select is(tests.xstate(), '5000000000000000000:1000000000000000000:8000000', 'total 5, approved 1 (B), NAV 8');
select is(tests.xprice(), current_setting('t.p0'), '(d) after the burn: unchanged (cached)');
select is(tests.xsnap(9916666, 190) ->> 'navUsd6', '8000000', 'snapshot after the burn: NAV 8');
select is(tests.xprice(), current_setting('t.p0'), '(d) after the burn and a snapshot: unchanged');
select is(tests.xov(current_setting('t.ut')::uuid) ->> 'myValueUsd6', '4000000', 'T still holds 4 USD');
select is(tests.xliab(179), 3916666::numeric, 'carry (iv): a read before C''s payout block still counts C''s 2 USDC');
select is(tests.xliab(180), 1916666::numeric, 'and not from the payout block on');

-- ===== 11. carry (vi): a reason made only of tabs / newlines is empty =====
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.rb'), E'\t\n\r \t'),
  'reason_required', 'an all-whitespace reason (tabs, newlines) raises reason_required');
select lives_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.rb'), E'\n\tSin liquidez\t\n'),
  'a reason with surrounding tabs and newlines is accepted');
select tests.clear_authentication();
select is((select reject_reason from public.withdrawal_requests where id = current_setting('t.rb')::uuid), 'Sin liquidez',
  'and stored trimmed of every kind of whitespace');

select * from finish();
rollback;
