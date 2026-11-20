-- Galaxy Survivor, plan «ajustes en la cuenta» (migration *_galaxy_settings): one row of settings per account, reached
-- by the API only, and gone with the account.
begin;
select plan(4);

select has_table('galaxy', 'settings', 'settings');
select col_is_pk('galaxy', 'settings', array['account_id'], 'one row per account');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'settings')
      and has_table_privilege('galaxy_api', 'galaxy.settings', 'select, insert, update, delete')
      and not has_table_privilege('anon', 'galaxy.settings', 'select')
      and not has_table_privilege('authenticated', 'galaxy.settings', 'select'),
  'row level security on; only the API reaches it');

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009f2', 'pgtap_settings', 'x');
insert into galaxy.settings (account_id, data) values ('00000000-0000-4000-8000-0000000009f2', '{"v": 1, "muted": true}');
delete from galaxy.accounts where id = '00000000-0000-4000-8000-0000000009f2';
select is((select count(*)::int from galaxy.settings where account_id = '00000000-0000-4000-8000-0000000009f2'), 0, 'gone with the account');

select * from finish();
rollback;
