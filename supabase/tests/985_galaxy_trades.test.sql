-- Galaxy Survivor M5c-2 Task 2 (migration *_galaxy_trades): swaps of one galaxy for one galaxy between two accounts.
-- A galaxy is held only when its owner offers it (the proposer's from the start; the other's once its owner agrees),
-- and an offered galaxy is in one open trade at most. A done trade had both galaxies and both confirmations.
begin;
select plan(12);

select has_table('galaxy', 'trades', 'trades');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'trades'), 'row level security on trades');
select ok(has_table_privilege('galaxy_api', 'galaxy.trades', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.trades', 'delete')
      and not has_table_privilege('anon', 'galaxy.trades', 'select'),
  'galaxy_api proposes, changes and closes trades; nothing is deleted and nobody else reaches them');
select has_column('galaxy', 'trade_alerts', 'trade_id', 'an alert can point at a trade');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000001a1', 'pgtap_trade_a', 'x'),
  ('00000000-0000-4000-8000-0000000001b1', 'pgtap_trade_b', 'x'),
  ('00000000-0000-4000-8000-0000000001c1', 'pgtap_trade_c', 'x');
insert into galaxy.galaxies (id, owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin) values
  ('00000000-0000-4000-8000-00000000b0a1', '00000000-0000-4000-8000-0000000001a1', 11, '1.0.0', '{}', repeat('a', 64), 'De A', 'GX-ABCDE1', 0, 1, 'normal', 'pull'),
  ('00000000-0000-4000-8000-00000000b0b1', '00000000-0000-4000-8000-0000000001b1', 12, '1.0.0', '{}', repeat('b', 64), 'De B', 'GX-ABCDE2', 1, 1, 'normal', 'pull');

select throws_ok($$insert into galaxy.trades (a_id, b_id, a_galaxy, a_offered, a_confirmed, expires_at)
                   values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000b0a1', true, false, now() + interval '3 days')$$,
  '23514', null, 'no trade with oneself');
select lives_ok($$insert into galaxy.trades (a_id, b_id, a_galaxy, a_offered, b_galaxy, a_confirmed, expires_at)
                  values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-00000000b0a1', true,
                          '00000000-0000-4000-8000-00000000b0b1', true, now() + interval '3 days')$$,
  'A offers its galaxy and asks for one of B''s');
select throws_ok($$insert into galaxy.trades (a_id, b_id, a_galaxy, a_offered, expires_at)
                   values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-00000000b0a1', true, now() + interval '3 days')$$,
  '23505', null, 'an offered galaxy is in one open trade at most');
select lives_ok($$insert into galaxy.trades (a_id, b_id, a_galaxy, a_offered, b_galaxy, expires_at)
                  values ('00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-0000000001b1', null, false, '00000000-0000-4000-8000-00000000b0b1', now() + interval '3 days')$$,
  'a galaxy only asked for (not offered by its owner) is not held: someone else may ask for it too');
select throws_ok($$insert into galaxy.trades (a_id, b_id, a_galaxy, a_offered, a_confirmed, expires_at)
                   values ('00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-0000000001a1', null, false, true, now() + interval '3 days')$$,
  '23514', null, 'a side confirms only what it offers');
select throws_ok($$update galaxy.trades set status = 'done', closed_at = now()
                   where a_id = '00000000-0000-4000-8000-0000000001a1' and b_id = '00000000-0000-4000-8000-0000000001b1'$$,
  '23514', null, 'a swap needs both confirmations');
select lives_ok($$update galaxy.trades set b_offered = true, b_confirmed = true, status = 'done', closed_at = now()
                  where a_id = '00000000-0000-4000-8000-0000000001a1' and b_id = '00000000-0000-4000-8000-0000000001b1'$$,
  'both offered and confirmed: done');
select lives_ok($$insert into galaxy.trades (a_id, b_id, a_galaxy, a_offered, expires_at)
                  values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-00000000b0a1', true, now() + interval '3 days')$$,
  'once that trade closed, the galaxy can be offered again');

select * from finish();
rollback;
