-- Galaxy Survivor, multiplayer plan phase 7: reports of a player by a teammate of a group run (idle, playing against
-- the group, cheating, abuse or other, with an optional note). One per reporter, reported player and run; a moderator
-- reviews each one (dismissed or actioned, with a note), and the audit log keeps who and why.
create table galaxy.player_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references galaxy.accounts (id) on delete cascade,
  reported_id uuid not null references galaxy.accounts (id) on delete cascade,
  coop_run_id uuid not null references galaxy.coop_runs (id) on delete cascade,
  reason text not null check (reason in ('idle', 'griefing', 'cheating', 'abuse', 'other')),
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references galaxy.accounts (id) on delete set null,
  outcome text check (outcome in ('dismissed', 'actioned')),
  review_note text check (length(review_note) <= 300),
  unique (reporter_id, reported_id, coop_run_id),
  check (reporter_id <> reported_id)
);
create index player_reports_pending on galaxy.player_reports (created_at) where reviewed_at is null;
create index player_reports_reporter on galaxy.player_reports (reporter_id, created_at);

alter table galaxy.player_reports enable row level security;
create policy galaxy_api_all on galaxy.player_reports for all to galaxy_api using (true) with check (true);
revoke all on galaxy.player_reports from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.player_reports to galaxy_api;
