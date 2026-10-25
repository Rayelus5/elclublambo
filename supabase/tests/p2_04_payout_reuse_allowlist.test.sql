-- P2 final review (migration 20261025100004):
--   - record_giveaway_payout (P1): a (chain, hash, log) behind a paid public giveaway prize is tx_already_used; another
--     hash still pays the club prize.
--   - create_public_giveaway: a raw allowlist of more than 4000 entries is invalid_input before normalising; 4000
--     duplicates of one address still create the giveaway.
begin;
select plan(5);

create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;

-- ===== fixtures (as postgres) =====
-- a treasurer (SuperAdmin) for the club payout
select set_config('t.t', tests.create_member('0x' || lpad('b4b00', 40, '0'), null, true)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'SuperAdmin';
-- a club giveaway, drawn, with an awarded USDC prize
insert into public.giveaways (id, title, closes_at, status, seed_commit, seed_reveal, target_round, drand_signature,
  drand_randomness, entry_count, drawn_at, created_by)
values ('00000000-0000-4000-8000-0000000b4b01', 'Club', now() - interval '1 day', 'drawn', tests.hash(1), tests.hash(2), 1000,
  repeat('a', 96), repeat('f', 64), 1, now(), current_setting('t.t')::uuid);
insert into public.giveaway_prizes (id, giveaway_id, rank, kind, chain_id, token, amount, label, winner_member_id, winner_address,
  winner_position, status)
values ('00000000-0000-4000-8000-0000000b4b02', '00000000-0000-4000-8000-0000000b4b01', 1, 'crypto', 84532, 'USDC', 1, '1 USDC',
  current_setting('t.t')::uuid, '0x' || lpad('b4b00', 40, '0'), 1, 'awarded');
-- a public giveaway whose USDC prize was paid with hash 401, log 0
select set_config('t.host', tests.create_wallet_user('0x' || lpad('b4b10', 40, '0'))::text, true);
insert into public.public_giveaways (id, host_user_id, host_address, title, closes_at, status, seed_commit, seed_reveal,
  target_round, drand_signature, drand_randomness, entry_count, drawn_at)
values ('00000000-0000-4000-8000-0000000b4b11', current_setting('t.host')::uuid, '0x' || lpad('b4b10', 40, '0'), 'Público',
  now() - interval '1 day', 'drawn', tests.hash(3), tests.hash(4), 1000, repeat('a', 96), repeat('f', 64), 1, now());
insert into public.public_giveaway_prizes (giveaway_id, rank, kind, chain_id, token, amount, label, winner_user_id,
  winner_address, winner_position, status, payout_tx_hash, payout_log_index, paid_at)
values ('00000000-0000-4000-8000-0000000b4b11', 1, 'crypto', 84532, 'USDC', 1, '1 USDC', current_setting('t.host')::uuid,
  '0x' || lpad('b4b10', 40, '0'), 1, 'paid', tests.hash(401), 0, now());

-- ===== 1. record_giveaway_payout: a public prize's payout cannot back a club prize =====
set local role service_role;
select throws_ok(format($$select public.record_giveaway_payout(%L, %L, %L)$$, '00000000-0000-4000-8000-0000000b4b02',
  jsonb_build_object('txHash', tests.hash(401), 'logIndex', 0, 'blockNumber', '123'), current_setting('t.t')),
  'P0001', 'tx_already_used', 'a hash behind a paid public giveaway prize is tx_already_used for a club prize');
select is(public.record_giveaway_payout('00000000-0000-4000-8000-0000000b4b02'::uuid,
  jsonb_build_object('txHash', tests.hash(401), 'logIndex', 1, 'blockNumber', '123'), current_setting('t.t')::uuid) ->> 'status',
  'paid', 'the same hash with another log index still pays the club prize');
reset role;

-- ===== 2. create_public_giveaway: the raw allowlist bound =====
select tests.authenticate_as(current_setting('t.host')::uuid);
select throws_ok(format($$select public.create_public_giveaway('Lista', null, now() + interval '1 hour', null, 0, %L, %L)$$,
  (select array_agg('0x' || lpad(to_hex(i), 40, '0')) from generate_series(1, 4001) i),
  '[{"kind":"custom","label":"Premio"}]'),
  'P0001', 'invalid_input', 'a raw allowlist of 4001 entries is invalid_input');
select lives_ok(format($$select public.create_public_giveaway('Lista', null, now() + interval '1 hour', null, 0, %L, %L)$$,
  (select array_agg('0x' || lpad('b4b20', 40, '0')) from generate_series(1, 4000) i),
  '[{"kind":"custom","label":"Premio"}]'),
  '4000 duplicates of one address are within the raw bound');
select tests.clear_authentication();
select is((select count(*)::int from public.public_giveaway_allowlist a join public.public_giveaways g on g.id = a.giveaway_id
           where g.host_user_id = current_setting('t.host')::uuid and g.title = 'Lista'), 1, 'the duplicates are deduped');

select * from finish();
rollback;
