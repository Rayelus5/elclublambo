-- Galaxy Survivor M7e-1 (GDD §13.2, §14.3): events.
--   mission_progress.period   also e:<event id>: an event's personal goals, and when each clan goal was collected.
--   clan_event_progress       what a clan's members have added to each of its event goals (only while they are members).

alter table galaxy.mission_progress drop constraint mission_progress_period_check;
alter table galaxy.mission_progress add constraint mission_progress_period_check check (period ~ '^(d|w|s|e):[A-Za-z0-9-]{1,32}$');

create table galaxy.clan_event_progress (
  clan_id uuid not null references galaxy.clans (id) on delete cascade,
  event text not null check (event ~ '^[a-z0-9-]{1,32}$'),
  goal text not null check (goal ~ '^[a-z0-9-]{1,32}$'),
  progress bigint not null default 0 check (progress >= 0),
  updated_at timestamptz not null default now(),
  primary key (clan_id, event, goal)
);

alter table galaxy.clan_event_progress enable row level security;
create policy galaxy_api_all on galaxy.clan_event_progress for all to galaxy_api using (true) with check (true);
revoke all on galaxy.clan_event_progress from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.clan_event_progress to galaxy_api;
