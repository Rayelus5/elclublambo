-- Galaxy Survivor M4b-2 Task 2 (migration *_galaxy_lab): the Laboratorio's node levels of each account.
begin;
select plan(8);

select has_table('galaxy', 'lab_nodes', 'lab_nodes');
select col_is_pk('galaxy', 'lab_nodes', array['account_id', 'node'], 'one row per account and node');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'lab_nodes'),
  'row level security on lab_nodes');
select ok(has_table_privilege('galaxy_api', 'galaxy.lab_nodes', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.lab_nodes', 'delete'),
  'galaxy_api reads, adds and updates nodes, and never deletes them');
select ok(not has_table_privilege('anon', 'galaxy.lab_nodes', 'select')
      and not has_table_privilege('authenticated', 'galaxy.lab_nodes', 'select')
      and not has_table_privilege('service_role', 'galaxy.lab_nodes', 'select'),
  'only galaxy_api reaches the lab');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f4', 'pgtap_lab', 'x');

select lives_ok($$insert into galaxy.lab_nodes (account_id, node, level)
                  values ('00000000-0000-4000-8000-0000000000f4', 'hull', 3)$$,
  'a node at level 3');
select throws_ok($$insert into galaxy.lab_nodes (account_id, node, level)
                   values ('00000000-0000-4000-8000-0000000000f4', 'silos', 0)$$,
  '23514', null, 'a bought node has at least level 1');
select throws_ok($$insert into galaxy.lab_nodes (account_id, node, level)
                   values ('00000000-0000-4000-8000-0000000000f4', 'study', 11)$$,
  '23514', null, 'a node has at most level 10');

select * from finish();
rollback;
