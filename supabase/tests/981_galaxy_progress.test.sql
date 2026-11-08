-- Galaxy Survivor M5a Task 2 (migration *_galaxy_progress): the account experience kept per account, filled from the
-- runs already finished with the default formula, and the index the season leaderboard reads.
begin;
select plan(14);

select has_table('galaxy', 'account_xp', 'account_xp');
select col_is_pk('galaxy', 'account_xp', 'account_id', 'one row per account');
select has_index('galaxy', 'runs', 'runs_season', 'the season leaderboard has its index');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'account_xp'),
  'row level security on account_xp');
select ok(has_table_privilege('galaxy_api', 'galaxy.account_xp', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.account_xp', 'delete'),
  'galaxy_api reads, adds and updates experience, and never deletes it');
select ok(not has_table_privilege('anon', 'galaxy.account_xp', 'select')
      and not has_table_privilege('authenticated', 'galaxy.account_xp', 'select')
      and not has_table_privilege('service_role', 'galaxy.account_xp', 'select'),
  'only galaxy_api reaches the experience');

-- The default formula: 10 per whole minute, 15 per layer, 40 per Core and 30 for extracting.
select is(galaxy.run_xp(600, 2, 1, 'extracted'), 200::bigint, 'ten minutes, two layers, a Core and the extraction');
select is(galaxy.run_xp(600, 2, 1, 'abandoned'), 170::bigint, 'abandoning keeps everything but the extraction');
select is(galaxy.run_xp(119, 1, 0, 'died'), 25::bigint, 'only whole minutes count');
-- A run counts from a minute, and never gives more than 30 per minute it lasted (M5a review).
select is(galaxy.run_xp(59, 1, 1, 'extracted'), 0::bigint, 'less than a minute gives nothing');
select is(galaxy.run_xp(60, 1, 1, 'extracted'), 30::bigint, 'one minute gives 30 at most, whatever it claims');
select ok(not has_function_privilege('anon', 'galaxy.run_xp(integer, integer, integer, text)', 'execute'),
  'the formula is not exposed');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f7', 'pgtap_xp', 'x');
select lives_ok($$insert into galaxy.account_xp (account_id, xp) values ('00000000-0000-4000-8000-0000000000f7', 120)$$,
  'an account with experience');
select throws_ok($$update galaxy.account_xp set xp = -1 where account_id = '00000000-0000-4000-8000-0000000000f7'$$,
  '23514', null, 'experience never goes below zero');

select * from finish();
rollback;
