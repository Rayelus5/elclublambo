-- F4d Task 4 (migration 20261019400004): verified raffle prize payouts. The scan links a matching USDC / WETH outflow
-- to a drawn raffle (a withdrawal match wins), the payout is recorded at confirmations (no longer a liability from its
-- block on, value_usdc untouched), the raffle is paid at finality, a failed payout is reverted, the 30-minute not-found
-- marks, unpaid notices at drawn_at + 14 d, and the public feed ("Premio de sorteo", hash only for treasurers).
-- Plus the Task 3 carry: draw_raffle accepts only ISO timestamps, no block from the future, and stores the parent time.
-- Setup: 59141 valued at 200 USDC (ETH at 2000 USD), S = 10 * 10^18. W has an approved withdrawal of 20 USDC.
-- Drawn raffles: R1 10 USDC to A, R2 0.01 WETH (20 USD) to C, R3 5 USDC to W, R4 2 USDC to P (drawn 21 days ago),
-- R5 3 USDC and R6 4 USDC to D (drawn 15 days ago). RO (1 USDC) stays open.
begin;
select plan(125);

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
create function tests.zuser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
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
create function tests.zcreate(p_token text, p_amount numeric) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.zuser('t'));
  v := public.create_raffle('Sorteo ' || p_token || ' ' || p_amount, p_token, p_amount, now() + interval '1 day', 'equal');
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
-- the raffle as draw_raffle leaves it (the draw itself is 962's subject)
create function tests.zdrawn(p_raffle uuid, p_winner text, p_at timestamptz) returns void language plpgsql as $$
begin
  update public.raffles
  set status = 'drawn', closed_at = p_at, total_weight = 1, seed_reveal = '0x' || lpad('5eed', 64, '0'),
      draw_block_number = 1, draw_block_hash = tests.zh(1), draw_block_time = p_at, draw_random = '0',
      winner_position = 1, winner_member_id = current_setting('t.' || p_winner)::uuid,
      winner_address = tests.zw(p_winner), drawn_at = p_at
  where id = p_raffle;
  delete from private.raffle_seeds where raffle_id = p_raffle;
end;
$$;
create function tests.zop(p_n int, p_asset text, p_amount numeric, p_to text, p_at timestamptz, p_block bigint)
returns jsonb language sql as $$
  select jsonb_build_object('txHash', tests.zh(p_n), 'logIndex', 0, 'asset', p_asset, 'direction', 'out',
                            'amount', p_amount::text, 'counterparty', p_to, 'blockNumber', p_block, 'occurredAt', p_at)
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
create function tests.zopid(p_n int) returns uuid language sql as $$
  select o.id from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.zh(p_n)
$$;
create function tests.zopr(p_n int) returns uuid language sql as $$
  select o.raffle_id from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.zh(p_n)
$$;
create function tests.zopw(p_n int) returns uuid language sql as $$
  select o.withdrawal_id from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.zh(p_n)
$$;
create function tests.zalerts(p_n int) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.kind = 'treasury_outflow' and n.data ->> 'opId' = tests.zopid(p_n)::text
$$;
create function tests.ztreas() returns int language sql as $$
  select count(*)::int from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0
$$;
create function tests.zpay(p_n int, p_block bigint, p_at timestamptz, p_to text, p_token text, p_amount numeric)
returns jsonb language sql as $$
  select jsonb_build_object('txHash', tests.zh(p_n), 'logIndex', '0', 'blockNumber', p_block::text,
                            'blockTime', p_at, 'to', p_to, 'token', p_token, 'amount', p_amount::text)
$$;
create function tests.zrec(p_raffle uuid, p_payout jsonb, p_actor uuid default null, p_safe text default null)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_raffle_payout(p_raffle, coalesce(p_safe, tests.zsafe()), p_payout, p_actor);
  reset role;
  return v;
end;
$$;
create function tests.zwrec(p_req uuid, p_payout jsonb, p_actor uuid default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_withdrawal_payout(p_req, tests.zsafe(), p_payout - 'token', p_actor);
  reset role;
  return v;
end;
$$;
create function tests.zfin(p_raffle uuid, p_block bigint, p_safe text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.finalize_raffle_payout(p_raffle, coalesce(p_safe, tests.zsafe()), p_block);
  reset role;
  return v;
end;
$$;
create function tests.zrev(p_raffle uuid) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.revert_raffle_payout(p_raffle);
  reset role;
end;
$$;
create function tests.zcand() returns text language plpgsql as $$
declare v text;
begin
  set local role service_role;
  select coalesce(string_agg(c.raffle_id || ':' || c.tx_hash || ':' || c.log_index || ':' || c.token || ':'
                             || c.winner_address || ':' || c.prize_amount || ':' || (c.drawn_at = r.drawn_at),
                             ',' order by c.tx_hash), '')
    into v
  from public.raffle_payout_candidates(59141) c
  join public.raffles r on r.id = c.raffle_id;
  reset role;
  return v;
end;
$$;
create function tests.zawait() returns text language plpgsql as $$
declare v text;
begin
  set local role service_role;
  select coalesce(string_agg(f.raffle_id || ':' || f.tx_hash || ':' || f.token || ':' || f.winner_address || ':'
                             || f.prize_amount || ':' || f.payout_block || ':' || f.payout_log_index
                             || ':' || (f.drawn_at is not null), ',' order by f.payout_block), '')
    into v
  from public.raffles_awaiting_finality(59141) f;
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
create function tests.zvalue() returns numeric language sql as $$
  select value_usdc from public.dao_state where chain_id = 59141
$$;
create function tests.zcmiss(p_raffle uuid, p_n int, p_missing boolean) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.raffle_candidate_missing(p_raffle, tests.zh(p_n), 0, p_missing);
  reset role;
  return v;
end;
$$;
create function tests.zunlink(p_raffle uuid, p_n int, p_reason text) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.unlink_raffle_candidate(p_raffle, tests.zh(p_n), 0, p_reason);
  reset role;
  return v;
end;
$$;
create function tests.zpmiss(p_raffle uuid, p_missing boolean) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.raffle_payout_missing(p_raffle, p_missing);
  reset role;
  return v;
end;
$$;
create function tests.znotify(p_chain int default 59141) returns int language plpgsql as $$
declare v int;
begin
  set local role service_role;
  v := public.notify_unpaid_raffles(p_chain);
  reset role;
  return v;
end;
$$;
create function tests.zfeed(p_member text, p_n int) returns text language plpgsql as $$
declare
  v text;
  v_op uuid := tests.zopid(p_n); -- read before authenticating (members cannot read the table)
begin
  perform tests.authenticate_as(tests.zuser(p_member));
  select coalesce(o.tx_hash, '-') || '|' || coalesce(o.note, '-') || '|' || o.explained into v
  from public.dao_operations(100) o where o.id = v_op;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.zunexp() returns text[] language plpgsql as $$
declare v text[];
begin
  perform tests.authenticate_as(tests.zuser('t'));
  select coalesce(array_agg(u.tx_hash order by u.tx_hash), '{}') into v from public.treasury_unexplained_outflows() u;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.zcard(p_member text, p_raffle uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.zuser(p_member));
  select x into v from jsonb_array_elements(public.dao_raffles(100)) x where x ->> 'id' = p_raffle::text;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.zdetail(p_member text, p_raffle uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.zuser(p_member));
  v := public.raffle_detail(p_raffle);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.zpend(p_member text, p_amount numeric, p_n int, p_block bigint) returns uuid language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.authenticate_as(tests.zuser(p_member));
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
create function tests.zdraw(p_raffle uuid, p_block jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.draw_raffle(p_raffle, p_block);
  reset role;
  return v;
end;
$$;
create function tests.ziso(p_at timestamptz) returns text language sql stable as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9630', 40, '0'), null, true)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9631', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('f9632', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('f9633', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.p', tests.create_member('0x' || lpad('f9634', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9635', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T963 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T963 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe96301', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true, weighted_raffles_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
-- whatever the local database holds for 59141 is not part of these scenarios
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
  (59141, current_setting('t.a')::uuid, 5000000000000000000, 100000000),
  (59141, current_setting('t.c')::uuid, 3000000000000000000, 60000000),
  (59141, current_setting('t.w')::uuid, 2000000000000000000, 40000000);
select tests.zsnap(200000000, 10);

-- W's approved withdrawal: 1 * 10^18 of 10 * 10^18 at 200 USDC = 20 USDC
select tests.authenticate_as(tests.zuser('w'));
select set_config('t.wr', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.approve_withdrawal(current_setting('t.wr')::uuid, current_setting('t.t')::uuid, tests.zsafe(), 200000000, 10);
reset role;

select set_config('t.r1', tests.zcreate('USDC', 10000000)::text, true);
select set_config('t.r2', tests.zcreate('WETH', 10000000000000000)::text, true);
select set_config('t.r3', tests.zcreate('USDC', 5000000)::text, true);
select set_config('t.ro', tests.zcreate('USDC', 1000000)::text, true);
select set_config('t.r4', tests.zcreate('USDC', 2000000)::text, true);
select set_config('t.r5', tests.zcreate('USDC', 3000000)::text, true);
select set_config('t.r6', tests.zcreate('USDC', 4000000)::text, true);
select tests.zdrawn(current_setting('t.r1')::uuid, 'a', now());
select tests.zdrawn(current_setting('t.r2')::uuid, 'c', now());
select tests.zdrawn(current_setting('t.r3')::uuid, 'w', now());
select tests.zdrawn(current_setting('t.r4')::uuid, 'p', now() - interval '21 days');
select tests.zdrawn(current_setting('t.r5')::uuid, 'd', now() - interval '15 days');
select tests.zdrawn(current_setting('t.r6')::uuid, 'd', now() - interval '15 days');

select is(tests.zvalue(), 135000000::numeric,
  'setup: 200 USDC - the approved 20 - the prizes 10 + 20 (WETH at 2000) + 5 + 1 + 2 + 3 + 4 = 135 USDC');
select is(tests.zliab(null), 65000000::numeric, 'setup: liabilities 65 USDC on the read path');

-- ===== 1. grants =====
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute'))
           from unnest(array['public.record_raffle_payout(uuid,text,jsonb,uuid)',
                             'public.finalize_raffle_payout(uuid,text,bigint)',
                             'public.revert_raffle_payout(uuid)',
                             'public.raffle_payout_candidates(int)',
                             'public.raffles_awaiting_finality(int)',
                             'public.raffle_payout_missing(uuid,boolean)',
                             'public.raffle_candidate_missing(uuid,text,int,boolean)',
                             'public.unlink_raffle_candidate(uuid,text,int,text)',
                             'public.notify_unpaid_raffles(int)']) f),
  'every new payout function is service-only');
select ok(not has_function_privilege('service_role', 'public._raffle_unlink_ops(uuid,text,int)', 'execute')
      and not has_function_privilege('authenticated', 'public._raffle_unlink_ops(uuid,text,int)', 'execute')
      and not has_function_privilege('anon', 'public._raffle_unlink_ops(uuid,text,int)', 'execute'),
  '_raffle_unlink_ops is granted to no API role');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.record_raffle_payout(uuid,text,jsonb,uuid)'::regprocedure,
                         'public.finalize_raffle_payout(uuid,text,bigint)'::regprocedure,
                         'public.revert_raffle_payout(uuid)'::regprocedure,
                         'public.raffle_payout_candidates(int)'::regprocedure,
                         'public.raffles_awaiting_finality(int)'::regprocedure,
                         'public.raffle_payout_missing(uuid,boolean)'::regprocedure,
                         'public.raffle_candidate_missing(uuid,text,int,boolean)'::regprocedure,
                         'public.unlink_raffle_candidate(uuid,text,int,text)'::regprocedure,
                         'public.notify_unpaid_raffles(int)'::regprocedure,
                         'public._raffle_unlink_ops(uuid,text,int)'::regprocedure)),
  'all of them are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.dao_operations(int)', 'execute')
      and has_function_privilege('authenticated', 'public.treasury_unexplained_outflows()', 'execute')
      and not has_function_privilege('anon', 'public.dao_operations(int)', 'execute')
      and has_function_privilege('service_role', 'public.record_safe_operations(int,text,jsonb,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_safe_operations(int,text,jsonb,bigint)', 'execute'),
  'the replaced functions keep their grants');
select ok((select pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure)
           ~* 'limit 1\s+for update of r'), 'the scan''s raffle match takes the raffle row lock (for update of r)');
select ok((select pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure)
           ~* 'r\.payout_log_index = v_log\s+for share of r'), 'the exact prize-payout match takes for share of r');

-- ===== 2. scan links =====
select is(tests.zops(jsonb_build_array(
            tests.zop(101, 'USDC', 10000000, tests.zw('a'), now() + interval '1 minute', 100),
            tests.zop(102, 'WETH', 10000000000000000, tests.zw('c'), now() + interval '1 minute', 101)), 101),
  jsonb_build_object('inserted', 2, 'alerts', 0), 'the two prize outflows are linked without an alert');
select is(tests.zopr(101), current_setting('t.r1')::uuid, 'the 10 USDC to A links R1');
select is(tests.zopr(102), current_setting('t.r2')::uuid, 'the 0.01 WETH to C links R2');
select is(tests.zcand(),
  current_setting('t.r1') || ':' || tests.zh(101) || ':0:USDC:' || tests.zw('a') || ':10000000:true,'
  || current_setting('t.r2') || ':' || tests.zh(102) || ':0:WETH:' || tests.zw('c') || ':10000000000000000:true',
  'raffle_payout_candidates lists both');
select is(tests.zliab(100), 55000000::numeric, 'R2-F4d: at block 100 the linked R1 outflow counts as paid');
select is(tests.zliab(101), 35000000::numeric, 'and at 101 the linked R2 outflow too (WETH at the snapshot price)');
select is(200000000 - tests.zliab(99), 170000000 - tests.zliab(101),
  'price invariant: NAV before the payouts (Safe 200) = NAV after them (Safe 170)');
select is(tests.zvalue(), 135000000::numeric, 'the scan leaves the cached value alone');

-- a withdrawal match takes precedence over a raffle match for the same outflow
select is(tests.zops(jsonb_build_array(
            tests.zop(103, 'USDC', 20000000, tests.zw('w'), now() + interval '1 minute', 102),
            tests.zop(104, 'USDC', 5000000, tests.zw('w'), now() + interval '1 minute', 103)), 103),
  jsonb_build_object('inserted', 2, 'alerts', 0), 'two outflows to W, both linked');
select ok(tests.zopw(103) = current_setting('t.wr')::uuid and tests.zopr(103) is null,
  'the 20 USDC to W fits both W''s withdrawal and R3, and links the withdrawal only');
select ok(tests.zopr(104) = current_setting('t.r3')::uuid and tests.zopw(104) is null,
  'the 5 USDC to W (under the withdrawal amount) links R3');

-- ===== 3. scan alerts: no link, one alert per treasurer =====
select is(tests.zops(jsonb_build_array(
            tests.zop(110, 'USDC', 9999999, tests.zw('a'), now() + interval '1 minute', 104),
            tests.zop(111, 'WETH', 10000000000000000, tests.zw('a'), now() + interval '1 minute', 105),
            tests.zop(112, 'USDC', 10000000, tests.zw('c'), now() + interval '1 minute', 106),
            tests.zop(113, 'USDC', 10000000, tests.zw('a'), now() - interval '121 seconds', 107)), 107),
  jsonb_build_object('inserted', 4, 'alerts', 4 * tests.ztreas()), 'four outflows that pay no prize alert');
select ok(tests.zopr(110) is null and tests.zalerts(110) = tests.ztreas(), 'USDC 9.999999 to A: under the prize');
select ok(tests.zopr(111) is null and tests.zalerts(111) = tests.ztreas(), 'WETH 0.01 to A: R1 is a USDC prize');
select ok(tests.zopr(112) is null and tests.zalerts(112) = tests.ztreas(), 'USDC 10 to C: R2 is a WETH prize');
select ok(tests.zopr(113) is null and tests.zalerts(113) = tests.ztreas(), 'a transfer before drawn_at - 120 s');

-- ===== 4. record =====
select is(tests.zrec(current_setting('t.r1')::uuid,
                     tests.zpay(120, 140, now() + interval '5 minutes', tests.zw('a'), 'USDC', 10500000),
                     current_setting('t.t')::uuid),
  '{"status": "recorded"}'::jsonb, 'R1 overpaid with 10.5 USDC is recorded');
select is(tests.zrec(current_setting('t.r1')::uuid,
                     tests.zpay(120, 140, now() + interval '5 minutes', tests.zw('a'), 'USDC', 10500000),
                     current_setting('t.t')::uuid),
  '{"status": "already"}'::jsonb, 'the same tx and log again: already');
select is((select status || ':' || payout_tx_hash || ':' || payout_log_index || ':' || payout_block || ':' || payout_amount
                  || ':' || payout_recorded_by || ':' || (payout_recorded_at = now())
                  || ':' || (payout_block_time = now() + interval '5 minutes')
           from public.raffles where id = current_setting('t.r1')::uuid),
  'drawn:' || tests.zh(120) || ':0:140:10500000:' || current_setting('t.t') || ':true:true',
  'the payout columns are set (block time included) and R1 stays drawn until finality');
select ok(tests.zopr(101) is null and tests.zalerts(101) = tests.ztreas(),
  'R1''s other linked outflow is unlinked and alerts the treasurers once');
select is((select payload from public.audit_log where action = 'raffle_payout_recorded'
           and target_id = current_setting('t.r1')::uuid and actor_member_id = current_setting('t.t')::uuid),
  jsonb_build_object('raffle', current_setting('t.r1'), 'txHash', tests.zh(120), 'logIndex', 0, 'blockNumber', 140,
                     'token', 'USDC', 'amount', '10500000'),
  'audit raffle_payout_recorded');
select is(tests.zliab(139) - tests.zliab(140), 10000000::numeric,
  'R1 is a liability for a read at payout_block - 1 and not at payout_block');
select is(tests.zvalue(), 135000000::numeric, 'recording leaves the cached value alone (Review Focus 4)');
select is(tests.zops(jsonb_build_array(
            tests.zop(120, 'USDC', 10500000, tests.zw('a'), now() + interval '5 minutes', 140)), 140),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'the scan links the recorded payout without an alert');
select is(tests.zopr(120), current_setting('t.r1')::uuid, 'linked to R1');

-- ===== 5. record guards (R3: 5 USDC to W) =====
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(130, 150, now() + interval '1 minute', tests.zw('a'), 'USDC', 5000000)),
  'tx_mismatch', 'a payout to another wallet → tx_mismatch');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(130, 150, now() + interval '1 minute', tests.zw('w'), 'WETH', 5000000)),
  'tx_mismatch', 'a payout in the wrong token → tx_mismatch');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(130, 150, now() + interval '1 minute', tests.zw('w'), 'USDC', 4999999)),
  'tx_mismatch', 'a payout under the prize → tx_mismatch');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(104, 103, now() + interval '1 minute', tests.zw('w'), 'USDC', 6000000)),
  'tx_mismatch', 'a log the scan saw with another amount → tx_mismatch');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(130, 150, now() - interval '121 seconds', tests.zw('w'), 'USDC', 5000000)),
  'tx_too_old', 'a block time before drawn_at - 120 s → tx_too_old');
select set_config('t.lg', tests.zpend('p', 1000000, 95631, 50)::text, true);
update public.dao_ledger set status = 'reverted' where id = current_setting('t.lg')::uuid;
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(95631, 150, now() + interval '1 minute', tests.zw('w'), 'USDC', 5000000)),
  'tx_already_used', 'a donation''s tx → tx_already_used');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(103, 102, now() + interval '1 minute', tests.zw('w'), 'USDC', 20000000)),
  'tx_already_used', 'an outflow linked to a withdrawal → tx_already_used');
select throws_ok(format('select tests.zwrec(%L, %L)', current_setting('t.wr'),
                        tests.zpay(120, 140, now() + interval '5 minutes', tests.zw('w'), 'USDC', 20000000)),
  'tx_already_used', 'record_withdrawal_payout with R1''s payout tx and log → tx_already_used');
select throws_ok(format('select tests.zwrec(%L, %L)', current_setting('t.wr'),
                        tests.zpay(104, 103, now() + interval '1 minute', tests.zw('w'), 'USDC', 20000000)),
  'tx_already_used', 'record_withdrawal_payout with an outflow linked to a raffle → tx_already_used');
select is(tests.zwrec(current_setting('t.wr')::uuid,
                      tests.zpay(103, 102, now() + interval '1 minute', tests.zw('w'), 'USDC', 20000000),
                      current_setting('t.t')::uuid),
  '{"status": "recorded"}'::jsonb, 'W''s withdrawal payout is recorded');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(103, 102, now() + interval '1 minute', tests.zw('w'), 'USDC', 20000000)),
  'tx_already_used', 'a recorded withdrawal payout''s tx and log → tx_already_used');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.ro'),
                        tests.zpay(130, 150, now() + interval '1 minute', tests.zw('w'), 'USDC', 5000000)),
  'invalid_state', 'an open raffle → invalid_state');
select throws_ok(format('select tests.zrec(%L, %L, null, %L)', current_setting('t.r3'),
                        tests.zpay(104, 103, now() + interval '1 minute', tests.zw('w'), 'USDC', 5000000),
                        '0x' || lpad('5afe96399', 40, '0')),
  'safe_changed', 'another Safe → safe_changed');
select throws_ok(format('select tests.zrec(%L, %L, %L)', current_setting('t.r3'),
                        tests.zpay(104, 103, now() + interval '1 minute', tests.zw('w'), 'USDC', 5000000),
                        current_setting('t.p')),
  'forbidden', 'an actor without bit 256 → forbidden');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        tests.zpay(104, 103, now() + interval '1 minute', tests.zw('w'), 'ETH', 5000000)),
  'invalid_input', 'a token other than USDC or WETH → invalid_input');
select throws_ok(format('select tests.zrec(%L, %L)', current_setting('t.r3'),
                        jsonb_set(tests.zpay(104, 103, now(), tests.zw('w'), 'USDC', 5000000), '{blockTime}', '"now"')),
  'invalid_input', 'a block time that is not an ISO timestamp → invalid_input');
select throws_ok(format('select tests.zrec(%L, %L)', gen_random_uuid(),
                        tests.zpay(104, 103, now() + interval '1 minute', tests.zw('w'), 'USDC', 5000000)),
  'not_found', 'an unknown raffle → not_found');
select is(tests.zrec(current_setting('t.r3')::uuid,
                     tests.zpay(104, 103, now() + interval '1 minute', tests.zw('w'), 'USDC', 5000000)),
  '{"status": "recorded"}'::jsonb, 'R3''s linked candidate is recorded by the cron (null actor)');
select ok(exists (select 1 from public.audit_log where action = 'raffle_payout_recorded'
                  and target_id = current_setting('t.r3')::uuid and actor_member_id is null),
  'audited with a null actor');
select is(tests.zopr(104), current_setting('t.r3')::uuid, 'the outflow stays linked to R3');
select is(tests.zrec(current_setting('t.r4')::uuid,
                     tests.zpay(160, 160, now() - interval '1 day', tests.zw('p'), 'USDC', 2000000)),
  '{"status": "recorded"}'::jsonb, 'a payment 20 days after drawn_at is still a payment (R4)');

-- ===== 6. finalize =====
select is(tests.zawait(),
  current_setting('t.r3') || ':' || tests.zh(104) || ':USDC:' || tests.zw('w') || ':5000000:103:0:true,'
  || current_setting('t.r1') || ':' || tests.zh(120) || ':USDC:' || tests.zw('a') || ':10000000:140:0:true,'
  || current_setting('t.r4') || ':' || tests.zh(160) || ':USDC:' || tests.zw('p') || ':2000000:160:0:true',
  'raffles_awaiting_finality lists the recorded payouts by block');
select set_config('t.l140', tests.zliab(140)::text, true);
select is(tests.zfin(current_setting('t.r1')::uuid, 139), '{"status": "pending"}'::jsonb, 'below payout_block: pending');
select is(tests.zfin(current_setting('t.r1')::uuid, 140), '{"status": "paid"}'::jsonb, 'at payout_block: paid');
select is((select status || ':' || (paid_at = now()) from public.raffles where id = current_setting('t.r1')::uuid),
  'paid:true', 'R1 is paid with paid_at');
select is(tests.zvalue(), 135000000::numeric, 'finality leaves the cached value alone');
select is(tests.zliab(140), current_setting('t.l140')::numeric, 'price invariant: the liabilities at 140 do not move at finality');
select ok(exists (select 1 from public.audit_log where action = 'raffle_paid' and target_id = current_setting('t.r1')::uuid),
  'audit raffle_paid');
select is(tests.zfin(current_setting('t.r1')::uuid, 140), '{"status": "already"}'::jsonb, 'a second call: already');
select throws_ok(format('select tests.zfin(%L, 999)', current_setting('t.ro')), 'invalid_state',
  'an open raffle → invalid_state');
select throws_ok(format('select tests.zfin(%L, 999, %L)', current_setting('t.r3'), '0x' || lpad('5afe96399', 40, '0')),
  'safe_changed', 'another Safe → safe_changed');
select throws_ok(format('select tests.zfin(%L, null)', current_setting('t.r3')), 'invalid_input',
  'a null finalized block → invalid_input');
select is(tests.zfin(current_setting('t.r4')::uuid, 200), '{"status": "paid"}'::jsonb, 'R4 is paid');
select is((tests.zcard('d', current_setting('t.r4')::uuid) ->> 'paidLate')::boolean, true,
  'dao_raffles: R4 paid 20 days after the draw is paidLate (Pagado con retraso)');
select is((tests.zcard('d', current_setting('t.r1')::uuid) ->> 'paidLate')::boolean, false, 'R1 is not paidLate');

-- ===== 7. revert (R2: 0.01 WETH to C) =====
select set_config('t.l101', tests.zliab(101)::text, true);
select is(tests.zrec(current_setting('t.r2')::uuid,
                     tests.zpay(102, 101, now() + interval '1 minute', tests.zw('c'), 'WETH', 10000000000000000)),
  '{"status": "recorded"}'::jsonb, 'R2''s WETH payout is recorded');
select is(tests.zliab(101), current_setting('t.l101')::numeric,
  'price invariant: recording the linked candidate changes no valuation at 101');
select lives_ok(format('select tests.zrev(%L)', current_setting('t.r2')), 'R2''s payout is reverted');
select is((select coalesce(payout_tx_hash, '-') || ':' || status || ':' || (payout_missing_since is null)
           from public.raffles where id = current_setting('t.r2')::uuid),
  '-:drawn:true', 'the payout is cleared and R2 is drawn again');
select ok(tests.zopr(102) is null and tests.zalerts(102) = tests.ztreas(),
  'its outflow is unlinked and alerts the treasurers once');
select is(tests.zfeed('p', 102), tests.zh(102) || '|-|false', 'dao_operations shows it unexplained');
select is(tests.zliab(101) - current_setting('t.l101')::numeric, 20000000::numeric, 'the WETH prize counts again');
select is(tests.zvalue(), 135000000::numeric, 'revert leaves the cached value alone');
select ok(exists (select 1 from public.audit_log where action = 'raffle_payout_reverted'
                  and target_id = current_setting('t.r2')::uuid and payload ->> 'txHash' = tests.zh(102)),
  'audit raffle_payout_reverted');
select throws_ok(format('select tests.zrev(%L)', current_setting('t.r2')), 'invalid_state',
  'reverting without a payout → invalid_state');
select throws_ok(format('select tests.zrev(%L)', current_setting('t.r1')), 'invalid_state',
  'a paid raffle cannot be reverted');

-- ===== 8. not-found marks =====
select is(tests.zops(jsonb_build_array(tests.zop(170, 'USDC', 3000000, tests.zw('d'), now(), 170)), 170),
  jsonb_build_object('inserted', 1, 'alerts', 0), 'a 3 USDC outflow to D is linked');
select is(tests.zopr(170), current_setting('t.r5')::uuid, 'to R5 (R6 asks for 4 USDC)');
select is(tests.zfeed('p', 170), '-|Premio de sorteo|true', 'a drawn raffle''s candidate is explained, hash hidden');
select is(tests.zcmiss(current_setting('t.r5')::uuid, 170, true), false, 'the first not-found sets the mark: false');
select ok((select missing_since = now() from public.dao_safe_operations where id = tests.zopid(170)), 'the mark is set');
select is(tests.zunlink(current_setting('t.r5')::uuid, 170, 'not_found'), false,
  'unlink not_found before 30 minutes is refused');
select is(tests.zopr(170), current_setting('t.r5')::uuid, 'still linked');
update public.dao_safe_operations set missing_since = now() - interval '31 minutes' where id = tests.zopid(170);
select is(tests.zcmiss(current_setting('t.r5')::uuid, 170, true), true, 'a 31-minute-old mark: true');
select is(tests.zunlink(current_setting('t.r5')::uuid, 170, 'not_found'), true, 'and unlink not_found then removes it');
select ok(tests.zopr(170) is null and tests.zalerts(170) = tests.ztreas(), 'unlinked with one alert per treasurer');
select ok(exists (select 1 from public.audit_log where action = 'raffle_candidate_unlinked'
                  and target_id = current_setting('t.r5')::uuid and payload ->> 'reason' = 'not_found'),
  'audit raffle_candidate_unlinked');
select is(tests.zunlink(current_setting('t.r5')::uuid, 170, 'failed'), false, 'an outflow no longer linked: false');
select is(tests.zcmiss(current_setting('t.r5')::uuid, 170, true), false, 'no mark on an unlinked outflow');
select throws_ok(format('select tests.zunlink(%L, 104, %L)', current_setting('t.r3'), 'failed'), 'invalid_state',
  'a recorded payout is reverted, never unlinked as a candidate');
select throws_ok(format('select tests.zcmiss(%L, 104, true)', current_setting('t.r3')), 'invalid_state',
  'and has no candidate mark');
select throws_ok(format('select tests.zunlink(%L, 170, %L)', current_setting('t.r5'), 'gone'), 'invalid_input',
  'an unknown reason → invalid_input');
select is(tests.zrec(current_setting('t.r6')::uuid,
                     tests.zpay(180, 180, now(), tests.zw('d'), 'USDC', 4000000)),
  '{"status": "recorded"}'::jsonb, 'R6''s payout is recorded');
select is(tests.zpmiss(current_setting('t.r6')::uuid, true), false, 'a recorded payout''s first not-found: false');
update public.raffles set payout_missing_since = now() - interval '31 minutes' where id = current_setting('t.r6')::uuid;
select is(tests.zpmiss(current_setting('t.r6')::uuid, true), true, 'after 31 minutes: true (revert allowed)');
select is(tests.zpmiss(current_setting('t.r6')::uuid, false), false, 'an ok verification clears it');
select ok((select payout_missing_since is null from public.raffles where id = current_setting('t.r6')::uuid), 'cleared');
select throws_ok(format('select tests.zpmiss(%L, true)', current_setting('t.r5')), 'invalid_state',
  'no payout mark without a recorded payout');

-- ===== 9. unpaid =====
select is(tests.znotify(), 1, 'notify_unpaid_raffles: R5 (drawn 15 days ago, no payout)');
select is((select count(*)::int from public.notifications n
           where n.kind = 'treasury_notice' and n.data = jsonb_build_object('event', 'raffle_unpaid',
                                                                             'raffleId', current_setting('t.r5'))),
  tests.ztreas(), 'every treasurer gets raffle_unpaid');
select ok((select unpaid_notified_at is not null from public.raffles where id = current_setting('t.r5')::uuid),
  'unpaid_notified_at is set');
select is((tests.zcard('d', current_setting('t.r5')::uuid) ->> 'unpaid')::boolean, true, 'dao_raffles: R5 unpaid');
select is((tests.zcard('d', current_setting('t.r6')::uuid) ->> 'unpaid')::boolean, false,
  'R6 (same age, payout recorded) is not unpaid');
select is(tests.znotify(), 0, 'a second call notifies nobody');
select throws_ok('select tests.znotify(1)', 'chain_invalid', 'an unknown chain → chain_invalid');

-- ===== 10. public feed =====
select is(tests.zfeed('p', 120), '-|Premio de sorteo|true', 'a member sees R1''s payout explained, hash hidden');
select is(tests.zfeed('t', 120), tests.zh(120) || '|Premio de sorteo|true', 'a treasurer sees the hash');
select is(tests.zfeed('p', 104), '-|Premio de sorteo|true', 'R3''s recorded payout is explained too');
select is(tests.zfeed('p', 103), '-|Retirada de un miembro|true', 'the withdrawal payout keeps its own note');
select is(tests.zfeed('p', 101), tests.zh(101) || '|-|false', 'R1''s unlinked outflow is unexplained');
select ok(not (tests.zunexp() && array[tests.zh(120), tests.zh(104), tests.zh(103)]),
  'treasury_unexplained_outflows excludes the prize and withdrawal payouts');
select ok(tests.zunexp() @> array[tests.zh(101), tests.zh(102), tests.zh(110), tests.zh(113), tests.zh(170)],
  'and lists the outflows that pay nothing');
select is(tests.zdetail('w', current_setting('t.r3')::uuid) ->> 'payoutTxHash', tests.zh(104),
  'the winner sees the payout hash on the raffle page');
select is(tests.zdetail('p', current_setting('t.r3')::uuid) ->> 'payoutTxHash', null, 'a plain member does not');

-- ===== 11. Task 3 carry: draw_raffle timestamps =====
select set_config('t.rd', tests.zcreate('USDC', 1000000)::text, true);
select tests.authenticate_as(tests.zuser('a'));
select public.enter_raffle(current_setting('t.rd')::uuid);
select tests.clear_authentication();
update public.raffles set closes_at = now() - interval '2 seconds' where id = current_setting('t.rd')::uuid;
set local role service_role;
select is(public.close_due_raffles(59141), jsonb_build_object('closed', 1, 'voided', 0), 'RD closes');
reset role;
select set_config('t.blk', (select jsonb_build_object('number', 900, 'hash', tests.zh(900),
                                   'timestamp', tests.ziso(r.closes_at + interval '1 second'),
                                   'parentTimestamp', tests.ziso(r.closes_at))
                            from public.raffles r where r.id = current_setting('t.rd')::uuid)::text, true);
select throws_ok(format('select tests.zdraw(%L, %L)', current_setting('t.rd'),
                        jsonb_set(current_setting('t.blk')::jsonb, '{timestamp}', '"now"')),
  'invalid_input', 'a ''now'' block time → invalid_input');
select throws_ok(format('select tests.zdraw(%L, %L)', current_setting('t.rd'),
                        jsonb_set(current_setting('t.blk')::jsonb, '{parentTimestamp}', '"epoch"')),
  'invalid_input', 'an ''epoch'' parent time → invalid_input');
select throws_ok(format('select tests.zdraw(%L, %L)', current_setting('t.rd'),
                        jsonb_set(current_setting('t.blk')::jsonb, '{timestamp}', to_jsonb(to_char(now() + interval '1 day', 'YYYY-MM-DD')))),
  'invalid_input', 'a date without a time → invalid_input');
select throws_ok(format('select tests.zdraw(%L, %L)', current_setting('t.rd'),
                        jsonb_set(current_setting('t.blk')::jsonb, '{timestamp}', to_jsonb(tests.ziso(now() + interval '1 hour')))),
  'draw_block_invalid', 'a block time an hour in the future → draw_block_invalid');
select is(tests.zdraw(current_setting('t.rd')::uuid, current_setting('t.blk')::jsonb) ->> 'status', 'drawn',
  'a valid ISO block draws');
select is((select abs(extract(epoch from draw_parent_block_time - closes_at)) < 0.001
           from public.raffles where id = current_setting('t.rd')::uuid), true,
  'the parent block time is stored');
select is(tests.zdetail('c', current_setting('t.rd')::uuid) ->> 'drawParentBlockTime' is not null, true,
  'raffle_detail shows the parent block time');

select * from finish();
rollback;
