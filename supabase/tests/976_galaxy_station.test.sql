-- Galaxy Survivor M4a Task 2 (migration *_galaxy_station): the station's rooms, refinery and antenna, and the two new
-- currencies (raw material and components) in the wallet and the ledger.
begin;
select plan(11);

select has_table('galaxy', 'station_rooms', 'station_rooms');
select has_table('galaxy', 'refinery', 'refinery');
select has_table('galaxy', 'antenna', 'antenna');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('station_rooms', 'refinery', 'antenna')),
  'row level security on the station tables');
select ok(has_table_privilege('galaxy_api', 'galaxy.station_rooms', 'select, insert, update')
      and has_table_privilege('galaxy_api', 'galaxy.refinery', 'select, insert, update')
      and has_table_privilege('galaxy_api', 'galaxy.antenna', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.refinery', 'delete'),
  'galaxy_api reads, adds and updates the station, and never deletes it');
select ok(not has_table_privilege('anon', 'galaxy.refinery', 'select')
      and not has_table_privilege('authenticated', 'galaxy.station_rooms', 'select'),
  'only galaxy_api reaches the station');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f2', 'pgtap_station', 'x');

select lives_ok($$insert into galaxy.balances (account_id, currency, amount)
                  values ('00000000-0000-4000-8000-0000000000f2', 'components', 5),
                         ('00000000-0000-4000-8000-0000000000f2', 'material', 7)$$,
  'material and components are currencies');
select throws_ok($$insert into galaxy.balances (account_id, currency, amount)
                   values ('00000000-0000-4000-8000-0000000000f2', 'foo', 1)$$,
  '23514', null, 'unknown currencies are still refused');
select lives_ok($$insert into galaxy.ledger (account_id, currency, delta, balance_after, reason)
                  values ('00000000-0000-4000-8000-0000000000f2', 'components', 5, 5, 'test')$$,
  'the ledger records components');
select throws_ok($$insert into galaxy.refinery (account_id, queue, ready, clock)
                   values ('00000000-0000-4000-8000-0000000000f2', -1, 0, now())$$,
  '23514', null, 'a refinery queue is never negative');
select throws_ok($$insert into galaxy.station_rooms (account_id, room, level)
                   values ('00000000-0000-4000-8000-0000000000f2', 'antenna', -1)$$,
  '23514', null, 'a room level is never negative');

select * from finish();
rollback;
