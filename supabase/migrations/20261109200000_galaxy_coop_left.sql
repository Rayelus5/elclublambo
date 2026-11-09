-- Galaxy Survivor, multiplayer plan phase 6c: a wait for whoever leaves group runs often. When a player leaves a
-- group run on purpose (says so, or leaves its room while it plays), their row of that run keeps when; the rooms count
-- those of the last while (coop.abandonWindowMinutes) against coop.abandonLimit before letting them play in a group.
alter table galaxy.runs add column left_at timestamptz;
create index runs_left_at on galaxy.runs (account_id, left_at) where left_at is not null;
