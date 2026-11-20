-- Galaxy Survivor M5c-2 Task 2 (migration *_galaxy_trades), trades 2.0 (20261114150000_galaxy_trades_v2): swaps
-- between two accounts, each side giving galaxies (`trade_items`) and, one side at most, coins. A galaxy is held only
-- when its owner offers it, by one open trade at most; whatever closes an open trade frees its galaxies and gives its
-- held coins back. A done trade had both confirmations. The history is append-only.
begin;
select plan(27);

select has_table('galaxy', 'trades', 'trades');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'trades'), 'row level security on trades');
select ok(has_table_privilege('galaxy_api', 'galaxy.trades', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.trades', 'delete')
      and not has_table_privilege('anon', 'galaxy.trades', 'select'),
  'galaxy_api proposes, changes and closes trades; nothing is deleted and nobody else reaches them');
select has_column('galaxy', 'trade_alerts', 'trade_id', 'an alert can point at a trade');
select has_table('galaxy', 'trade_items', 'what each side gives');
select has_table('galaxy', 'trade_events', 'the history of each trade');
select ok(has_table_privilege('galaxy_api', 'galaxy.trade_items', 'select, insert, update, delete')
      and not has_table_privilege('anon', 'galaxy.trade_items', 'select'),
  'a side''s items are replaced when it changes; nobody else reaches them');
select ok(has_table_privilege('galaxy_api', 'galaxy.trade_events', 'select, insert')
      and not has_table_privilege('galaxy_api', 'galaxy.trade_events', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.trade_events', 'delete'),
  'the history is append-only');
select hasnt_column('galaxy', 'trades', 'a_galaxy', 'the one-galaxy columns are gone');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000001a1', 'pgtap_trade_a', 'x'),
  ('00000000-0000-4000-8000-0000000001b1', 'pgtap_trade_b', 'x'),
  ('00000000-0000-4000-8000-0000000001c1', 'pgtap_trade_c', 'x');
insert into galaxy.galaxies (id, owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin) values
  ('00000000-0000-4000-8000-00000000b0a1', '00000000-0000-4000-8000-0000000001a1', 11, '1.0.0', '{}', repeat('a', 64), 'De A', 'GX-ABCDE1', 0, 1, 'normal', 'pull'),
  ('00000000-0000-4000-8000-00000000b0b1', '00000000-0000-4000-8000-0000000001b1', 12, '1.0.0', '{}', repeat('b', 64), 'De B', 'GX-ABCDE2', 1, 1, 'normal', 'pull');

select throws_ok($$insert into galaxy.trades (a_id, b_id, a_offered, expires_at)
                   values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a1', true, now() + interval '3 days')$$,
  '23514', null, 'no trade with oneself');
select lives_ok($$insert into galaxy.trades (id, a_id, b_id, a_offered, expires_at)
                  values ('00000000-0000-4000-8000-0000000071a1', '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001b1', true, now() + interval '3 days')$$,
  'A proposes to B');
select lives_ok($$insert into galaxy.trade_items (trade_id, side, galaxy_id, held) values
                  ('00000000-0000-4000-8000-0000000071a1', 'a', '00000000-0000-4000-8000-00000000b0a1', true),
                  ('00000000-0000-4000-8000-0000000071a1', 'b', '00000000-0000-4000-8000-00000000b0b1', false)$$,
  'A offers its galaxy (held) and asks for one of B''s (not held)');
select lives_ok($$insert into galaxy.trades (id, a_id, b_id, expires_at)
                  values ('00000000-0000-4000-8000-0000000071c1', '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001c1', now() + interval '3 days')$$,
  'A proposes to C too');
select throws_ok($$insert into galaxy.trade_items (trade_id, side, galaxy_id, held)
                   values ('00000000-0000-4000-8000-0000000071c1', 'a', '00000000-0000-4000-8000-00000000b0a1', true)$$,
  '23505', null, 'an offered galaxy is held by one open trade at most');
select lives_ok($$insert into galaxy.trades (id, a_id, b_id, expires_at)
                  values ('00000000-0000-4000-8000-0000000071d1', '00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-0000000001b1', now() + interval '3 days')$$,
  'C proposes to B');
select lives_ok($$insert into galaxy.trade_items (trade_id, side, galaxy_id, held)
                  values ('00000000-0000-4000-8000-0000000071d1', 'b', '00000000-0000-4000-8000-00000000b0b1', false)$$,
  'a galaxy only asked for (not offered by its owner) is not held: someone else may ask for it too');
select throws_ok($$update galaxy.trades set a_coins = 10, b_coins = 10 where id = '00000000-0000-4000-8000-0000000071a1'$$,
  '23514', null, 'the coins go one way');
select throws_ok($$update galaxy.trades set b_confirmed = true where id = '00000000-0000-4000-8000-0000000071a1'$$,
  '23514', null, 'a side confirms only what it offers');
select throws_ok($$update galaxy.trades set status = 'done', closed_at = now() where id = '00000000-0000-4000-8000-0000000071a1'$$,
  '23514', null, 'a swap needs both confirmations');

-- Closing it (however) frees its galaxies and gives its held coins back.
insert into galaxy.coin_holds (id, account_id, amount, kind)
  values ('00000000-0000-4000-8000-0000000074a1', '00000000-0000-4000-8000-0000000001a1', 100, 'trade');
update galaxy.trades set a_coins = 100, a_hold = '00000000-0000-4000-8000-0000000074a1' where id = '00000000-0000-4000-8000-0000000071a1';
select lives_ok($$update galaxy.trades set status = 'cancelled', closed_at = now() where id = '00000000-0000-4000-8000-0000000071a1'$$,
  'an open trade is cancelled');
select ok((select not held from galaxy.trade_items
            where trade_id = '00000000-0000-4000-8000-0000000071a1' and galaxy_id = '00000000-0000-4000-8000-00000000b0a1'),
  'closing it frees its galaxies');
select is((select status from galaxy.coin_holds where id = '00000000-0000-4000-8000-0000000074a1'), 'released', 'and releases its coins');
select is((select amount from galaxy.balances where account_id = '00000000-0000-4000-8000-0000000001a1' and currency = 'coins'), 100::bigint,
  'back in the balance');
select is((select reason from galaxy.ledger where account_id = '00000000-0000-4000-8000-0000000001a1' order by id desc limit 1), 'trade_release',
  'with its ledger line');
select lives_ok($$insert into galaxy.trade_items (trade_id, side, galaxy_id, held)
                  values ('00000000-0000-4000-8000-0000000071c1', 'a', '00000000-0000-4000-8000-00000000b0a1', true)$$,
  'once that trade closed, the galaxy can be offered again');

select throws_ok($$insert into galaxy.trades (a_id, b_id, expires_at)
                   values ('00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-0000000001a1', now() + interval '3 days')$$,
  '23505', null, 'one open trade per pair of accounts, whoever proposed it');
select throws_ok($$insert into galaxy.trade_events (trade_id, version, actor_id, kind)
                   values ('00000000-0000-4000-8000-0000000071c1', 1, '00000000-0000-4000-8000-0000000001a1', 'countered')$$,
  '23514', null, 'a counter-offer keeps its deal');

select * from finish();
rollback;
