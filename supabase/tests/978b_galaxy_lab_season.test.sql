-- Galaxy Survivor, shop and lab plan F2a (migration *_galaxy_lab_season): the seasonal core's levels, by season.
begin;
select plan(8);

select has_table('galaxy', 'lab_season_nodes', 'lab_season_nodes');
select col_is_pk('galaxy', 'lab_season_nodes', array['account_id', 'season', 'node'], 'one row per account, season and node');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'lab_season_nodes'),
  'row level security on lab_season_nodes');
select ok(has_table_privilege('galaxy_api', 'galaxy.lab_season_nodes', 'select, insert, update, delete'),
  'galaxy_api reads, adds, updates and deletes seasonal nodes');
select ok(not has_table_privilege('anon', 'galaxy.lab_season_nodes', 'select')
      and not has_table_privilege('authenticated', 'galaxy.lab_season_nodes', 'select')
      and not has_table_privilege('service_role', 'galaxy.lab_season_nodes', 'select'),
  'only galaxy_api reaches the seasonal lab');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f5', 'pgtap_lab_season', 'x');

select lives_ok($$insert into galaxy.lab_season_nodes (account_id, season, node, level)
                  values ('00000000-0000-4000-8000-0000000000f5', 'season-2', 'swarm', 2),
                         ('00000000-0000-4000-8000-0000000000f5', 'season-3', 'swarm', 1)$$,
  'the same node in two seasons');
select throws_ok($$insert into galaxy.lab_season_nodes (account_id, season, node, level)
                   values ('00000000-0000-4000-8000-0000000000f5', 'season-2', 'reap', 0)$$,
  '23514', null, 'a bought node has at least level 1');
select throws_ok($$insert into galaxy.lab_season_nodes (account_id, season, node, level)
                   values ('00000000-0000-4000-8000-0000000000f5', 'Season 2', 'reap', 1)$$,
  '23514', null, 'a season id is lowercase letters, digits and dashes');

select * from finish();
rollback;
