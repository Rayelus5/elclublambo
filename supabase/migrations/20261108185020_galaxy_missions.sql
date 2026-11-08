-- Galaxy Survivor M7a (GDD §12.1, §12.3, §14.1): missions and achievements.
--   mission_progress      per account, period (d:<day>, w:<week>, s:<season>) and mission: what it has counted and when
--                         its reward was collected (once).
--   achievement_progress  per account and achievement: what it has counted (lifetime), when it was reached and when its
--                         reward was collected (once).
--   cosmetics             the titles and frames an account has earned; accounts.title / accounts.frame are the chosen ones.
--   season_adjustments.source  who added the points: an admin (M6d-4), a mission or an achievement.

create table galaxy.mission_progress (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  period text not null check (period ~ '^(d|w|s):[A-Za-z0-9-]{1,32}$'),
  mission text not null check (mission ~ '^[a-z0-9-]{1,32}$'),
  progress bigint not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (account_id, period, mission)
);

create table galaxy.achievement_progress (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  achievement text not null check (achievement ~ '^[a-z0-9-]{1,32}$'),
  progress bigint not null default 0 check (progress >= 0),
  unlocked_at timestamptz,
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (account_id, achievement)
);

create table galaxy.cosmetics (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  kind text not null check (kind in ('title', 'frame')),
  value text not null check (char_length(value) between 1 and 30),
  created_at timestamptz not null default now(),
  primary key (account_id, kind, value)
);

alter table galaxy.accounts add column title text check (title is null or char_length(title) between 1 and 30);
alter table galaxy.accounts add column frame text check (frame is null or frame ~ '^[a-z]{1,16}$');
alter table galaxy.season_adjustments add column source text not null default 'admin' check (source in ('admin', 'mission', 'achievement'));

alter table galaxy.mission_progress enable row level security;
alter table galaxy.achievement_progress enable row level security;
alter table galaxy.cosmetics enable row level security;
create policy galaxy_api_all on galaxy.mission_progress for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.achievement_progress for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.cosmetics for all to galaxy_api using (true) with check (true);
revoke all on galaxy.mission_progress, galaxy.achievement_progress, galaxy.cosmetics from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.mission_progress, galaxy.achievement_progress to galaxy_api;
grant select, insert, delete on galaxy.cosmetics to galaxy_api;
