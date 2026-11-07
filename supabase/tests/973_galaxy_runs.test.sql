-- Galaxy Survivor M3a Task 10 (migration *_galaxy_runs): the hangar (relic slots, equipped galaxies), runs (started
-- with a server seed, finished once), their recorded inputs and the daily run time behind the daily yield (GDD §11.3 bis).
begin;
select plan(21);

select has_table('galaxy', 'hangars', 'hangars');
select has_table('galaxy', 'loadouts', 'loadouts');
select has_table('galaxy', 'runs', 'runs');
select has_table('galaxy', 'run_inputs', 'run_inputs');
select has_table('galaxy', 'run_days', 'run_days');

select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('hangars', 'loadouts', 'runs', 'run_inputs', 'run_days')),
  'row level security on every new table');

select ok(has_table_privilege('galaxy_api', 'galaxy.loadouts', 'select')
      and has_table_privilege('galaxy_api', 'galaxy.loadouts', 'insert')
      and has_table_privilege('galaxy_api', 'galaxy.loadouts', 'delete')
      and has_table_privilege('galaxy_api', 'galaxy.hangars', 'update'),
  'galaxy_api manages the hangar and its loadout');
select ok(has_table_privilege('galaxy_api', 'galaxy.runs', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.runs', 'delete')
      and has_table_privilege('galaxy_api', 'galaxy.run_inputs', 'insert')
      and not has_table_privilege('galaxy_api', 'galaxy.run_inputs', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.run_inputs', 'delete'),
  'runs are finished, never deleted; recorded inputs are only added');
select ok(not has_table_privilege('anon', 'galaxy.runs', 'select')
      and not has_table_privilege('authenticated', 'galaxy.loadouts', 'select')
      and not has_table_privilege('anon', 'galaxy.run_days', 'select'),
  'only galaxy_api reaches the runs');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f1', 'pgtap_runs', 'x');
insert into galaxy.galaxies (id, owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin)
values ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f1', 1, '1.0.0', '{}',
        repeat('a', 64), 'X', 'GX-AAAAAA', 0, 1, 'normal', 'pull');

select lives_ok($$insert into galaxy.hangars (account_id) values ('00000000-0000-4000-8000-0000000000f1')$$,
  'a hangar starts with defaults');
select is((select relic_slots from galaxy.hangars where account_id = '00000000-0000-4000-8000-0000000000f1'), 2::smallint,
  'two relic slots to begin with');
select throws_ok($$update galaxy.hangars set relic_slots = 7 where account_id = '00000000-0000-4000-8000-0000000000f1'$$,
  '23514', null, 'never more than 6 slots');

insert into galaxy.loadouts (account_id, slot, galaxy_id)
values ('00000000-0000-4000-8000-0000000000f1', 0, '00000000-0000-4000-8000-0000000000f2');
select throws_ok($$insert into galaxy.loadouts (account_id, slot, galaxy_id)
                   values ('00000000-0000-4000-8000-0000000000f1', 1, '00000000-0000-4000-8000-0000000000f2')$$,
  '23505', null, 'a galaxy sits in one slot at most');
select throws_ok($$insert into galaxy.loadouts (account_id, slot, galaxy_id)
                   values ('00000000-0000-4000-8000-0000000000f1', 6, '00000000-0000-4000-8000-0000000000f2')$$,
  '23514', null, 'slots are 0–5');

select lives_ok($$insert into galaxy.runs (id, account_id, seed, sector, probe, relics, content_version, sim_version, start_key)
                  values ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f1', 18446744073709551615,
                          'outer-nebula', 'lumen', '[]', 0, '1.0.0', 'k-0000001')$$,
  'a run starts with the server seed and the relic snapshot');
select throws_ok($$insert into galaxy.runs (account_id, seed, sector, probe, relics, content_version, sim_version, start_key, outcome)
                   values ('00000000-0000-4000-8000-0000000000f1', 1, 'outer-nebula', 'lumen', '[]', 0, '1.0.0', 'k-0000002', 'won')$$,
  '23514', null, 'outcome is extracted, died or abandoned');
select lives_ok($$update galaxy.runs set finished_at = now(), outcome = 'extracted', ticks = 600, depth = 1, kills = 10,
                    boss_kills = 0, level = 2, seconds = 10, hash = 'abcdef0123456789', payout = '{}'
                  where id = '00000000-0000-4000-8000-0000000000f3'$$,
  'a run is finished once');
select throws_ok($$update galaxy.runs set kills = 99999 where id = '00000000-0000-4000-8000-0000000000f3'$$,
  'P0001', 'run_finished', 'a finished run cannot be rewritten');
select throws_ok($$delete from galaxy.runs where id = '00000000-0000-4000-8000-0000000000f3'$$,
  'P0001', 'append_only', 'runs are never deleted');

insert into galaxy.run_inputs (run_id, inputs) values ('00000000-0000-4000-8000-0000000000f3', '\x0101');
select throws_ok($$delete from galaxy.run_inputs$$, 'P0001', 'append_only', 'recorded inputs are never deleted by hand');
select throws_ok($$insert into galaxy.run_days (account_id, day, seconds) values ('00000000-0000-4000-8000-0000000000f1', '2026-11-07', -1)$$,
  '23514', null, 'daily run time never goes below 0');

select * from finish();
rollback;
