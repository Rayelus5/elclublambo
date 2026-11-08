-- Galaxy Survivor M6d-4 (migration *_galaxy_admin_progress, GDD §16.2): probes an admin unlocked for a player, and
-- season points an admin added or took away (rows that stay: corrections never rewrite history).
begin;
select plan(10);

select has_table('galaxy', 'probe_grants', 'probe_grants');
select has_table('galaxy', 'season_adjustments', 'season_adjustments');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('probe_grants', 'season_adjustments')),
  'row level security on both');
select ok(has_table_privilege('galaxy_api', 'galaxy.probe_grants', 'insert')
      and has_table_privilege('galaxy_api', 'galaxy.probe_grants', 'delete')
      and has_table_privilege('galaxy_api', 'galaxy.season_adjustments', 'insert')
      and not has_table_privilege('galaxy_api', 'galaxy.season_adjustments', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.season_adjustments', 'delete'),
  'grants come and go; adjustments are only added');
select ok(not has_table_privilege('anon', 'galaxy.probe_grants', 'select')
      and not has_table_privilege('authenticated', 'galaxy.season_adjustments', 'select'),
  'only galaxy_api reaches them');
select ok(has_table_privilege('galaxy_api', 'galaxy.lab_nodes', 'delete'), 'a Laboratorio node taken back to 0 is deleted');

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009e1', 'pgtap_progress', 'x');
select lives_ok($$insert into galaxy.probe_grants (account_id, probe) values ('00000000-0000-4000-8000-0000000009e1', 'vela')$$,
  'a probe is granted');
select throws_ok($$insert into galaxy.season_adjustments (account_id, season, points) values ('00000000-0000-4000-8000-0000000009e1', 's1', 0)$$,
  '23514', null, 'an adjustment of 0 points is not one');
insert into galaxy.season_adjustments (account_id, season, points) values ('00000000-0000-4000-8000-0000000009e1', 's1', -40);
select throws_ok($$update galaxy.season_adjustments set points = 1$$, 'P0001', 'append_only', 'adjustments are never rewritten');
select throws_ok($$delete from galaxy.season_adjustments$$, 'P0001', 'append_only', 'nor deleted');

select * from finish();
rollback;
