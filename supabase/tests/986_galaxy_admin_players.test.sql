-- Galaxy Survivor M6a Task 2 (migration *_galaxy_leaderboard_excluded): an admin can leave an account out of the
-- season leaderboard (GDD §16.2) without touching its runs.
begin;
select plan(3);

select has_column('galaxy', 'accounts', 'leaderboard_excluded', 'accounts can be left out of the leaderboard');
select col_not_null('galaxy', 'accounts', 'leaderboard_excluded', 'never unknown');
select col_default_is('galaxy', 'accounts', 'leaderboard_excluded', 'false', 'everyone is in by default');

select * from finish();
rollback;
