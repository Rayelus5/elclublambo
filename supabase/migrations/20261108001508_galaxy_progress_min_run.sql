-- Galaxy Survivor M5a (final review): a run counts for account experience from a minute (`account.minRunSeconds`, like
-- probe unlocks and relic slot milestones) and never gives more than 30 per minute it lasted (`account.xp.capPerMinute`),
-- so starting and dying, or a forged short run, earns nothing more than a real one. The formula follows the defaults,
-- and every account's experience is counted again with it (no other source adds experience yet).

create or replace function galaxy.run_xp(seconds integer, depth integer, boss_kills integer, outcome text) returns bigint
  language sql immutable
  set search_path = ''
  as $$
    select case when seconds is null or seconds < 60 then 0::bigint else least(
      (seconds / 60) * 10::bigint + greatest(depth, 0) * 15 + greatest(boss_kills, 0) * 40
        + case when outcome = 'extracted' then 30 else 0 end,
      (seconds * 30::bigint) / 60
    ) end
  $$;
revoke all on function galaxy.run_xp(integer, integer, integer, text) from public, anon, authenticated, service_role;

update galaxy.account_xp x
set xp = coalesce((
      select sum(galaxy.run_xp(r.seconds, r.depth, r.boss_kills, r.outcome))
      from galaxy.runs r
      where r.account_id = x.account_id and r.finished_at is not null and not r.suspicious
    ), 0),
    updated_at = now();
