-- Galaxy Survivor M3b-2 Task 4 (migration *_galaxy_probes): the probe test (GDD §6), taken once per account and kept as
-- it was answered: its answers and the probe it gave.
begin;
select plan(10);

select has_table('galaxy', 'probe_tests', 'probe_tests');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'probe_tests'),
  'row level security on probe_tests');
select ok(has_table_privilege('galaxy_api', 'galaxy.probe_tests', 'select')
      and has_table_privilege('galaxy_api', 'galaxy.probe_tests', 'insert')
      and not has_table_privilege('galaxy_api', 'galaxy.probe_tests', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.probe_tests', 'delete'),
  'galaxy_api only reads and adds tests');
select ok(not has_table_privilege('anon', 'galaxy.probe_tests', 'select')
      and not has_table_privilege('authenticated', 'galaxy.probe_tests', 'select'),
  'only galaxy_api reaches the tests');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000e1', 'pgtap_probes', 'x');

select lives_ok($$insert into galaxy.probe_tests (account_id, answers, probe)
                  values ('00000000-0000-4000-8000-0000000000e1', '{0,1,2,0,1}', 'bastion')$$,
  'a test with five answers is kept');
select throws_ok($$insert into galaxy.probe_tests (account_id, answers, probe)
                   values ('00000000-0000-4000-8000-0000000000e1', '{0,0,0,0,0}', 'lumen')$$,
  '23505', null, 'one test per account');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000e2', 'pgtap_probes2', 'x');
select throws_ok($$insert into galaxy.probe_tests (account_id, answers, probe)
                   values ('00000000-0000-4000-8000-0000000000e2', '{0,1,2,0,3}', 'lumen')$$,
  '23514', null, 'answers are 0, 1 or 2');
select throws_ok($$insert into galaxy.probe_tests (account_id, answers, probe)
                   values ('00000000-0000-4000-8000-0000000000e2', '{0,1,2,0}', 'lumen')$$,
  '23514', null, 'five or six answers');
select throws_ok($$update galaxy.probe_tests set probe = 'spark' where account_id = '00000000-0000-4000-8000-0000000000e1'$$,
  'P0001', null, 'a test is never rewritten');
select throws_ok($$delete from galaxy.probe_tests where account_id = '00000000-0000-4000-8000-0000000000e1'$$,
  'P0001', null, 'a test is never deleted');

select * from finish();
rollback;
