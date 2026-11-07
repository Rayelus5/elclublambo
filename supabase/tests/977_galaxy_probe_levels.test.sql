-- Galaxy Survivor M4b-1 Task 3 (migration *_galaxy_probe_levels): each account's probe levels and chosen starting
-- weapon, and the upgrades snapshotted at the start of every run.
begin;
select plan(11);

select has_table('galaxy', 'probe_levels', 'probe_levels');
select col_is_pk('galaxy', 'probe_levels', array['account_id', 'probe'], 'one row per account and probe');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'probe_levels'),
  'row level security on probe_levels');
select ok(has_table_privilege('galaxy_api', 'galaxy.probe_levels', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.probe_levels', 'delete'),
  'galaxy_api reads, adds and updates levels, and never deletes them');
select ok(not has_table_privilege('anon', 'galaxy.probe_levels', 'select')
      and not has_table_privilege('authenticated', 'galaxy.probe_levels', 'select')
      and not has_table_privilege('service_role', 'galaxy.probe_levels', 'select'),
  'only galaxy_api reaches the probe levels');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f3', 'pgtap_levels', 'x');

select lives_ok($$insert into galaxy.probe_levels (account_id, probe, level, variant)
                  values ('00000000-0000-4000-8000-0000000000f3', 'lumen', 4, 'pulse-twin')$$,
  'a probe at level 4 with its variant');
select throws_ok($$insert into galaxy.probe_levels (account_id, probe, level)
                   values ('00000000-0000-4000-8000-0000000000f3', 'nova', 0)$$,
  '23514', null, 'a level is at least 1');
select throws_ok($$insert into galaxy.probe_levels (account_id, probe, level)
                   values ('00000000-0000-4000-8000-0000000000f3', 'nova', 21)$$,
  '23514', null, 'a level is at most 20');
select throws_ok($$insert into galaxy.probe_levels (account_id, probe, level, variant)
                   values ('00000000-0000-4000-8000-0000000000f3', 'spark', 2, 'Not An Id')$$,
  '23514', null, 'a variant is a content id');

select has_column('galaxy', 'runs', 'upgrades', 'runs keep their upgrades snapshot');
select col_default_is('galaxy', 'runs', 'upgrades', '{}'::jsonb, 'an empty snapshot by default');

select * from finish();
rollback;
