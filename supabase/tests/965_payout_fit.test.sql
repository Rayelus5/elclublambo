-- F4d final-review fix (migration 20261019400006):
--   F4d-R6: when an outflow matches both a withdrawal candidate and a prize candidate, the scan picks by fit across
--           kinds: an exact amount first, then the largest owed amount <= the outflow; withdrawal precedence only as the
--           tie-break. Recorded payouts are still matched first (F4d-R4).
--   F4d-R7: create_raffle refuses a prize worth more than half the cached fund value (prize_too_large).
-- Setup: 59141 valued at 200 USDC, S = 10 * 10^18. W and V each have an approved 20 USDC withdrawal; RA (25 USDC) and
-- RC (30 USDC) were won by W, RB (20 USDC) by V.
begin;
select plan(17);

-- ===== helpers (rolled back with the test) =====
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
create function tests.fcreate(p_amount numeric) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.fuser('t'));
  v := public.create_raffle('Sorteo ' || p_amount, 'USDC', p_amount, now() + interval '1 day', 'equal');
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
create function tests.fdrawn(p_raffle uuid, p_winner text) returns void language plpgsql as $$
begin
  update public.raffles
  set status = 'drawn', closed_at = now(), total_weight = 1, seed_reveal = '0x' || lpad('5eed', 64, '0'),
      draw_block_number = 1, draw_block_hash = tests.fh(1), draw_block_time = now(), draw_random = '0',
      winner_position = 1, winner_member_id = current_setting('t.' || p_winner)::uuid,
      winner_address = tests.fw(p_winner), drawn_at = now()
  where id = p_raffle;
  delete from private.raffle_seeds where raffle_id = p_raffle;
end;
$$;
create function tests.fout(p_n int, p_amount numeric, p_to text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_operations(59141, tests.fsafe(), jsonb_build_array(jsonb_build_object(
         'txHash', tests.fh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out', 'amount', p_amount::text,
         'counterparty', p_to, 'blockNumber', p_n, 'occurredAt', now() + interval '1 minute')), p_n);
  reset role;
  return v;
end;
$$;
create function tests.flink(p_n int) returns text language sql as $$
  select coalesce(o.withdrawal_id::text, '-') || '|' || coalesce(o.raffle_id::text, '-')
  from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.fh(p_n)
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9650', 40, '0'), null, true)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('f9651', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.v', tests.create_member('0x' || lpad('f9652', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9653', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T965 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T965 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe96501', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true, weighted_raffles_enabled = true where chain_id = 59141;
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
  (59141, current_setting('t.a')::uuid, 6000000000000000000, 120000000),
  (59141, current_setting('t.w')::uuid, 2000000000000000000, 40000000),
  (59141, current_setting('t.v')::uuid, 2000000000000000000, 40000000);

-- the scan has covered block 10 (F4c-R7: with W approved, V's valuation must not read past the cursor)
insert into public.dao_scan_state (chain_id, last_block) values (59141, 10);
-- W: 1/10 of 200 = 20 USDC; V: 1/9 of (200 - 20) = 20 USDC
select tests.authenticate_as(tests.fuser('w'));
select set_config('t.ww', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
select tests.authenticate_as(tests.fuser('v'));
select set_config('t.wv', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.approve_withdrawal(current_setting('t.ww')::uuid, current_setting('t.t')::uuid, tests.fsafe(), 200000000, 10);
select public.approve_withdrawal(current_setting('t.wv')::uuid, current_setting('t.t')::uuid, tests.fsafe(), 200000000, 10);
reset role;
select is((select string_agg(amount_usdc_locked::text, ',' order by id) from public.withdrawal_requests
           where id in (current_setting('t.ww')::uuid, current_setting('t.wv')::uuid)), '20000000,20000000',
  'setup: W and V each have an approved 20 USDC withdrawal');

select set_config('t.ra', tests.fcreate(25000000)::text, true);
select set_config('t.rb', tests.fcreate(20000000)::text, true);
select set_config('t.rc', tests.fcreate(30000000)::text, true);
select tests.fdrawn(current_setting('t.ra')::uuid, 'w');
select tests.fdrawn(current_setting('t.rb')::uuid, 'v');
select tests.fdrawn(current_setting('t.rc')::uuid, 'w');

-- ===== 1. F4d-R6: fit across kinds =====
select is(tests.fout(101, 25000000, tests.fw('w')), jsonb_build_object('inserted', 1, 'alerts', 0),
  'a 25 USDC outflow to W is linked');
select is(tests.flink(101), '-|' || current_setting('t.ra'),
  'it is the exact amount of RA''s prize: linked to RA, not to W''s 20 USDC withdrawal');
select is(tests.fout(102, 20000000, tests.fw('w')), jsonb_build_object('inserted', 1, 'alerts', 0),
  'a 20 USDC outflow to W is linked');
select is(tests.flink(102), current_setting('t.ww') || '|-',
  'the exact amount of W''s withdrawal: linked to it (RC''s 30 and RA''s 25 do not fit)');
select is(tests.fout(103, 35000000, tests.fw('w')), jsonb_build_object('inserted', 1, 'alerts', 0),
  'a 35 USDC outflow to W is linked');
select is(tests.flink(103), '-|' || current_setting('t.rc'),
  'no exact fit: the largest owed amount it covers, RC''s 30 (over the withdrawal''s 20)');
select is(tests.fout(104, 20000000, tests.fw('v')), jsonb_build_object('inserted', 1, 'alerts', 0),
  'a 20 USDC outflow to V is linked');
select is(tests.flink(104), current_setting('t.wv') || '|-',
  'V''s withdrawal and RB''s prize are both 20: the withdrawal wins the tie');
select ok((select pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure) ~* 'limit 1\s+for update of w'
              and pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure) ~* 'limit 1\s+for update of r'
              and pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure) ~* 'w\.payout_log_index = v_log\s+for share of w'
              and pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure) ~* 'r\.payout_log_index = v_log\s+for share of r'),
  'the scan keeps its row locks: for share on recorded payouts, for update on candidates');
select ok((select position('r.payout_log_index = v_log' in d) < position('w.destination_address = v_cp' in d)
           from pg_get_functiondef('public.record_safe_operations(int,text,jsonb,bigint)'::regprocedure) d),
  'F4d-R4 kept: recorded payouts of both kinds before any candidate');

-- ===== 2. F4d-R7: a prize is at most half the cached fund value =====
update public.dao_state set value_usdc = 100000000 where chain_id = 59141;
select tests.authenticate_as(tests.fuser('t'));
select throws_ok($$select public.create_raffle('Mitad y un poco', 'USDC', 50000001, now() + interval '1 day', 'equal')$$,
  'prize_too_large', '50.000001 USDC on a 100 USDC fund → prize_too_large');
select lives_ok($$select public.create_raffle('Mitad justa', 'USDC', 50000000, now() + interval '1 day', 'equal')$$,
  'exactly half (50 of 100 USDC) is allowed');
select tests.clear_authentication();
select is((select value_usdc from public.dao_state where chain_id = 59141), 50000000::numeric,
  'the cached value drops by the prize');
select tests.authenticate_as(tests.fuser('t'));
select throws_ok($$select public.create_raffle('Otra vez', 'USDC', 25000001, now() + interval '1 day', 'equal')$$,
  'prize_too_large', 'then 25.000001 USDC on the remaining 50 → prize_too_large');
select lives_ok($$select public.create_raffle('Un cuarto', 'USDC', 25000000, now() + interval '1 day', 'equal')$$,
  'and 25 USDC (half of 50) is allowed');
select tests.clear_authentication();
select ok((select prosrc ~ 'v_value \* 2 > s\.value_usdc' from pg_proc
           where oid = 'public.create_raffle(text,text,numeric,timestamptz,text)'::regprocedure),
  'the cap is the exact integer comparison prize_value_usd6 * 2 > value_usdc');

select * from finish();
rollback;
