-- P2 Task 5 (migration 20261025100003): close, drand draw, payouts and deliveries of public giveaways.
--   - private.giveaway_pick: P1's draw as a pure helper; the fixture tests/fixtures/giveaway-draw.json gives [4,2,5].
--   - close_due_public_giveaways: positions 1..n by (entered_at, user_id); 0 entries -> void, seed revealed (RF 3).
--   - draw_public_giveaway: the target round only, randomness = sha256(signature) of the real round 1000,
--     not_enough_entries for prizes beyond the entries (RF 3), idempotent 'already'.
--   - record_public_giveaway_payout: the host only, crypto and awarded, tx_already_used against intents, club prizes
--     and other public prizes. mark_public_prize_delivered: the host only, custom and awarded.
begin;
select plan(45);

create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- the drand quicknet round 1000 (tests/fixtures/giveaway-draw.json)
create function tests.sig() returns text language sql immutable as $$
  select 'b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39'::text
$$;
create function tests.pg3_create(p_prizes jsonb) returns uuid language sql as $$
  select public.create_public_giveaway('Sorteo público', null, now() + interval '1 hour', null, 0, null, p_prizes)
$$;
-- as postgres: closes_at in the past and target_round 1000 so the real round can be drawn
create function tests.pg3_due(p_id uuid) returns void language sql as $$
  update public.public_giveaways set closes_at = now() - interval '1 second', target_round = 1000 where id = p_id
$$;
create function tests.pg3_prize(p_id uuid, p_rank int) returns uuid language sql as $$
  select id from public.public_giveaway_prizes where giveaway_id = p_id and rank = p_rank
$$;

-- ===== fixtures =====
select set_config('t.ha', '0x' || lpad('b3b00', 40, '0'), true);
select set_config('t.host', tests.create_wallet_user(current_setting('t.ha'))::text, true);
select set_config('t.other', tests.create_wallet_user('0x' || lpad('b3b0f', 40, '0'))::text, true);
-- seven entrants u1..u7 with wallets 0x..b3b1<i>
create table tests.pg3_users (i int primary key, user_id uuid, wallet text);
insert into tests.pg3_users
select i, tests.create_wallet_user('0x' || lpad('b3b1' || i, 40, '0')), '0x' || lpad('b3b1' || i, 40, '0')
from generate_series(1, 7) i;

select tests.authenticate_as(current_setting('t.host')::uuid);
-- G1: 7 entries, 3 prizes (crypto, custom, crypto), the fixture seed
select set_config('t.g1', tests.pg3_create(
  '[{"kind":"crypto","chainId":84532,"amount":"5000000"},{"kind":"custom","label":"Camiseta"},{"kind":"crypto","chainId":84532,"amount":"1000000"}]')::text, true);
-- G2: 2 entries, 3 prizes (RF 3)
select set_config('t.g2', tests.pg3_create(
  '[{"kind":"crypto","chainId":84532,"amount":"2000000"},{"kind":"custom","label":"Taza"},{"kind":"custom","label":"Gorra"}]')::text, true);
-- G3: no entries -> void
select set_config('t.g3', tests.pg3_create('[{"kind":"custom","label":"Nadie"}]')::text, true);
-- G4: not due
select set_config('t.g4', tests.pg3_create('[{"kind":"custom","label":"Luego"}]')::text, true);
select tests.clear_authentication();

-- entries in a known order: u<i> enters at t0 + i s (G1: all seven, G2: u1 and u2)
insert into public.public_giveaway_entries (giveaway_id, user_id, wallet_address, entered_at)
select current_setting('t.g1')::uuid, u.user_id, u.wallet, now() - interval '1 hour' + u.i * interval '1 second'
from tests.pg3_users u;
insert into public.public_giveaway_entries (giveaway_id, user_id, wallet_address, entered_at)
select current_setting('t.g2')::uuid, u.user_id, u.wallet, now() - interval '1 hour' + u.i * interval '1 second'
from tests.pg3_users u where u.i <= 2;
select tests.pg3_due(current_setting('t.g1')::uuid);
select tests.pg3_due(current_setting('t.g2')::uuid);
select tests.pg3_due(current_setting('t.g3')::uuid);
select set_config('t.g3seed', (select '0x' || encode(seed, 'hex') from private.public_giveaway_seeds
                               where giveaway_id = current_setting('t.g3')::uuid), true);

-- ===== 1. privileges =====
select ok(not has_function_privilege('anon', 'public.close_due_public_giveaways()', 'execute')
      and not has_function_privilege('anon', 'public.public_giveaways_awaiting_draw()', 'execute')
      and not has_function_privilege('anon', 'public.draw_public_giveaway(uuid,bigint,text)', 'execute')
      and not has_function_privilege('anon', 'public.record_public_giveaway_payout(uuid,jsonb,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.mark_public_prize_delivered(uuid)', 'execute'),
  'anon cannot execute any of the new functions');
select ok(has_function_privilege('authenticated', 'public.mark_public_prize_delivered(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.close_due_public_giveaways()', 'execute')
      and not has_function_privilege('authenticated', 'public.public_giveaways_awaiting_draw()', 'execute')
      and not has_function_privilege('authenticated', 'public.draw_public_giveaway(uuid,bigint,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_public_giveaway_payout(uuid,jsonb,uuid)', 'execute'),
  'authenticated: only mark_public_prize_delivered');
select ok(has_function_privilege('service_role', 'public.close_due_public_giveaways()', 'execute')
      and has_function_privilege('service_role', 'public.public_giveaways_awaiting_draw()', 'execute')
      and has_function_privilege('service_role', 'public.draw_public_giveaway(uuid,bigint,text)', 'execute')
      and has_function_privilege('service_role', 'public.record_public_giveaway_payout(uuid,jsonb,uuid)', 'execute'),
  'service_role: close, awaiting, draw and payout');
select ok(not has_function_privilege('service_role', 'private.giveaway_pick(bytea,bytea,int,int)', 'execute')
      and not has_function_privilege('authenticated', 'private.giveaway_pick(bytea,bytea,int,int)', 'execute')
      and not has_function_privilege('anon', 'private.giveaway_pick(bytea,bytea,int,int)', 'execute'),
  'giveaway_pick is executable by no API role');

-- ===== 2. giveaway_pick =====
select is(private.giveaway_pick(decode('a9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936', 'hex'),
                                decode('fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd', 'hex'), 7, 3),
  array[4, 2, 5], 'the fixture seed and randomness give the fixture winners (tests/fixtures/giveaway-draw.json)');
select is(cardinality(private.giveaway_pick(decode('a9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936', 'hex'),
                                            decode('fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd', 'hex'), 2, 3)),
  2, 'fewer entries than prizes: as many winners as entries');
select is(private.giveaway_pick(decode(repeat('11', 32), 'hex'), decode(repeat('22', 32), 'hex'), 0, 3),
  '{}'::int[], 'no entries: no winners');
select is((select array_agg(x order by x) from unnest(private.giveaway_pick(decode(repeat('11', 32), 'hex'),
                                                                        decode(repeat('22', 32), 'hex'), 5, 5)) x),
  array[1, 2, 3, 4, 5], 'as many prizes as entries: every position once');
select throws_ok($$select private.giveaway_pick(decode('11', 'hex'), decode(repeat('22', 32), 'hex'), 3, 1)$$,
  'P0001', 'invalid_input', 'a seed that is not 32 bytes is invalid_input');

-- ===== 3. close =====
set local role service_role;
select is(public.close_due_public_giveaways(), '{"closed": 2, "voided": 1}'::jsonb,
  'close closes the two with entries and voids the one without');
select is(public.close_due_public_giveaways(), '{"closed": 0, "voided": 0}'::jsonb, 'a second run changes nothing');
reset role;
select results_eq($$select u.i, e.position from public.public_giveaway_entries e join tests.pg3_users u on u.user_id = e.user_id
                    where e.giveaway_id = current_setting('t.g1')::uuid order by e.position$$,
  $$select i, i from generate_series(1, 7) i$$, 'positions 1..7 follow entered_at');
select is((select status || '|' || entry_count from public.public_giveaways where id = current_setting('t.g1')::uuid),
  'closed|7', 'G1 closed with entry_count 7');
select ok((select status = 'void' and entry_count = 0 and seed_reveal = current_setting('t.g3seed')
           from public.public_giveaways where id = current_setting('t.g3')::uuid)
      and not exists (select 1 from private.public_giveaway_seeds where giveaway_id = current_setting('t.g3')::uuid),
  'with 0 entries: void, the seed revealed and deleted (RF 3)');
select is((select status || ':' || unawarded_reason from public.public_giveaway_prizes
           where giveaway_id = current_setting('t.g3')::uuid),
  'unawarded:not_enough_entries', 'a void giveaway leaves its prizes unawarded');
select is((select status from public.public_giveaways where id = current_setting('t.g4')::uuid), 'open',
  'a giveaway not yet due stays open');

-- ===== 4. draw =====
-- the fixture seed behind G1, so the SQL draw can be compared with TS
update private.public_giveaway_seeds set seed = decode('a9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936', 'hex')
where giveaway_id = current_setting('t.g1')::uuid;
update public.public_giveaways
set seed_commit = '0x' || encode(public._keccak256(decode('a9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936', 'hex')), 'hex')
where id = current_setting('t.g1')::uuid;

set local role service_role;
select is((select array_agg(id::text order by target_round, id) from public.public_giveaways_awaiting_draw()),
          (select array_agg(id::text order by id) from public.public_giveaways
           where id in (current_setting('t.g1')::uuid, current_setting('t.g2')::uuid)),
  'public_giveaways_awaiting_draw lists the closed giveaways');
select throws_ok(format($$select public.draw_public_giveaway(%L, 1001, %L)$$, current_setting('t.g1'), tests.sig()),
  'P0001', 'invalid_input', 'another round than target_round is invalid_input');
select throws_ok(format($$select public.draw_public_giveaway(%L, 1000, 'abcd')$$, current_setting('t.g1')),
  'P0001', 'invalid_input', 'a malformed signature is invalid_input');
select throws_ok(format($$select public.draw_public_giveaway(%L, 1000, %L)$$, gen_random_uuid(), tests.sig()),
  'P0001', 'not_found', 'an unknown giveaway is not_found');
select throws_ok(format($$select public.draw_public_giveaway(%L, 1000, %L)$$, current_setting('t.g3'), tests.sig()),
  'P0001', 'invalid_state', 'a void giveaway cannot be drawn');
reset role;
-- G2 waits for a round still in the future
select set_config('t.future', public._giveaway_target_round(now() + interval '1 hour')::text, true);
update public.public_giveaways set target_round = current_setting('t.future')::bigint
where id = current_setting('t.g2')::uuid;
set local role service_role;
select throws_ok(format($$select public.draw_public_giveaway(%L, %s, %L)$$, current_setting('t.g2'),
                        current_setting('t.future'), tests.sig()),
  'P0001', 'round_not_ready', 'a round not emitted yet is round_not_ready');
reset role;
update public.public_giveaways set target_round = 1000 where id = current_setting('t.g2')::uuid;

set local role service_role;
select is(public.draw_public_giveaway(current_setting('t.g1')::uuid, 1000, tests.sig()), 'drawn', 'the real round 1000 draws');
select is(public.draw_public_giveaway(current_setting('t.g1')::uuid, 1000, upper(tests.sig())), 'already',
  'the same round and signature again is already');
select throws_ok(format($$select public.draw_public_giveaway(%L, 1000, %L)$$, current_setting('t.g1'), repeat('ab', 48)),
  'P0001', 'invalid_state', 'a drawn giveaway with another signature is invalid_state');
select is(public.draw_public_giveaway(current_setting('t.g2')::uuid, 1000, tests.sig()), 'drawn', 'G2 draws');
reset role;

select ok((select status = 'drawn' and drawn_at is not null
                  and drand_randomness = 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd'
                  and seed_reveal = '0xa9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936'
                  and drand_signature = tests.sig()
           from public.public_giveaways where id = current_setting('t.g1')::uuid)
      and not exists (select 1 from private.public_giveaway_seeds where giveaway_id = current_setting('t.g1')::uuid),
  'drawn: randomness = sha256(signature), the seed revealed and deleted');
select results_eq($$select winner_position from public.public_giveaway_prizes
                    where giveaway_id = current_setting('t.g1')::uuid order by rank$$,
  $$values (4), (2), (5)$$, 'the fixture seed and round 1000 give the fixture winners by rank');
select ok((select bool_and(p.status = 'awarded' and p.winner_user_id = u.user_id and p.winner_address = u.wallet)
           from public.public_giveaway_prizes p join tests.pg3_users u on u.i = p.winner_position
           where p.giveaway_id = current_setting('t.g1')::uuid),
  'each prize is awarded to the user at the winning position, with their wallet');
select results_eq($$select status, coalesce(unawarded_reason, '-'), winner_user_id is not null, winner_address is not null,
                           winner_position is not null
                    from public.public_giveaway_prizes where giveaway_id = current_setting('t.g2')::uuid order by rank$$,
  $$values ('awarded'::text, '-'::text, true, true, true), ('awarded', '-', true, true, true),
           ('unawarded', 'not_enough_entries', false, false, false)$$,
  'RF 3: 2 entries for 3 prizes: two awarded, the third unawarded (not_enough_entries)');
select is((select count(distinct winner_user_id)::int from public.public_giveaway_prizes
           where giveaway_id = current_setting('t.g2')::uuid), 2, 'G2: two distinct winners');

-- ===== 5. payouts =====
-- a hash already behind a confirmed intent (member m), and one behind a paid club prize
select set_config('t.m', tests.create_member('0x' || lpad('b3b20', 40, '0'), null, true)::text, true);
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
  recipient_address, target_type, status, main_tx_hash)
values ('00000000-0000-4000-8000-0000000b3b77', current_setting('t.m')::uuid, 'donation', 84532, 'USDC', 1, 0, 0, 0,
  '0x' || repeat('a', 40), 'dao', 'confirmed', tests.hash(77));
insert into public.onchain_transfers (chain_id, tx_hash, log_index, intent_id, role)
values (84532, tests.hash(77), 0, '00000000-0000-4000-8000-0000000b3b77', 'main');
insert into public.giveaways (id, title, closes_at, status, seed_commit, seed_reveal, target_round, drand_signature,
  drand_randomness, entry_count, drawn_at, created_by)
values ('00000000-0000-4000-8000-0000000b3b88', 'Club', now() - interval '1 day', 'drawn', tests.hash(1), tests.hash(2), 1000,
  tests.sig(), repeat('f', 64), 1, now(), current_setting('t.m')::uuid);
insert into public.giveaway_prizes (giveaway_id, rank, kind, chain_id, token, amount, label, winner_member_id, winner_address,
  winner_position, status, payout_tx_hash, payout_log_index, paid_at)
values ('00000000-0000-4000-8000-0000000b3b88', 1, 'crypto', 84532, 'USDC', 1, '1 USDC', current_setting('t.m')::uuid,
  '0x' || lpad('b3b20', 40, '0'), 1, 'paid', tests.hash(88), 0, now());

select set_config('t.p1', tests.pg3_prize(current_setting('t.g1')::uuid, 1)::text, true);
select set_config('t.p2', tests.pg3_prize(current_setting('t.g1')::uuid, 2)::text, true);
select set_config('t.p3', tests.pg3_prize(current_setting('t.g1')::uuid, 3)::text, true);
select set_config('t.q1', tests.pg3_prize(current_setting('t.g2')::uuid, 1)::text, true);
select set_config('t.q3', tests.pg3_prize(current_setting('t.g2')::uuid, 3)::text, true);

set local role service_role;
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, current_setting('t.p1'),
  jsonb_build_object('txHash', tests.hash(171), 'logIndex', 0, 'blockNumber', '123'), current_setting('t.other')),
  'P0001', 'forbidden', 'a payout recorded by someone other than the host is forbidden');
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, current_setting('t.p1'),
  jsonb_build_object('txHash', 'nope', 'logIndex', 0, 'blockNumber', '123'), current_setting('t.host')),
  'P0001', 'invalid_input', 'a malformed payout is invalid_input');
select is(public.record_public_giveaway_payout(current_setting('t.p1')::uuid,
  jsonb_build_object('txHash', '0x' || upper(substr(tests.hash(171), 3)), 'logIndex', 0, 'blockNumber', '123'), current_setting('t.host')::uuid),
  'paid', 'the host records the payout');
select is(public.record_public_giveaway_payout(current_setting('t.p1')::uuid,
  jsonb_build_object('txHash', tests.hash(171), 'logIndex', 0, 'blockNumber', '123'), current_setting('t.host')::uuid),
  'already', 'the same payout again is already');
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, current_setting('t.p2'),
  jsonb_build_object('txHash', tests.hash(2), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.host')),
  'P0001', 'invalid_state', 'a custom prize cannot be paid on-chain');
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, current_setting('t.q3'),
  jsonb_build_object('txHash', tests.hash(3), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.host')),
  'P0001', 'invalid_state', 'an unawarded prize cannot be paid');
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, current_setting('t.p3'),
  jsonb_build_object('txHash', tests.hash(171), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.host')),
  'P0001', 'tx_already_used', 'a hash already used by another public prize is tx_already_used');
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, current_setting('t.q1'),
  jsonb_build_object('txHash', tests.hash(77), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.host')),
  'P0001', 'tx_already_used', 'a hash behind an onchain transfer is tx_already_used');
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, current_setting('t.q1'),
  jsonb_build_object('txHash', tests.hash(88), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.host')),
  'P0001', 'tx_already_used', 'a hash behind a paid club prize is tx_already_used');
reset role;
select is((select status || '|' || payout_tx_hash || '|' || payout_log_index || '|' || (paid_at is not null)
           from public.public_giveaway_prizes where id = current_setting('t.p1')::uuid),
  'paid|' || tests.hash(171) || '|0|true', 'the paid prize keeps the lower-cased hash and the log index');

-- ===== 6. deliveries =====
select tests.authenticate_as(current_setting('t.other')::uuid);
select throws_ok(format($$select public.mark_public_prize_delivered(%L)$$, current_setting('t.p2')), 'P0001', 'forbidden',
  'someone other than the host cannot mark a prize delivered');
select tests.authenticate_as(current_setting('t.host')::uuid);
select lives_ok(format($$select public.mark_public_prize_delivered(%L)$$, current_setting('t.p2')),
  'the host marks the custom prize delivered');
select throws_ok(format($$select public.mark_public_prize_delivered(%L)$$, current_setting('t.p3')), 'P0001', 'invalid_state',
  'a crypto prize is not marked delivered');
select tests.clear_authentication();
select is((select status || '|' || (delivered_at is not null) from public.public_giveaway_prizes
           where id = current_setting('t.p2')::uuid), 'delivered|true', 'the custom prize is delivered');

select * from finish();
rollback;
