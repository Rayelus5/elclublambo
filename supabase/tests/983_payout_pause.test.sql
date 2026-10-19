-- Ruling F4-R2 (migration 20261019600004): valuations pause (assets_stale) while an approved, unpaid withdrawal or a
-- drawn, unpaid prize has an unexplained outflow in its token to its destination within [start − 120 s, start + 14 d]
-- (a treasurer note explains it). Same predicate, one helper, behind treasury_withdrawals.unexplained_outflow (now
-- with the end bound, M4) and treasury_raffles.unexplained_outflow. M1: record_nav_snapshot refuses a read older than
-- a credited donation.
-- Setup: 59141 valued at 1000 USDC, S = 10 * 10^18; W holds 4 and has an approved 400 USDC withdrawal.
begin;
select plan(27);

create function tests.qh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.qsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.qw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.quser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
-- one USDC outflow to W at block n, at time p_at
create function tests.qout(p_n int, p_amount numeric, p_at timestamptz) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.record_safe_operations(59141, tests.qsafe(), jsonb_build_array(jsonb_build_object(
    'txHash', tests.qh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out', 'amount', p_amount::text,
    'counterparty', tests.qw('w'), 'blockNumber', p_n, 'occurredAt', p_at)), p_n);
  reset role;
end;
$$;
create function tests.qnote(p_n int) returns void language sql as $$
  update public.dao_safe_operations set note = 'Explicada' where chain_id = 59141 and tx_hash = tests.qh(p_n)
$$;
-- since 20261019600005 (R-M3) the pause raises valuation_paused: read here as "not covered" (the code is pinned in 984)
create function tests.qcovered() returns boolean language plpgsql as $$
begin
  return public._dao_assets_covered(59141, (select last_block from public.dao_scan_state where chain_id = 59141));
exception when others then
  if sqlerrm = 'valuation_paused' then
    return false;
  end if;
  raise;
end;
$$;
create function tests.qsnap(p_block bigint) returns text language plpgsql as $$
begin
  delete from public.dao_nav_snapshots where chain_id = 59141;
  set local role service_role;
  perform public.record_nav_snapshot(59141, tests.qsafe(), jsonb_build_object(
    'usdcUnits', '1000000000', 'ethWei', '0', 'wethWei', '0', 'ethPriceE8', '200000000000',
    'priceSource', 'chainlink', 'blockNumber', p_block::text, 'assetsUsd6', '1000000000'));
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlerrm;
end;
$$;
create function tests.qflag_w() returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.authenticate_as(tests.quser('t'));
  select x.unexplained_outflow into v from public.treasury_withdrawals() x where x.id = current_setting('t.wr')::uuid;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.qflag_r() returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.authenticate_as(tests.quser('t'));
  select x.unexplained_outflow into v from public.treasury_raffles() x where x.id = current_setting('t.rr')::uuid;
  perform tests.clear_authentication();
  return v;
end;
$$;

select set_config('t.a', tests.create_member('0x' || lpad('f9830', 40, '0'), null, true)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('f9831', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9832', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T983 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T983 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe98301', 40, '0'), platform_wallet = null,
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
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 1000000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 6000000000000000000, 600000000),
  (59141, current_setting('t.w')::uuid, 4000000000000000000, 400000000);
insert into public.dao_scan_state (chain_id, last_block) values (59141, 10);

select tests.authenticate_as(tests.quser('w'));
select set_config('t.wr', public.request_withdrawal(4000000000000000000)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.approve_withdrawal(current_setting('t.wr')::uuid, current_setting('t.t')::uuid, tests.qsafe(), 1000000000, 10);
reset role;
select is((select amount_usdc_locked from public.withdrawal_requests where id = current_setting('t.wr')::uuid), 400000000::numeric,
  'setup: W is approved for 400 USDC');
select set_config('t.at', (select approved_at::text from public.withdrawal_requests where id = current_setting('t.wr')::uuid), true);

-- ===== definitions =====
select ok((select bool_and(not has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute')
                           and not has_function_privilege('service_role', f, 'execute'))
           from unnest(array['public._payout_outflow_unexplained(int,text,text,timestamptz,uuid,uuid)',
                             'public._dao_payout_pause(int)']) f),
  'the pause helpers are granted to no API role');

-- ===== baseline and outflows outside the window =====
select ok(tests.qcovered(), 'no outflow: valuations at the cursor are covered');
select tests.qout(11, 50000000, current_setting('t.at')::timestamptz - interval '1 day');
select tests.qout(12, 50000000, current_setting('t.at')::timestamptz + interval '15 days');
select ok(tests.qcovered(), 'an old outflow before the approval, or one after the 14-day window, does not pause');
select is(tests.qflag_w(), false, 'nor does it flag the reject dialog (M4: the window has an end)');

-- ===== 200 + 200 (split payout) =====
select tests.qout(13, 200000000, now() + interval '1 minute');
select tests.qout(14, 200000000, now() + interval '2 minutes');
select is((select count(*)::int from public.dao_safe_operations where tx_hash in (tests.qh(13), tests.qh(14)) and withdrawal_id is null),
  2, 'neither half covers 400: both stay unlinked');
select ok(not tests.qcovered(), 'a split payout pauses valuations');
select is(tests.qsnap(14), 'valuation_paused', 'the snapshot answers valuation_paused (R-M3)');
select is(tests.qflag_w(), true, 'and the panel flags the withdrawal');
select tests.qnote(13);
select ok(not tests.qcovered(), 'one half noted: still paused');
select tests.qnote(14);
select ok(tests.qcovered(), 'both halves noted: valuations resume');
select is(tests.qsnap(14), 'ok', 'the snapshot is taken again');

-- ===== a short payout (399.99) =====
select tests.qout(15, 399990000, now() + interval '3 minutes');
select is((select withdrawal_id from public.dao_safe_operations where tx_hash = tests.qh(15)), null::uuid, '399.99 is not linked');
select ok(not tests.qcovered(), 'a short payout pauses valuations');
select tests.qnote(15);
select ok(tests.qcovered(), 'noted: resumed');

-- ===== combined: one 550 to a member who is owed W = 400 and prize R = 150 =====
select tests.authenticate_as(tests.quser('t'));
select set_config('t.rr', (public.create_raffle('Sorteo 983', 'USDC', 150000000, now() + interval '1 day', 'equal') ->> 'id'), true);
select tests.clear_authentication();
update public.raffles
set status = 'drawn', closed_at = now(), total_weight = 1, seed_reveal = '0x' || lpad('5eed', 64, '0'),
    draw_block_number = 1, draw_block_hash = tests.qh(1), draw_block_time = now(), draw_random = '0',
    winner_position = 1, winner_member_id = current_setting('t.w')::uuid, winner_address = tests.qw('w'), drawn_at = now()
where id = current_setting('t.rr')::uuid;
delete from private.raffle_seeds where raffle_id = current_setting('t.rr')::uuid;
select ok(tests.qcovered(), 'a drawn prize with no outflow yet does not pause');
select tests.qout(16, 550000000, now() + interval '4 minutes');
select is((select withdrawal_id from public.dao_safe_operations where tx_hash = tests.qh(16)), current_setting('t.wr')::uuid,
  'the 550 is linked to W (the larger owed amount it covers)');
select is(tests.qflag_w(), false, 'W is covered by its own candidate: not flagged');
select is(tests.qflag_r(), true, 'R is flagged: the outflow linked to W overpays it by the prize');
select ok(not tests.qcovered(), 'and valuations pause: R stays a liability while its prize left inside the 550');
select tests.qnote(16);
-- F4-R3 (20261019600005): a note no longer lifts the overpay branch (R's prize left inside the 550)
select ok(not tests.qcovered(), 'F4-R3: a treasurer note on the 550 does not lift the pause');
select is(tests.qflag_r(), true, 'R stays flagged');
create function tests.qrecr(p_n int, p_amount numeric) returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_raffle_payout(current_setting('t.rr')::uuid, tests.qsafe(), jsonb_build_object(
         'txHash', tests.qh(p_n), 'logIndex', '0', 'blockNumber', p_n::text,
         'blockTime', to_char((now() + interval '4 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'to', tests.qw('w'), 'token', 'USDC', 'amount', p_amount::text), null);
  reset role;
  return v ->> 'status';
end;
$$;
select is(tests.qrecr(16, 550000000), 'recorded', 'R records the same hash: a combined payout (400 + 150)');
select ok(tests.qcovered(), 'valuations resume');
select is(tests.qflag_r(), false, 'and R is no longer flagged');

-- ===== M1: the snapshot refuses a read older than a credited donation =====
update public.dao_scan_state set last_block = 1000 where chain_id = 59141;
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
  recipient_address, target_type, status)
values ('98300000-0000-4000-8000-000000000001', current_setting('t.a')::uuid, 'donation', 59141, 'USDC', 4000000, 0, 0, 0,
  tests.qsafe(), 'dao', 'confirmed');
insert into public.dao_ledger (id, chain_id, kind, member_id, amount_usdc, intent_id, tx_hash, log_index, block_number,
                               status, shares_delta, credited_at)
values ('98300000-0000-4000-8000-000000000002', 59141, 'donation', current_setting('t.a')::uuid, 4000000,
  '98300000-0000-4000-8000-000000000001', tests.qh(999), 0, 500, 'credited', 1, now());
select is(tests.qsnap(400), 'assets_stale', 'M1: a snapshot read at 400 with a donation credited from block 500 is stale');
select is(tests.qsnap(600), 'ok', 'a read at or after it is taken');

select * from finish();
rollback;
