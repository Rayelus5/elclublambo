-- Galaxy Survivor M5a (GDD §12.1, §14.1): the account level. Each account keeps the experience its runs gave (the
-- server adds it when a run that is not suspicious finishes; missions add theirs with M7). The runs already finished
-- are counted now with the default formula of the live config `account.xp`: 10 per whole minute, 15 per layer, 40 per
-- Core and 30 for extracting. The season leaderboard reads finished runs that are not suspicious by date.

create function galaxy.run_xp(seconds integer, depth integer, boss_kills integer, outcome text) returns bigint
  language sql immutable
  set search_path = ''
  as $$
    select (greatest(seconds, 0) / 60) * 10::bigint + greatest(depth, 0) * 15 + greatest(boss_kills, 0) * 40
      + case when outcome = 'extracted' then 30 else 0 end
  $$;
revoke all on function galaxy.run_xp(integer, integer, integer, text) from public, anon, authenticated, service_role;

create table galaxy.account_xp (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  updated_at timestamptz not null default now()
);

insert into galaxy.account_xp (account_id, xp)
select account_id, sum(galaxy.run_xp(seconds, depth, boss_kills, outcome))
from galaxy.runs
where finished_at is not null and not suspicious
group by account_id;

create index runs_season on galaxy.runs (finished_at) where finished_at is not null and not suspicious;

alter table galaxy.account_xp enable row level security;
create policy galaxy_api_all on galaxy.account_xp for all to galaxy_api using (true) with check (true);
revoke all on galaxy.account_xp from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.account_xp to galaxy_api;
