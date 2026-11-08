-- Galaxy Survivor M5b-1 Task 2 (migration *_galaxy_clans): clans, their members (one clan per account, one leader per
-- clan) and the requests to join closed ones.
begin;
select plan(18);

select has_table('galaxy', 'clans', 'clans');
select has_table('galaxy', 'clan_members', 'clan_members');
select has_table('galaxy', 'clan_requests', 'clan_requests');
select col_is_pk('galaxy', 'clan_members', 'account_id', 'an account is in one clan at most');
select col_is_pk('galaxy', 'clan_requests', array['clan_id', 'account_id'], 'one request per account and clan');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('clans', 'clan_members', 'clan_requests')),
  'row level security on the three tables');
select ok(has_table_privilege('galaxy_api', 'galaxy.clans', 'select, insert, update, delete')
      and has_table_privilege('galaxy_api', 'galaxy.clan_members', 'select, insert, update, delete')
      and has_table_privilege('galaxy_api', 'galaxy.clan_requests', 'select, insert, delete')
      and not has_table_privilege('anon', 'galaxy.clans', 'select')
      and not has_table_privilege('authenticated', 'galaxy.clan_members', 'select'),
  'only galaxy_api reaches the clans');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000c1', 'pgtap_clan_a', 'x'),
  ('00000000-0000-4000-8000-0000000000c2', 'pgtap_clan_b', 'x');
insert into galaxy.clans (id, name, tag, description, emblem, color, open) values
  ('00000000-0000-4000-8000-00000000c1a0', 'Pgtap Clan', 'PGT', '', 'comet', 'uv', true);

select throws_ok($$insert into galaxy.clans (name, tag, description, emblem, color, open) values ('PGTAP CLAN', 'PGX', '', 'star', 'nova', true)$$,
  '23505', null, 'names are unique whatever the case');
select throws_ok($$insert into galaxy.clans (name, tag, description, emblem, color, open) values ('Otro Clan', 'PGT', '', 'star', 'nova', true)$$,
  '23505', null, 'tags are unique');
select throws_ok($$insert into galaxy.clans (name, tag, description, emblem, color, open) values ('Otro Clan', 'pg', '', 'star', 'nova', true)$$,
  '23514', null, 'a tag is in capitals');
select lives_ok($$insert into galaxy.clan_members (account_id, clan_id, role) values
                  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000c1a0', 'leader')$$,
  'a leader');
select throws_ok($$insert into galaxy.clan_members (account_id, clan_id, role) values
                   ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000c1a0', 'leader')$$,
  '23505', null, 'one leader per clan');
select throws_ok($$insert into galaxy.clan_members (account_id, clan_id, role) values
                   ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000c1a0', 'boss')$$,
  '23514', null, 'roles are leader, officer or member');
insert into galaxy.clan_requests (clan_id, account_id) values ('00000000-0000-4000-8000-00000000c1a0', '00000000-0000-4000-8000-0000000000c2');
delete from galaxy.clans where id = '00000000-0000-4000-8000-00000000c1a0';
select is((select count(*)::int from galaxy.clan_members where clan_id = '00000000-0000-4000-8000-00000000c1a0'), 0, 'members go with their clan');
select is((select count(*)::int from galaxy.clan_requests where clan_id = '00000000-0000-4000-8000-00000000c1a0'), 0, 'requests go with their clan');

-- A kicked account waits before coming back (M5b-1 review).
select has_table('galaxy', 'clan_kicks', 'clan_kicks');
select col_is_pk('galaxy', 'clan_kicks', array['clan_id', 'account_id'], 'one cooldown per account and clan');
select ok(has_table_privilege('galaxy_api', 'galaxy.clan_kicks', 'select, insert, update')
      and not has_table_privilege('anon', 'galaxy.clan_kicks', 'select'),
  'only galaxy_api reaches the kicks');

select * from finish();
rollback;
