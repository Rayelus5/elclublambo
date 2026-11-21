-- Galaxy Survivor: closing a season on its own (plan «temporadas como fichas», PR 2, 2026-11-21).
--   season_archive.stats      what the season was, frozen at its close (players, runs, kills, Cores, extractions, the
--                             deepest layer, the sector and probe played most, how many reached each tier), written in
--                             the same insert as the archive row (the table takes no updates).
--   accounts.prize_eligible   whether the account can win prizes for its place (season podium, tournaments). On by
--                             default; an admin turns it off from the player's page (admins who play). Off, the account
--                             still ranks, with a mark, and the place's prize goes to the next one who can win it.
--   mailbox_messages.type     two kinds of the game's own messages: `season` (a season ended: your place, collect your
--                             prizes in Temporada) and `tournament` (the same for a tournament).

alter table galaxy.season_archive add column stats jsonb check (stats is null or jsonb_typeof(stats) = 'object');

alter table galaxy.accounts add column prize_eligible boolean not null default true;

alter table galaxy.mailbox_messages drop constraint mailbox_messages_type_check;
alter table galaxy.mailbox_messages add constraint mailbox_messages_type_check
  check (type in ('announcement', 'gift', 'compensation', 'event', 'reward', 'personal', 'referral', 'shop', 'system', 'season', 'tournament'));
