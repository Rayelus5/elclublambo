-- Galaxy Survivor: seasons as records (plan «temporadas como fichas», 2026-11-21). A season stops being the single live
-- config key `season` (plus `seasonRoute`, `missions.season` and `lab.season`) and becomes a row: past, current and
-- upcoming seasons live side by side, so an admin prepares and schedules the next one ahead and it starts on its own.
--   seasons            one row per season: its dates, rules (points, tiers, anomaly…), route and shop, season missions
--                      and seasonal lab tree. `state`: draft (being prepared, invisible), scheduled (counts by its
--                      dates: open while starts_at <= now < ends_at) or closed (archived; history). Scheduled and closed
--                      seasons never overlap (the exclusion is deferred to the commit, so one transaction can extend a
--                      season and push the next one's start).
--   season_revisions   every saved state of a season with who and why: append-only, like the config versions.

create table galaxy.seasons (
  id text primary key check (id ~ '^[a-z0-9-]{1,32}$'),
  name text not null check (char_length(name) between 1 and 40),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  state text not null default 'draft' check (state in ('draft', 'scheduled', 'closed')),
  rules jsonb not null,
  route jsonb not null,
  missions jsonb not null default '[]'::jsonb,
  lab jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version >= 1),
  announced_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references galaxy.accounts (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references galaxy.accounts (id) on delete set null,
  scheduled_at timestamptz,
  scheduled_by uuid references galaxy.accounts (id) on delete set null,
  check (ends_at > starts_at),
  constraint seasons_no_overlap exclude using gist (tstzrange(starts_at, ends_at) with &&)
    where (state <> 'draft') deferrable initially deferred
);
create index seasons_starts on galaxy.seasons (starts_at);

create table galaxy.season_revisions (
  season text not null references galaxy.seasons (id) on delete cascade,
  version integer not null check (version >= 1),
  data jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references galaxy.accounts (id) on delete set null,
  note text not null,
  primary key (season, version)
);

create function galaxy.forbid_season_revision_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A draft that is deleted takes its revisions with it (the cascade); nothing else changes or removes one.
  if tg_op = 'DELETE' and not exists (select 1 from galaxy.seasons s where s.id = old.season) then
    return old;
  end if;
  raise exception 'season_revisions_append_only';
end;
$$;
revoke all on function galaxy.forbid_season_revision_change() from public, anon, authenticated, service_role;
create trigger season_revisions_append_only
  before update or delete on galaxy.season_revisions
  for each row execute function galaxy.forbid_season_revision_change();
create trigger season_revisions_no_truncate
  before truncate on galaxy.season_revisions
  for each statement execute function galaxy.forbid_season_revision_change();

-- A scheduled or closed season is history: only a draft is ever deleted (its revisions go with it).
create function galaxy.forbid_season_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state <> 'draft' then
    raise exception 'seasons_keep_history';
  end if;
  return old;
end;
$$;
revoke all on function galaxy.forbid_season_delete() from public, anon, authenticated, service_role;
create trigger seasons_keep_history
  before delete on galaxy.seasons
  for each row execute function galaxy.forbid_season_delete();

alter table galaxy.seasons enable row level security;
alter table galaxy.season_revisions enable row level security;
create policy galaxy_api_all on galaxy.seasons for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.season_revisions for all to galaxy_api using (true) with check (true);
revoke all on galaxy.seasons, galaxy.season_revisions from public, anon, authenticated, service_role;
-- Only drafts are ever deleted (the service refuses the rest); a scheduled or closed season stays as history.
grant select, insert, update, delete on galaxy.seasons to galaxy_api;
grant select, insert, delete on galaxy.season_revisions to galaxy_api;
