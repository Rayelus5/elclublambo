-- Galaxy Survivor M6a (GDD §16.2): an admin can leave an account out of the season leaderboard (and the clans tab)
-- without touching its runs.
alter table galaxy.accounts add column leaderboard_excluded boolean not null default false;
