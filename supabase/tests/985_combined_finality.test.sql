-- Re-review round 2 (migration 20261019600006):
--   R2-I1: in a combined payout finalize_withdrawal books only the withdrawal's share (payout − the USDC prize recorded on
--          the same log) in net_contributed_usdc, the withdrawal_paid notice and the audit row; a prize recorded after the
--          withdrawal was finalized gives its prize back to the winner's net contribution.
--   R2-M1: a combined candidate that fails for good is retired (never offered again) instead of looping every run.
--   R2-M3: a revert started from the withdrawal side, a second prize on the combined log, the prize recording first.
-- Fixture: S = 10 * 10^18 at 10 000 USDC. A holds 1; W1..W6 hold 1.5 each (net 1 500 USDC) and are approved for their
-- whole position, amounts fixed at 400 USDC. Prizes of 150 USDC: R1 → W1, R2 and R2b → W2, R3 → W3, R4 → W4, R6 → W6.
begin;
select plan(36);

create function tests.fh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.fsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.fw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.fuser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
create function tests.fout(p_n int, p_amount numeric, p_to text) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.record_safe_operations(59141, tests.fsafe(), jsonb_build_array(jsonb_build_object(
    'txHash', tests.fh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out', 'amount', p_amount::text,
    'counterparty', p_to, 'blockNumber', p_n, 'occurredAt', now() + interval '1 minute')), p_n);
  reset role;
end;
$$;
create function tests.fpay(p_n int, p_amount numeric, p_to text) returns jsonb language sql as $$
  select jsonb_build_object('txHash', tests.fh(p_n), 'logIndex', '0', 'blockNumber', p_n::text,
                            'blockTime', to_char((now() + interval '1 minute') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'to', p_to, 'token', 'USDC', 'amount', p_amount::text)
$$;
create function tests.frr(p_raffle text, p_n int, p_amount numeric, p_to text) returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_raffle_payout(current_setting('t.' || p_raffle)::uuid, tests.fsafe(), tests.fpay(p_n, p_amount, p_to), null);
  reset role;
  return v ->> 'status';
exception when others then
  reset role;
  return sqlerrm;
end;
$$;
create function tests.frw(p_req text, p_n int, p_amount numeric, p_to text) returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_withdrawal_payout(current_setting('t.' || p_req)::uuid, tests.fsafe(), tests.fpay(p_n, p_amount, p_to) - 'token', null);
  reset role;
  return v ->> 'status';
exception when others then
  reset role;
  return sqlerrm;
end;
$$;
create function tests.ffinw(p_req text) returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.finalize_withdrawal(current_setting('t.' || p_req)::uuid, tests.fsafe(), 1000);
  reset role;
  return v ->> 'status';
end;
$$;
create function tests.ffinr(p_raffle text) returns text language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.finalize_raffle_payout(current_setting('t.' || p_raffle)::uuid, tests.fsafe(), 1000);
  reset role;
  return v ->> 'status';
end;
$$;
create function tests.fpos(p_member text) returns text language sql as $$
  select p.shares::text || ':' || p.net_contributed_usdc::text from public.dao_positions p
  where p.chain_id = 59141 and p.member_id = current_setting('t.' || p_member)::uuid
$$;
create function tests.fop(p_n int) returns text language sql as $$
  select coalesce(o.withdrawal_id::text, '-') || '|' || coalesce(o.raffle_id::text, '-') || '|' || (o.combine_retired_at is not null)
  from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.fh(p_n)
$$;
create function tests.fdraw(p_raffle text, p_winner text) returns void language plpgsql as $$
begin
  update public.raffles
  set status = 'drawn', closed_at = now(), total_weight = 1, seed_reveal = '0x' || lpad('5eed', 64, '0'),
      draw_block_number = 1, draw_block_hash = tests.fh(1), draw_block_time = now(), draw_random = '0',
      winner_position = 1, winner_member_id = current_setting('t.' || p_winner)::uuid, winner_address = tests.fw(p_winner),
      drawn_at = now()
  where id = current_setting('t.' || p_raffle)::uuid;
  delete from private.raffle_seeds where raffle_id = current_setting('t.' || p_raffle)::uuid;
end;
$$;
create function tests.funlinkr(p_raffle text, p_n int) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.unlink_raffle_candidate(current_setting('t.' || p_raffle)::uuid, tests.fh(p_n), 0, 'failed');
  reset role;
  return v;
end;
$$;
create function tests.funlinkw(p_req text, p_n int) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.unlink_withdrawal_candidate(current_setting('t.' || p_req)::uuid, tests.fh(p_n), 0, 'failed');
  reset role;
  return v;
end;
$$;
create function tests.fmissr(p_raffle text, p_n int, p_missing boolean) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.raffle_candidate_missing(current_setting('t.' || p_raffle)::uuid, tests.fh(p_n), 0, p_missing);
  reset role;
  return v;
end;
$$;

-- ===== fixture =====
select set_config('t.a', tests.create_member('0x' || lpad('f9850', 40, '0'), null, true)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9859', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.w' || n, tests.create_member('0x' || lpad('f985' || n, 40, '0'), current_setting('t.a')::uuid)::text, true)
from generate_series(1, 6) n;
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T985 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T985 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe98501', 40, '0'), platform_wallet = null,
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
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc)
  select 59141, current_setting('t.a')::uuid, 1000000000000000000, 1000000000
  union all
  select 59141, current_setting('t.w' || n)::uuid, 1500000000000000000, 1500000000 from generate_series(1, 6) n;
insert into public.dao_scan_state (chain_id, last_block) values (59141, 10);

select tests.authenticate_as(tests.fuser('t'));
select set_config('t.' || x, (public.create_raffle('Sorteo 985 ' || x, 'USDC', 150000000, now() + interval '1 day', 'equal') ->> 'id'), true)
from unnest(array['r1', 'r2', 'r2b', 'r3', 'r4', 'r5', 'r6']) x;
select tests.clear_authentication();
select tests.fdraw('r1', 'w1');
select tests.fdraw('r2', 'w2');
select tests.fdraw('r2b', 'w2');
select tests.fdraw('r3', 'w3');
select tests.fdraw('r4', 'w4');
select tests.fdraw('r5', 'w5');
select tests.fdraw('r6', 'w6');

do $$
declare n int;
begin
  for n in 1..6 loop
    perform tests.authenticate_as(tests.fuser('w' || n));
    perform set_config('t.wr' || n, public.request_withdrawal(1500000000000000000)::text, true);
    perform tests.clear_authentication();
  end loop;
end;
$$;
set local role service_role;
select public.approve_withdrawal(current_setting('t.wr' || n)::uuid, current_setting('t.t')::uuid, tests.fsafe(), 10000000000, 10)
from generate_series(1, 6) n;
reset role;
-- round amounts for the arithmetic (the approval formula is pinned elsewhere)
update public.withdrawal_requests set amount_usdc_locked = 400000000
 where id in (select current_setting('t.wr' || n)::uuid from generate_series(1, 6) n);
select is((select count(*)::int from public.withdrawal_requests where status = 'approved' and amount_usdc_locked = 400000000
           and id in (select current_setting('t.wr' || n)::uuid from generate_series(1, 6) n)), 6, 'setup: six approved withdrawals of 400');

-- ===== 1. W1 + R1: the prize records first (W1 only has the scan's candidate), the prize finalizes first =====
select tests.fout(101, 550000000, tests.fw('w1'));
select is(tests.fop(101), current_setting('t.wr1') || '|-|false', 'the 550 is W1''s candidate');
select is(tests.frr('r1', 101, 550000000, tests.fw('w1')), 'recorded', 'R2-M3: R1 records first, W1 still only a candidate');
select is(tests.frw('wr1', 101, 550000000, tests.fw('w1')), 'recorded', 'then W1 records the same log');
select is(tests.ffinr('r1'), 'paid', 'R1 finalizes first');
select is(tests.ffinw('wr1'), 'paid', 'then W1');
select is(tests.fpos('w1'), '0:1100000000', 'R2-I1: W1 burns 1.5 shares and its net contribution drops by exactly 400');
select is((select n.data ->> 'amount' from public.notifications n
           where n.kind = 'withdrawal_paid' and n.data ->> 'requestId' = current_setting('t.wr1')), '400000000',
  'the withdrawal_paid notice says 400, not 550');
select is((select a.payload ->> 'amount' from public.audit_log a
           where a.action = 'withdrawal_paid' and a.target_id = current_setting('t.wr1')::uuid), '400000000',
  'and so does the audit row');

-- ===== 2. W2 + R2: the withdrawal finalizes first; a second prize cannot claim the log =====
select tests.fout(102, 550000000, tests.fw('w2'));
select is(tests.frw('wr2', 102, 550000000, tests.fw('w2')), 'recorded', 'W2 records the 550');
select is(tests.frr('r2', 102, 550000000, tests.fw('w2')), 'recorded', 'R2 records it too');
select is(tests.frr('r2b', 102, 550000000, tests.fw('w2')), 'tx_already_used', 'R2-M3: a second prize of W2 cannot claim the combined log');
select is(tests.ffinw('wr2'), 'paid', 'W2 finalizes first');
select is(tests.fpos('w2'), '0:1100000000', 'W2''s net contribution drops by 400');
select is(tests.ffinr('r2'), 'paid', 'then R2');
select is(tests.fpos('w2'), '0:1100000000', 'and R2''s finality changes nothing');

-- ===== 3. W3 + R3: the prize records only after the withdrawal was finalized =====
select tests.fout(103, 550000000, tests.fw('w3'));
select is(tests.frw('wr3', 103, 550000000, tests.fw('w3')), 'recorded', 'W3 records the 550');
select is(tests.ffinw('wr3'), 'paid', 'W3 is finalized before any prize recorded the log');
select is(tests.fpos('w3'), '0:950000000', 'so the whole 550 is booked (as an overpayment would be)');
select ok(exists (select 1 from public.raffle_payout_candidates(59141) c where c.raffle_id = current_setting('t.r3')::uuid),
  'R3 is still offered the combined log (W3 paid)');
select is(tests.frr('r3', 103, 550000000, tests.fw('w3')), 'recorded', 'R3 records it');
select is(tests.fpos('w3'), '0:1100000000', 'R2-I1: the prize is given back to W3''s net contribution: 1 100 (1 500 − 400)');

-- ===== 4. W4 + R4: a revert started from the withdrawal side undoes both =====
select tests.fout(104, 550000000, tests.fw('w4'));
select is(tests.frw('wr4', 104, 550000000, tests.fw('w4')), 'recorded', 'W4 records the 550');
select is(tests.frr('r4', 104, 550000000, tests.fw('w4')), 'recorded', 'R4 records it');
set local role service_role;
select public.revert_withdrawal_payout(current_setting('t.wr4')::uuid);
reset role;
select is((select status || ':' || coalesce(payout_tx_hash, '-') from public.withdrawal_requests where id = current_setting('t.wr4')::uuid)
          || ' ' || (select status || ':' || coalesce(payout_tx_hash, '-') from public.raffles where id = current_setting('t.r4')::uuid),
  'approved:- drawn:-', 'R2-M3: reverting W4 reverts R4 too');
select is(tests.fop(104), '-|-|false', 'and the op is unlinked');
select is((select count(*)::int from public.audit_log where action = 'raffle_payout_reverted' and target_id = current_setting('t.r4')::uuid),
  1, 'R4''s revert is audited');

-- ===== 5. R2-M1: a combined candidate that fails for good is retired, on either side =====
select tests.fout(106, 550000000, tests.fw('w6'));
select is(tests.fop(106), current_setting('t.wr6') || '|-|false', 'the 550 to W6 is W6''s candidate');
select ok(exists (select 1 from public.raffle_payout_candidates(59141) c
                  where c.raffle_id = current_setting('t.r6')::uuid and c.tx_hash = tests.fh(106)), 'and R6''s combined candidate');
select is(tests.fmissr('r6', 106, true), false, 'a first not-found on the combined candidate only sets the mark');
select is(tests.funlinkr('r6', 106), true, 'a permanent failure retires the combined candidate');
select is(tests.fop(106), current_setting('t.wr6') || '|-|true', 'W6 keeps its link; the op is retired from combining');
select ok(not exists (select 1 from public.raffle_payout_candidates(59141) c where c.raffle_id = current_setting('t.r6')::uuid),
  'R6 is no longer offered the log (no loop)');
-- the withdrawal side: a prize-linked op offered to W5 as combined
select tests.frr('r5', 105, 550000000, tests.fw('w5'));
select tests.fout(105, 550000000, tests.fw('w5'));
select ok(exists (select 1 from public.withdrawal_payout_candidates(59141) c
                  where c.request_id = current_setting('t.wr5')::uuid and c.tx_hash = tests.fh(105)),
  'a 550 recorded by R5 is offered to W5 as combined');
select is(tests.funlinkw('wr5', 105), true, 'a permanent failure retires it');
select ok(not exists (select 1 from public.withdrawal_payout_candidates(59141) c where c.request_id = current_setting('t.wr5')::uuid),
  'and W5 is no longer offered it');

select * from finish();
rollback;
