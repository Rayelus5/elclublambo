-- F4d Task 5 (migration 20261019400005): the heal for the in-flight-scan race (Task 4 review, important 1). A scan that
-- read the old row version can link an outflow to a candidate of one kind while the other kind has just recorded it as
-- its payout. When that candidate is unlinked (unlink_withdrawal_candidate / unlink_raffle_candidate, or the internal
-- _withdrawal_unlink_ops / _raffle_unlink_ops on record, revert, reject, expiry), the outflow is re-linked to the kind
-- that recorded it: no treasury_outflow alert, no public hash, never unexplained.
-- Setup: 59141 valued at 200 USDC, W has an approved withdrawal of 20 USDC, R1 (25 USDC) and R2 (5 USDC) are drawn to W.
begin;
select plan(33);

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
create function tests.yuser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
create function tests.ycreate(p_amount numeric) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.yuser('t'));
  v := public.create_raffle('Sorteo ' || p_amount, 'USDC', p_amount, now() + interval '1 day', 'equal');
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
create function tests.ydrawn(p_raffle uuid, p_winner text) returns void language plpgsql as $$
begin
  update public.raffles
  set status = 'drawn', closed_at = now(), total_weight = 1, seed_reveal = '0x' || lpad('5eed', 64, '0'),
      draw_block_number = 1, draw_block_hash = tests.yh(1), draw_block_time = now(), draw_random = '0',
      winner_position = 1, winner_member_id = current_setting('t.' || p_winner)::uuid,
      winner_address = tests.yw(p_winner), drawn_at = now()
  where id = p_raffle;
  delete from private.raffle_seeds where raffle_id = p_raffle;
end;
$$;
create function tests.yops(p_n int, p_amount numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_operations(59141, tests.ysafe(), jsonb_build_array(jsonb_build_object(
    'txHash', tests.yh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out', 'amount', p_amount::text,
    'counterparty', tests.yw('w'), 'blockNumber', p_block, 'occurredAt', now() + interval '1 minute')), p_block);
  reset role;
  return v;
end;
$$;
create function tests.ypay(p_n int, p_block bigint, p_amount numeric) returns jsonb language sql as $$
  select jsonb_build_object('txHash', tests.yh(p_n), 'logIndex', '0', 'blockNumber', p_block::text,
                            'blockTime', to_char((now() + interval '1 minute') at time zone 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'to', tests.yw('w'), 'token', 'USDC', 'amount', p_amount::text)
$$;
create function tests.yop(p_n int) returns public.dao_safe_operations language sql as $$
  select o from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.yh(p_n)
$$;
create function tests.yalerts(p_n int) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.kind = 'treasury_outflow' and n.data ->> 'opId' = (tests.yop(p_n)).id::text
$$;
create function tests.yunlinkw(p_n int, p_reason text default 'failed') returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.unlink_withdrawal_candidate(current_setting('t.wr')::uuid, tests.yh(p_n), 0, p_reason);
  reset role;
  return v;
end;
$$;
create function tests.yunlinkr(p_raffle uuid, p_n int, p_reason text default 'failed') returns boolean
language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.unlink_raffle_candidate(p_raffle, tests.yh(p_n), 0, p_reason);
  reset role;
  return v;
end;
$$;
create function tests.yfeed(p_member text, p_n int) returns text language plpgsql as $$
declare
  v text;
  v_op uuid := (tests.yop(p_n)).id;
begin
  perform tests.authenticate_as(tests.yuser(p_member));
  select coalesce(o.tx_hash, '-') || '|' || o.explained into v from public.dao_operations(100) o where o.id = v_op;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.yunexp() returns text[] language plpgsql as $$
declare v text[];
begin
  perform tests.authenticate_as(tests.yuser('t'));
  select coalesce(array_agg(u.tx_hash order by u.tx_hash), '{}') into v from public.treasury_unexplained_outflows() u;
  perform tests.clear_authentication();
  return v;
end;
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9640', 40, '0'), null, true)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('f9641', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9642', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T964 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T964 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe96401', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
delete from public.dao_safe_operations where raffle_id is not null;
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
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 200000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 8000000000000000000, 160000000),
  (59141, current_setting('t.w')::uuid, 2000000000000000000, 40000000);
set local role service_role;
select public.record_nav_snapshot(59141, tests.ysafe(), jsonb_build_object(
  'usdcUnits', '200000000', 'ethWei', '0', 'wethWei', '0', 'ethPriceE8', '200000000000',
  'priceSource', 'chainlink', 'blockNumber', '10', 'assetsUsd6', '200000000'));
reset role;

select tests.authenticate_as(tests.yuser('w'));
select set_config('t.wr', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.approve_withdrawal(current_setting('t.wr')::uuid, current_setting('t.t')::uuid, tests.ysafe(), 200000000, 10);
reset role;

select set_config('t.r1', tests.ycreate(25000000)::text, true);
select set_config('t.r2', tests.ycreate(5000000)::text, true);
select set_config('t.r3', tests.ycreate(3000000)::text, true);
select tests.ydrawn(current_setting('t.r1')::uuid, 'w');
select tests.ydrawn(current_setting('t.r2')::uuid, 'w');
select tests.ydrawn(current_setting('t.r3')::uuid, 'w');

-- ===== 1. grants and definitions =====
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute'))
           from unnest(array['public.unlink_withdrawal_candidate(uuid,text,int,text)',
                             'public.unlink_raffle_candidate(uuid,text,int,text)']) f),
  'the candidate unlink functions stay service-only');
select ok((select bool_and(not has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute'))
           from unnest(array['public._withdrawal_unlink_ops(uuid,text,int)',
                             'public._raffle_unlink_ops(uuid,text,int)']) f),
  'the internal unlink helpers stay granted to no API role');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.unlink_withdrawal_candidate(uuid,text,int,text)'::regprocedure,
                         'public.unlink_raffle_candidate(uuid,text,int,text)'::regprocedure,
                         'public._withdrawal_unlink_ops(uuid,text,int)'::regprocedure,
                         'public._raffle_unlink_ops(uuid,text,int)'::regprocedure)),
  'all four are security definer with an empty search_path');

-- ===== 2. unlink_withdrawal_candidate re-links to the raffle that recorded the outflow =====
-- R1's payout (25 USDC to W, tx 1) is recorded by paste; the scan then links it to R1 (recorded payouts first).
set local role service_role;
select is(public.record_raffle_payout(current_setting('t.r1')::uuid, tests.ysafe(), tests.ypay(1, 101, 25000000),
                                      current_setting('t.t')::uuid),
  '{"status": "recorded"}'::jsonb, 'R1''s payout is recorded');
reset role;
select is(tests.yops(1, 25000000, 101), jsonb_build_object('inserted', 1, 'alerts', 0), 'the scan inserts tx 1 without an alert');
-- the race (a scan that read the raffle before the paste committed): tx 1 ends up as W's withdrawal candidate
update public.dao_safe_operations set raffle_id = null, withdrawal_id = current_setting('t.wr')::uuid,
                                      missing_since = now() - interval '1 hour'
 where chain_id = 59141 and tx_hash = tests.yh(1);
select ok(tests.yunlinkw(1), 'the failed withdrawal candidate is unlinked');
select is((tests.yop(1)).raffle_id, current_setting('t.r1')::uuid, 'tx 1 is re-linked to R1, which recorded it');
select is((tests.yop(1)).withdrawal_id, null::uuid, 'and no longer to the withdrawal');
select is((tests.yop(1)).missing_since, null::timestamptz, 'the candidate''s not-found mark is cleared');
select is(tests.yalerts(1), 0, 'no treasury_outflow alert for a re-linked outflow');
select is((tests.yop(1)).alerted_at, null::timestamptz, 'and it is not marked as alerted');
select ok(not (tests.yh(1) = any(tests.yunexp())), 'tx 1 is not an unexplained outflow');
select is(tests.yfeed('w', 1), '-|true', 'the public feed shows it explained, without the hash');
select is((select a.payload ->> 'relinkedRaffle' from public.audit_log a
           where a.action = 'withdrawal_candidate_unlinked' and a.payload ->> 'txHash' = tests.yh(1)),
  current_setting('t.r1'), 'the unlink audit names the raffle it was re-linked to');
select is((select w.status || ':' || coalesce(w.payout_tx_hash, '-') from public.withdrawal_requests w
           where w.id = current_setting('t.wr')::uuid), 'approved:-', 'the withdrawal stays approved and unpaid');

-- ===== 3. unlink_raffle_candidate re-links to the withdrawal that recorded the outflow =====
-- W's payout (20 USDC, tx 2) is recorded; the race leaves tx 2 as R2's candidate.
set local role service_role;
select is(public.record_withdrawal_payout(current_setting('t.wr')::uuid, tests.ysafe(), tests.ypay(2, 102, 20000000) - 'token',
                                          current_setting('t.t')::uuid),
  '{"status": "recorded"}'::jsonb, 'W''s payout is recorded');
reset role;
select is(tests.yops(2, 20000000, 102), jsonb_build_object('inserted', 1, 'alerts', 0), 'the scan inserts tx 2 without an alert');
update public.dao_safe_operations set withdrawal_id = null, raffle_id = current_setting('t.r2')::uuid
 where chain_id = 59141 and tx_hash = tests.yh(2);
select ok(tests.yunlinkr(current_setting('t.r2')::uuid, 2), 'the failed raffle candidate is unlinked');
select is((tests.yop(2)).withdrawal_id, current_setting('t.wr')::uuid, 'tx 2 is re-linked to W''s withdrawal');
select is((tests.yop(2)).raffle_id, null::uuid, 'and no longer to R2');
select is(tests.yalerts(2), 0, 'no alert');
select ok(not (tests.yh(2) = any(tests.yunexp())), 'tx 2 is not an unexplained outflow');
select is((select a.payload ->> 'relinkedWithdrawal' from public.audit_log a
           where a.action = 'raffle_candidate_unlinked' and a.payload ->> 'txHash' = tests.yh(2)),
  current_setting('t.wr'), 'the unlink audit names the withdrawal it was re-linked to');

-- ===== 4. the internal helpers heal too =====
-- tx 2 (W's payout) linked to R3 as a candidate; revert-style unlink of all R3's ops
update public.dao_safe_operations set withdrawal_id = null, raffle_id = current_setting('t.r3')::uuid
 where chain_id = 59141 and tx_hash = tests.yh(2);
select public._raffle_unlink_ops(current_setting('t.r3')::uuid, null, null);
select is((tests.yop(2)).withdrawal_id, current_setting('t.wr')::uuid, '_raffle_unlink_ops re-links tx 2 to W');
select is(tests.yalerts(2), 0, 'still no alert');
-- tx 1 (R1's payout) linked to W; W's own payout (tx 2) is kept
update public.dao_safe_operations set raffle_id = null, withdrawal_id = current_setting('t.wr')::uuid
 where chain_id = 59141 and tx_hash = tests.yh(1);
select public._withdrawal_unlink_ops(current_setting('t.wr')::uuid, tests.yh(2), 0);
select is((tests.yop(1)).raffle_id, current_setting('t.r1')::uuid, '_withdrawal_unlink_ops re-links tx 1 to R1');
select is((tests.yop(2)).withdrawal_id, current_setting('t.wr')::uuid, 'and keeps W''s own payout linked');
select is(tests.yalerts(1), 0, 'no alert for tx 1');

-- ===== 5. nothing recorded elsewhere: the unlink alerts as before =====
select is(tests.yops(3, 3000000, 103), jsonb_build_object('inserted', 1, 'alerts', 0), 'a 3 USDC outflow to W links a candidate');
select is((tests.yop(3)).raffle_id, current_setting('t.r3')::uuid, 'it is R3''s candidate');
select ok(tests.yunlinkr(current_setting('t.r3')::uuid, 3), 'R3''s candidate is unlinked');
select ok((tests.yop(3)).raffle_id is null and (tests.yop(3)).withdrawal_id is null, 'with nothing to re-link to it stays unlinked');
select ok(tests.yalerts(3) >= 1 and tests.yh(3) = any(tests.yunexp()), 'and alerts the treasurers as an unexplained outflow');

select * from finish();
rollback;
