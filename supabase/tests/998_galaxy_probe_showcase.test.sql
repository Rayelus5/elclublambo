-- Galaxy Survivor, plan «banda sonora, skins, perfil y entorno», part D (migration *_galaxy_probe_showcase): three slots
-- at most, a probe once, reached by the API only, gone with the account.
begin;
select plan(5);

select has_table('galaxy', 'probe_showcase', 'probe_showcase');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'probe_showcase')
      and has_table_privilege('galaxy_api', 'galaxy.probe_showcase', 'select, insert, update, delete')
      and not has_table_privilege('anon', 'galaxy.probe_showcase', 'select'),
  'row level security on; only the API reaches it');

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009f4', 'pgtap_showcase', 'x');
insert into galaxy.probe_showcase (account_id, slot, probe) values ('00000000-0000-4000-8000-0000000009f4', 0, 'lumen');
select throws_ok($$insert into galaxy.probe_showcase (account_id, slot, probe) values ('00000000-0000-4000-8000-0000000009f4', 3, 'spark')$$, '23514', null, 'three slots at most');
select throws_ok($$insert into galaxy.probe_showcase (account_id, slot, probe) values ('00000000-0000-4000-8000-0000000009f4', 1, 'lumen')$$, '23505', null, 'a probe once');
delete from galaxy.accounts where id = '00000000-0000-4000-8000-0000000009f4';
select is((select count(*)::int from galaxy.probe_showcase where account_id = '00000000-0000-4000-8000-0000000009f4'), 0, 'gone with the account');

select * from finish();
rollback;
