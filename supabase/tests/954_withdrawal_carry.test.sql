-- F4c Task 5 carries (SQL, migration 20261019300005):
--   (A) expire_withdrawal_approvals re-checks "no linked outflow inside the window" after locking each request;
--   (B) _dao_liabilities_usd6's withdrawal filter is a plain OR under a top-level status filter (partial index usable);
--   (C) the scan's exact-payout match takes `for share of w` (a concurrent revert is waited for and re-checked);
--   (D) a request whose linked outflow is outside its window still expires (and that outflow alerts once);
--   (E) unlink_withdrawal_candidate: a linked candidate that fails verification permanently is unlinked with an alert,
--       so the request can be rejected or expire and stops being a liability forever.
begin;
select plan(89);

-- ===== helpers (rolled back with the test) =====
create function tests.yh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.ysafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.yw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.ya(p_req uuid, p_actor uuid, p_assets numeric, p_block bigint) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.approve_withdrawal(p_req, p_actor, tests.ysafe(), p_assets, p_block);
  reset role;
  return v;
end;
$$;
-- R5: by default the scan has covered far beyond any window, so only the now() rule binds
create function tests.yexp(p_through timestamptz default now() + interval '100 days', p_chain int default 59141)
returns int language plpgsql as $$
declare v int;
begin
  set local role service_role;
  v := public.expire_withdrawal_approvals(p_chain, p_through);
  reset role;
  return v;
end;
$$;
create function tests.ypmiss(p_req uuid, p_missing boolean) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.withdrawal_payout_missing(p_req, p_missing);
  reset role;
  return v;
end;
$$;
create function tests.ycmiss(p_req uuid, p_n int, p_missing boolean) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.withdrawal_candidate_missing(p_req, tests.yh(p_n), 0, p_missing);
  reset role;
  return v;
end;
$$;
create function tests.yrev(p_req uuid) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.revert_withdrawal_payout(p_req);
  reset role;
end;
$$;
create function tests.yliab(p_block bigint) returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_liabilities_usd6(59141, p_block);
  reset role;
  return v;
end;
$$;
create function tests.yreq(p_user uuid, p_shares numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.request_withdrawal(p_shares);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.yop(p_n int, p_amount numeric, p_to text, p_at timestamptz, p_block bigint) returns jsonb
language sql as $$
  select jsonb_build_object('txHash', tests.yh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out',
                            'amount', p_amount::text, 'counterparty', p_to, 'blockNumber', p_block,
                            'occurredAt', p_at)
$$;
create function tests.yops(p_ops jsonb, p_to_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_operations(59141, tests.ysafe(), p_ops, p_to_block);
  reset role;
  return v;
end;
$$;
create function tests.yopid(p_n int) returns uuid language sql as $$
  select o.id from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.yh(p_n)
$$;
create function tests.yopw(p_n int) returns uuid language sql as $$
  select o.withdrawal_id from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.yh(p_n)
$$;
create function tests.yalerts(p_n int) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.kind = 'treasury_outflow' and n.data ->> 'opId' = tests.yopid(p_n)::text
$$;
create function tests.ytreas() returns int language sql as $$
  select count(*)::int from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0
$$;
create function tests.ypay(p_n int, p_block bigint, p_at timestamptz, p_to text, p_amount numeric) returns jsonb
language sql as $$
  select jsonb_build_object('txHash', tests.yh(p_n), 'logIndex', '0', 'blockNumber', p_block::text,
                            'blockTime', p_at, 'to', p_to, 'amount', p_amount::text)
$$;
create function tests.yrec(p_req uuid, p_payout jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_withdrawal_payout(p_req, tests.ysafe(), p_payout, null);
  reset role;
  return v;
end;
$$;
create function tests.yfin(p_req uuid, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.finalize_withdrawal(p_req, tests.ysafe(), p_block);
  reset role;
  return v;
end;
$$;
create function tests.yun(p_req uuid, p_n int, p_reason text) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.unlink_withdrawal_candidate(p_req, tests.yh(p_n), 0, p_reason);
  reset role;
  return v;
end;
$$;
create function tests.ycand() returns text language plpgsql as $$
declare v text;
begin
  set local role service_role;
  select coalesce(string_agg(c.request_id || ':' || c.tx_hash, ',' order by c.tx_hash), '') into v
  from public.withdrawal_payout_candidates(59141) c;
  reset role;
  return v;
end;
$$;
create function tests.ystatus(p_req text) returns text language sql as $$
  select status from public.withdrawal_requests where id = current_setting('t.' || p_req)::uuid
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9540', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9541', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9542', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9543', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T954 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T954 tesorero';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);

update public.chain_config set safe_address = '0x' || lpad('5afe95401', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
-- A 5, B 2, C 1, T 2 (x 10^18): S = 10 * 10^18 valued at 20 USDC
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 20000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 5000000000000000000, 10000000),
  (59141, current_setting('t.b')::uuid, 2000000000000000000, 2000000),
  (59141, current_setting('t.c')::uuid, 1000000000000000000, 1000000),
  (59141, current_setting('t.t')::uuid, 2000000000000000000, 2000000);

-- A asks for 4 and is approved at 8 USDC (4 * 20 / 10)
select set_config('t.ra', tests.yreq(current_setting('t.ua')::uuid, 4000000000000000000)::text, true);
select tests.ya(current_setting('t.ra')::uuid, current_setting('t.t')::uuid, 20000000, 100);

-- ===== 1. grants and definer =====
select ok(has_function_privilege('service_role', 'public.unlink_withdrawal_candidate(uuid,text,int,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.unlink_withdrawal_candidate(uuid,text,int,text)', 'execute')
      and not has_function_privilege('anon', 'public.unlink_withdrawal_candidate(uuid,text,int,text)', 'execute'),
  'unlink_withdrawal_candidate is service-only');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.unlink_withdrawal_candidate(uuid,text,int,text)'::regprocedure,
                         'public._dao_liabilities_usd6(int,bigint)'::regprocedure,
                         'public.expire_withdrawal_approvals(int,timestamptz)'::regprocedure,
                         'public.withdrawal_payout_missing(uuid,boolean)'::regprocedure,
                         'public.withdrawal_candidate_missing(uuid,text,int,boolean)'::regprocedure,
                         'public.revert_withdrawal_payout(uuid)'::regprocedure,
                         'public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure)),
  'the new and replaced functions are definer with an empty search_path');
select ok(not has_function_privilege('authenticated', 'public.expire_withdrawal_approvals(int,timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.expire_withdrawal_approvals(int,timestamptz)', 'execute')
      and has_function_privilege('service_role', 'public.expire_withdrawal_approvals(int,timestamptz)', 'execute'),
  'R5: expire_withdrawal_approvals(chain, scanned_through) is service-only');
select hasnt_function('public', 'expire_withdrawal_approvals', array[]::text[],
  'R5: the argument-less expiry is gone (it could run past what the scan covered)');
select ok(has_function_privilege('service_role', 'public.withdrawal_payout_missing(uuid,boolean)', 'execute')
      and not has_function_privilege('authenticated', 'public.withdrawal_payout_missing(uuid,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.withdrawal_payout_missing(uuid,boolean)', 'execute'),
  'withdrawal_payout_missing is service-only');
select ok(has_function_privilege('service_role', 'public.withdrawal_candidate_missing(uuid,text,int,boolean)', 'execute')
      and not has_function_privilege('authenticated', 'public.withdrawal_candidate_missing(uuid,text,int,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.withdrawal_candidate_missing(uuid,text,int,boolean)', 'execute'),
  'withdrawal_candidate_missing is service-only');

-- ===== 2. carry (B): plain OR, same results =====
select ok((select prosrc !~* '\mcase\M' and prosrc ~* 'w\.status in \(''approved'', ''paid''\)'
           from pg_proc where oid = 'public._dao_liabilities_usd6(int,bigint)'::regprocedure),
  '(B) the withdrawal filter has no CASE and a top-level status in (approved, paid) (partial index predicate)');
select is(tests.yliab(null), 8000000::numeric, '(B) read path: the approved, unpaid 8 USDC');
select is(tests.yliab(99), 8000000::numeric, '(B) bounded read: approved without payout counts at any block');
select is(tests.yrec(current_setting('t.ra')::uuid, tests.ypay(301, 150, now() + interval '1 minute', tests.yw('a'), 8000000)),
  '{"status": "recorded"}'::jsonb, 'A''s payout is recorded at block 150');
select is(tests.yliab(null), 0::numeric, '(B) read path: a recorded payout no longer counts');
select is(tests.yliab(149), 8000000::numeric, '(B) a read before the payout block still counts it');
select is(tests.yliab(150), 0::numeric, '(B) and not from the payout block on');

-- ===== 3. carry (C): the exact-payout match takes a share lock =====
select ok((select pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure)
           ~* 'w\.payout_log_index = v_log\s+for share of w'),
  '(C) the scan''s exact-payout match takes for share of w');
select ok((select pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure)
           ~* 'limit 1\s+for update of w'), 'the candidate match keeps for update of w');
select is(tests.yops(jsonb_build_array(tests.yop(301, 8000000, tests.yw('a'), now() + interval '1 minute', 150)), 150),
  jsonb_build_object('inserted', 1, 'alerts', 0), '(C) the scan links the recorded payout without an alert');
select is(tests.yopw(301), current_setting('t.ra')::uuid, '(C) linked to A''s request');
select throws_ok(format('select tests.yun(%L, 301, %L)', current_setting('t.ra'), 'failed'),
  'invalid_state', '(E) a recorded payout cannot be unlinked as a candidate (revert it instead)');
select is(tests.yfin(current_setting('t.ra')::uuid, 150), '{"status": "paid"}'::jsonb, 'A is burned at finality');
select is(tests.yliab(149), 8000000::numeric, '(B) paid branch: a read before the payout block still counts it');
select is(tests.yliab(150), 0::numeric, '(B) paid branch: not from the payout block on');
select is(tests.yliab(null), 0::numeric, '(B) paid branch: not on the read path');
select throws_ok(format('select tests.yun(%L, 301, %L)', current_setting('t.ra'), 'failed'),
  'invalid_state', '(E) a paid request has no candidate to unlink');

-- ===== 4. carry (E): unlink_withdrawal_candidate =====
-- B asks for all 2 and is approved: S_eff 6, assets 20 at block 160 (A paid at 150), NAV 20 -> 2 * 20 / 6
select set_config('t.rb', tests.yreq(current_setting('t.ub')::uuid, 2000000000000000000)::text, true);
select set_config('t.amb', tests.ya(current_setting('t.rb')::uuid, current_setting('t.t')::uuid, 20000000, 160) ->> 'amountUsdc', true);
select is(current_setting('t.amb'), '6666666', 'B is approved at 6.666666 USDC');
select is(tests.yops(jsonb_build_array(tests.yop(310, 6666666, tests.yw('b'), now() + interval '1 minute', 170)), 170),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'the scan links an outflow to B as a candidate');
select is(tests.ycand(), current_setting('t.rb') || ':' || tests.yh(310), 'it is B''s payout candidate');
select throws_ok(format('select tests.yun(%L, 310, %L)', current_setting('t.rb'), 'bogus'),
  'invalid_input', 'an unknown reason raises invalid_input');
select throws_ok(format('select tests.yun(%L, 310, null)', current_setting('t.rb')),
  'invalid_input', 'a null reason raises invalid_input');
select throws_ok(format('select tests.yun(%L, 310, %L)', gen_random_uuid(), 'failed'),
  'not_found', 'an unknown request raises not_found');
select is(tests.yun(current_setting('t.rb')::uuid, 311, 'failed'), false, 'a tx not linked to the request: false');
-- fix round 1: the 30 minutes run from the first not-found mark, not from the scan
update public.dao_safe_operations set created_at = now() - interval '2 days' where id = tests.yopid(310);
select is(tests.yun(current_setting('t.rb')::uuid, 310, 'not_found'), false,
  'not_found without a missing mark: false, however old the scan (a lagging node is not believed)');
select is(tests.ycmiss(current_setting('t.rb')::uuid, 310, true), false, 'the first not-found only sets the mark');
select is((select missing_since from public.dao_safe_operations where id = tests.yopid(310)), now(), 'missing_since = now()');
select is(tests.yun(current_setting('t.rb')::uuid, 310, 'not_found'), false, 'a fresh mark does not unlink');
select is(tests.ycmiss(current_setting('t.rb')::uuid, 310, true), false, 'a second not-found within 30 minutes: false');
select ok(tests.yopw(310) = current_setting('t.rb')::uuid and tests.yalerts(310) = 0, 'it stays linked, no alert');
update public.dao_safe_operations set missing_since = now() - interval '31 minutes' where id = tests.yopid(310);
select is(tests.ycmiss(current_setting('t.rb')::uuid, 310, false), false, 'an ok verification clears the mark');
select is((select missing_since from public.dao_safe_operations where id = tests.yopid(310)), null, 'missing_since is null');
select is(tests.yun(current_setting('t.rb')::uuid, 310, 'not_found'), false, 'after the reset not_found does not unlink');
select is(tests.ycmiss(current_setting('t.rb')::uuid, 310, true), false, 'a new not-found starts a new mark');
update public.dao_safe_operations set missing_since = now() - interval '31 minutes' where id = tests.yopid(310);
select is(tests.ycmiss(current_setting('t.rb')::uuid, 310, true), true, 'a not-found 30+ minutes after the mark: allowed');
select is(tests.ycmiss(current_setting('t.rb')::uuid, 311, true), false, 'a tx not linked to the request: false');
select throws_ok(format('select tests.ycmiss(%L, 310, null)', current_setting('t.rb')), 'invalid_input',
  'a null p_missing raises invalid_input');
select throws_ok(format('select tests.ycmiss(%L, 310, true)', gen_random_uuid()), 'not_found',
  'an unknown request raises not_found');
select is(tests.yun(current_setting('t.rb')::uuid, 310, 'not_found'), true,
  'not_found with a mark 30+ minutes old: unlinked');
select is(tests.yopw(310), null, 'the outflow is no longer linked');
select is(tests.yalerts(310), tests.ytreas(), 'and alerts the treasurers once');
select ok((select alerted_at is not null from public.dao_safe_operations where id = tests.yopid(310)), 'marked alerted');
select is((select coalesce(actor_member_id::text, 'null') || ' ' || payload::text from public.audit_log
           where action = 'withdrawal_candidate_unlinked' and target_id = current_setting('t.rb')::uuid),
  'null ' || jsonb_build_object('request', current_setting('t.rb'), 'txHash', tests.yh(310), 'logIndex', 0,
                                'amount', '6666666', 'reason', 'not_found')::text,
  'audited with a null actor, the outflow and the reason');
select is(tests.yun(current_setting('t.rb')::uuid, 310, 'failed'), false, 'a second call: false');
select is(tests.yalerts(310), tests.ytreas(), 'and no second alert');
select is(tests.ycand(), '', 'no candidate is left');
-- an outflow already alerted is unlinked without a second alert ('failed' needs no age)
select is(tests.yops(jsonb_build_array(tests.yop(312, 6666666, tests.yw('b'), now() + interval '2 minutes', 171)), 171),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'another outflow to B is linked');
update public.dao_safe_operations set alerted_at = now() where id = tests.yopid(312);
select is(tests.yun(current_setting('t.rb')::uuid, 312, 'failed'), true, '''failed'' unlinks at once');
select ok(tests.yopw(312) is null and tests.yalerts(312) = 0, 'an outflow already alerted is not alerted again');
-- with no linked candidate, the approval can be rejected again (fix round 1 guard lifted)
select tests.authenticate_as(current_setting('t.ut')::uuid);
select lives_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.rb'), 'El pago no llegó'),
  'B''s approval can be rejected once its failed candidate is unlinked');
select tests.clear_authentication();
select is(tests.yliab(null), 0::numeric, 'B''s amount is no longer a liability');

-- ===== 5. carries (A) and (D): expiry =====
select set_config('t.rc', tests.yreq(current_setting('t.uc')::uuid, 1000000000000000000)::text, true);
select tests.ya(current_setting('t.rc')::uuid, current_setting('t.t')::uuid, 20000000, 160);
-- a linked outflow inside the window still blocks the expiry (R3, now re-checked under the row lock)
insert into public.dao_safe_operations (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number,
                                        occurred_at, withdrawal_id)
values (59141, tests.yh(320), 0, 'USDC', 'out', 5000000, tests.yw('c'), 180, now() + interval '1 minute',
        current_setting('t.rc')::uuid);
update public.withdrawal_requests set approved_at = approved_at - interval '15 days' where id = current_setting('t.rc')::uuid;
update public.dao_safe_operations set occurred_at = now() - interval '14 days' where id = tests.yopid(320);
select is(tests.yexp(), 0, '(A) a linked outflow inside the window: not expired');
select is(tests.ystatus('rc'), 'approved', 'C stays approved');
-- (D) the same outflow dated before approved_at - 120 s is outside the window: the request expires
update public.dao_safe_operations set occurred_at = now() - interval '16 days' where id = tests.yopid(320);
select ok(tests.yalerts(320) = 0, 'the out-of-window outflow has not alerted yet');
select is(tests.yexp(), 1, '(D) a linked outflow outside the window does not block the expiry');
select is((select status || ':' || (last_expired_at is not null) || ':' || (amount_usdc_locked is null)
           from public.withdrawal_requests where id = current_setting('t.rc')::uuid),
  'pending:true:true', 'C is pending again, last_expired_at set, no fixed amount');
select is(tests.yopw(320), null, '(D) the stale link is removed');
select is(tests.yalerts(320), tests.ytreas(), '(D) and the outflow alerts the treasurers once');
select is(tests.yexp(), 0, 'a second expiry run changes nothing');
select is(tests.yliab(null), 0::numeric, 'nothing is a liability');

-- ===== 6. fix round 1: a recorded payout's not-found mark (withdrawal_payout_missing) =====
-- T asks for all 2 (S_eff 6 after A's burn): 2 * 20 / 6 = 6.666666
select set_config('t.rt', tests.yreq(current_setting('t.ut')::uuid, 2000000000000000000)::text, true);
select is(tests.ya(current_setting('t.rt')::uuid, current_setting('t.t')::uuid, 20000000, 160) ->> 'amountUsdc', '6666666',
  'T is approved at 6.666666 USDC');
select throws_ok(format('select tests.ypmiss(%L, true)', current_setting('t.rt')), 'invalid_state',
  'no recorded payout: invalid_state');
select is(tests.yrec(current_setting('t.rt')::uuid, tests.ypay(330, 200, now() + interval '1 minute', tests.yw('t'), 6666666)),
  '{"status": "recorded"}'::jsonb, 'T''s payout is recorded');
select is(tests.ypmiss(current_setting('t.rt')::uuid, true), false, 'the first not-found only sets the mark');
select is((select payout_missing_since from public.withdrawal_requests where id = current_setting('t.rt')::uuid), now(),
  'payout_missing_since = now()');
select is(tests.ypmiss(current_setting('t.rt')::uuid, true), false, 'a second not-found within 30 minutes: false');
update public.withdrawal_requests set payout_missing_since = now() - interval '31 minutes' where id = current_setting('t.rt')::uuid;
select is(tests.ypmiss(current_setting('t.rt')::uuid, true), true, 'a not-found 30+ minutes after the mark: allowed');
select is(tests.ypmiss(current_setting('t.rt')::uuid, false), false, 'an ok verification clears the mark');
select is((select payout_missing_since from public.withdrawal_requests where id = current_setting('t.rt')::uuid), null,
  'payout_missing_since is null');
select is(tests.ypmiss(current_setting('t.rt')::uuid, true), false, 'after the reset a not-found starts a new mark');
select throws_ok(format('select tests.ycmiss(%L, 330, true)', current_setting('t.rt')), 'invalid_state',
  'a recorded payout is not a candidate');
select throws_ok(format('select tests.ypmiss(%L, true)', gen_random_uuid()), 'not_found', 'an unknown request raises not_found');
select throws_ok(format('select tests.ypmiss(%L, null)', current_setting('t.rt')), 'invalid_input',
  'a null p_missing raises invalid_input');
select lives_ok(format('select tests.yrev(%L)', current_setting('t.rt')), 'the payout is reverted');
select is((select (payout_missing_since is null) and (payout_tx_hash is null) from public.withdrawal_requests
           where id = current_setting('t.rt')::uuid), true, 'the revert clears the mark with the payout');

-- ===== 7. ruling F4c-R5: expiry never runs past what the scan covered =====
select is(tests.yexp(), 0, 'a fresh approval does not expire however far the scan reached (the now() rule)');
update public.withdrawal_requests set approved_at = approved_at - interval '15 days' where id = current_setting('t.rt')::uuid;
select set_config('t.apt', (select approved_at::text from public.withdrawal_requests where id = current_setting('t.rt')::uuid), true);
select is(tests.yexp(current_setting('t.apt')::timestamptz + interval '14 days 120 seconds'), 0,
  'R5: scanned exactly through approved_at + 14 d + 120 s: not expired yet');
select is(tests.yexp(now() + interval '100 days', 59144), 0, 'R5: another chain''s scan expires nothing on this one');
select throws_ok('select tests.yexp(null)', 'invalid_input', 'R5: a null scanned-through raises invalid_input');
select throws_ok('select tests.yexp(now(), 1)', 'invalid_input', 'R5: an unknown chain raises invalid_input');
select is(tests.ystatus('rt'), 'approved', 'T stays approved');
select is(tests.yexp(current_setting('t.apt')::timestamptz + interval '14 days 121 seconds'), 1,
  'R5: scanned past approved_at + 14 d + 120 s: expired');
select is(tests.ystatus('rt'), 'pending', 'T is pending again');

select * from finish();
rollback;
