-- Ruling F4-R3 (migration 20261019600005): one transfer to the same wallet may pay both an approved withdrawal W and a
-- drawn USDC prize R when it covers W.amount_usdc_locked + R.prize_amount. Each kind records it as its payout; the op
-- link stays where the scan put it; revert undoes both; a note never lifts the overpay pause. R-M3: the pause answers
-- valuation_paused.
-- Fixture: W1 and W2 are approved for 400 USDC each (amount fixed directly, see below); R1 (150 USDC) is won by W1,
-- R2 (150 USDC) by W2, R3 (150 USDC) by A, R4 (WETH) by W2.
begin;
select plan(29);

create function tests.ch(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.csafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.cw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.cuser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
create function tests.cout(p_n int, p_amount numeric, p_to text) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.record_safe_operations(59141, tests.csafe(), jsonb_build_array(jsonb_build_object(
    'txHash', tests.ch(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out', 'amount', p_amount::text,
    'counterparty', p_to, 'blockNumber', p_n, 'occurredAt', now() + interval '1 minute')), p_n);
  reset role;
end;
$$;
create function tests.cpay(p_n int, p_amount numeric, p_to text, p_token text default 'USDC') returns jsonb language sql as $$
  select jsonb_build_object('txHash', tests.ch(p_n), 'logIndex', '0', 'blockNumber', p_n::text,
                            'blockTime', to_char((now() + interval '1 minute') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'to', p_to, 'token', p_token, 'amount', p_amount::text)
$$;
-- record_raffle_payout / record_withdrawal_payout as the cron would (no actor); the error code, or the status
create function tests.crr(p_raffle text, p_payout jsonb) returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_raffle_payout(current_setting('t.' || p_raffle)::uuid, tests.csafe(), p_payout, null);
  reset role;
  return v ->> 'status';
exception when others then
  reset role;
  return sqlerrm;
end;
$$;
create function tests.crw(p_req text, p_payout jsonb) returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_withdrawal_payout(current_setting('t.' || p_req)::uuid, tests.csafe(), p_payout - 'token', null);
  reset role;
  return v ->> 'status';
exception when others then
  reset role;
  return sqlerrm;
end;
$$;
create function tests.cstatus() returns text language plpgsql as $$
begin
  if public._dao_assets_covered(59141, (select last_block from public.dao_scan_state where chain_id = 59141)) then
    return 'covered';
  end if;
  return 'stale';
exception when others then
  return sqlerrm;
end;
$$;
create function tests.cop(p_n int) returns text language sql as $$
  select coalesce(o.withdrawal_id::text, '-') || '|' || coalesce(o.raffle_id::text, '-')
  from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.ch(p_n)
$$;
create function tests.cdraw(p_raffle text, p_winner text) returns void language plpgsql as $$
begin
  update public.raffles
  set status = 'drawn', closed_at = now(), total_weight = 1, seed_reveal = '0x' || lpad('5eed', 64, '0'),
      draw_block_number = 1, draw_block_hash = tests.ch(1), draw_block_time = now(), draw_random = '0',
      winner_position = 1, winner_member_id = current_setting('t.' || p_winner)::uuid, winner_address = tests.cw(p_winner),
      drawn_at = now()
  where id = current_setting('t.' || p_raffle)::uuid;
  delete from private.raffle_seeds where raffle_id = current_setting('t.' || p_raffle)::uuid;
end;
$$;

select set_config('t.a', tests.create_member('0x' || lpad('f9840', 40, '0'), null, true)::text, true);
select set_config('t.w1', tests.create_member('0x' || lpad('f9841', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.w2', tests.create_member('0x' || lpad('f9842', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9843', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T984 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T984 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe98401', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
delete from public.dao_safe_operations where raffle_id is not null;
delete from public.raffles;
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.dao_ledger set block_number = 0 where chain_id = 59141 and status = 'credited';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
delete from public.dao_scan_state where chain_id = 59141;
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 10000000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 2000000000000000000, 2000000000),
  (59141, current_setting('t.w1')::uuid, 4000000000000000000, 4000000000),
  (59141, current_setting('t.w2')::uuid, 4000000000000000000, 4000000000);
insert into public.dao_scan_state (chain_id, last_block) values (59141, 10);

-- the prizes first (create_raffle caps a prize at half the cached value), then the approvals
select tests.authenticate_as(tests.cuser('t'));
select set_config('t.r' || n, (public.create_raffle('Sorteo 984-' || n, 'USDC', 150000000, now() + interval '1 day', 'equal') ->> 'id'), true)
from generate_series(1, 4) n;
select tests.clear_authentication();
select tests.cdraw('r1', 'w1');
select tests.cdraw('r2', 'w2');
select tests.cdraw('r3', 'a');
select tests.cdraw('r4', 'w2');
update public.raffles set prize_token = 'WETH', prize_amount = 150000000000000000 where id = current_setting('t.r4')::uuid;

select tests.authenticate_as(tests.cuser('w1'));
select set_config('t.wr1', public.request_withdrawal(4000000000000000000)::text, true);
select tests.clear_authentication();
select tests.authenticate_as(tests.cuser('w2'));
select set_config('t.wr2', public.request_withdrawal(4000000000000000000)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.approve_withdrawal(current_setting('t.wr1')::uuid, current_setting('t.t')::uuid, tests.csafe(), 10000000000, 10);
select public.approve_withdrawal(current_setting('t.wr2')::uuid, current_setting('t.t')::uuid, tests.csafe(), 10000000000, 10);
reset role;
-- round amounts for the arithmetic below (the approval formula is pinned elsewhere)
update public.withdrawal_requests set amount_usdc_locked = 400000000
 where id in (current_setting('t.wr1')::uuid, current_setting('t.wr2')::uuid);
select is(tests.cstatus(), 'covered', 'setup: no outflow, valuations covered');

-- ===== 1. 550 = 400 + 150 to W1 =====
select tests.cout(101, 550000000, tests.cw('w1'));
select is(tests.cop(101), current_setting('t.wr1') || '|-', 'the scan links the 550 to W1 (the larger owed amount)');
select is(tests.cstatus(), 'valuation_paused', 'R-M3: R1 is still owed while its prize left inside the 550: valuation_paused');
update public.dao_safe_operations set note = 'Pago combinado' where tx_hash = tests.ch(101);
select is(tests.cstatus(), 'valuation_paused', 'F4-R3: a note does not lift the overpay branch');
select ok(exists (select 1 from public.raffle_payout_candidates(59141) c
                  where c.raffle_id = current_setting('t.r1')::uuid and c.tx_hash = tests.ch(101)),
  'the raffle detection sees the combined log as R1''s candidate');
select ok(exists (select 1 from public.withdrawal_payout_candidates(59141) c
                  where c.request_id = current_setting('t.wr1')::uuid and c.tx_hash = tests.ch(101)),
  'and the withdrawal detection as W1''s');
select is(tests.crr('r1', tests.cpay(101, 550000000, tests.cw('w1'))), 'recorded', 'R1 records the same hash');
select is(tests.cop(101), current_setting('t.wr1') || '|-', 'the op link stays with W1');
select is(tests.cstatus(), 'covered', 'valuations resume: R1 is paid by it, W1''s candidate covers W1');
select is(tests.crw('wr1', tests.cpay(101, 550000000, tests.cw('w1'))), 'recorded', 'W1 records it too (cross-kind exception)');
select is(tests.crr('r1', tests.cpay(101, 550000000, tests.cw('w1'))), 'already', 'a second paste is idempotent');

-- ===== 2. revert undoes both =====
set local role service_role;
select public.revert_raffle_payout(current_setting('t.r1')::uuid);
reset role;
select is((select coalesce(payout_tx_hash, '-') from public.raffles where id = current_setting('t.r1')::uuid), '-', 'R1 is reverted');
select is((select status || ':' || coalesce(payout_tx_hash, '-') from public.withdrawal_requests where id = current_setting('t.wr1')::uuid),
  'approved:-', 'and W1 with it (the same transfer)');
select is(tests.cop(101), '-|-', 'the op is unlinked (nothing records it any more)');
select is((select count(*)::int from public.audit_log where action = 'withdrawal_payout_reverted'
           and target_id = current_setting('t.wr1')::uuid), 1, 'W1''s revert is audited');

-- ===== 3. both recorded again (withdrawal first), then both finalized =====
select is(tests.crw('wr1', tests.cpay(101, 550000000, tests.cw('w1'))), 'recorded', 'W1 records the 550 again');
select is(tests.cop(101), current_setting('t.wr1') || '|-', 'and links it');
select is(tests.crr('r1', tests.cpay(101, 550000000, tests.cw('w1'))), 'recorded', 'R1 records it with W1''s payout in place');
set local role service_role;
select is(public.finalize_withdrawal(current_setting('t.wr1')::uuid, tests.csafe(), 200) ->> 'status', 'paid', 'W1 is finalized');
select is(public.finalize_raffle_payout(current_setting('t.r1')::uuid, tests.csafe(), 200) ->> 'status', 'paid', 'R1 is finalized');
reset role;
select is((select status from public.withdrawal_requests where id = current_setting('t.wr1')::uuid)
          || ':' || (select status from public.raffles where id = current_setting('t.r1')::uuid), 'paid:paid', 'both are paid');
select is(tests.cstatus(), 'covered', 'and nothing pauses');

-- ===== 4. what does not combine =====
select tests.cout(102, 549000000, tests.cw('w2'));
select is(tests.cop(102), current_setting('t.wr2') || '|-', '549 to W2 is W2''s candidate');
select is(tests.crr('r2', tests.cpay(102, 549000000, tests.cw('w2'))), 'tx_already_used', '549 < 400 + 150: refused for R2');
select ok(not exists (select 1 from public.raffle_payout_candidates(59141) c where c.raffle_id = current_setting('t.r2')::uuid),
  'and not offered to R2''s detection');
select ok(tests.crr('r3', tests.cpay(102, 549000000, tests.cw('w2'))) in ('tx_already_used', 'tx_mismatch'), 'a prize won by another wallet: refused');
select ok(tests.crr('r4', tests.cpay(102, 549000000, tests.cw('w2'))) in ('tx_already_used', 'tx_mismatch'), 'a WETH prize never combines with USDC');
select ok(tests.crr('r4', tests.cpay(102, 549000000, tests.cw('w2'), 'WETH')) in ('tx_already_used', 'tx_mismatch'), 'not even claimed as WETH');
select is(tests.cstatus(), 'valuation_paused', 'R2 stays owed with 549 > 400 sent to its wallet: paused');

select * from finish();
rollback;
