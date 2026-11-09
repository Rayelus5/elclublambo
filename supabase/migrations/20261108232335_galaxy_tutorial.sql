-- Galaxy Survivor (polish, phase 3; GDD §12.2): the guided tutorial. One row per account that has started it: the
-- chapter it has reached, when it was skipped or finished, and when its one gift (the components to repair the
-- antenna, given on reaching the station's chapter) was paid. Accounts that already played a run are marked done, so
-- only new players (and those who never played) are offered the tour.

create table galaxy.tutorial (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  chapter text not null default 'hub' check (chapter in ('hub', 'scanner', 'hangar', 'run', 'results', 'station', 'done')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  skipped_at timestamptz,
  done_at timestamptz,
  gift_at timestamptz
);

insert into galaxy.tutorial (account_id, chapter, done_at)
select distinct r.account_id, 'done', now() from galaxy.runs r where r.finished_at is not null
on conflict do nothing;

alter table galaxy.tutorial enable row level security;
create policy galaxy_api_all on galaxy.tutorial for all to galaxy_api using (true) with check (true);
revoke all on galaxy.tutorial from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.tutorial to galaxy_api;
