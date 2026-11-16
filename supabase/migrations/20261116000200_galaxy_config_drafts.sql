-- Galaxy Survivor: config drafts on the server (the content editor, 2026-11-16, P2).
--
-- A change to the run content (and to the sectors and probes keys a new sector or probe needs) is kept as a draft any
-- admin can resume, try in a test run and publish (with a reason and the admin's password, through the same append-only
-- galaxy.game_config_versions). A draft holds only the top-level fields it changes, per key (`data`), and the version of
-- each key it was made on (`base_versions`); `revision` grows with every save, so two tabs never overwrite each other.
-- Published and discarded drafts are deleted after 30 days by the server's hourly retention (apps/server/src/retention.ts).

create table galaxy.config_drafts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4194304),
  base_versions jsonb not null default '{}' check (jsonb_typeof(base_versions) = 'object'),
  revision int not null default 0 check (revision >= 0),
  status text not null default 'open' check (status in ('open', 'published', 'discarded')),
  published_versions jsonb check (published_versions is null or jsonb_typeof(published_versions) = 'object'),
  created_by uuid references galaxy.accounts (id) on delete set null,
  updated_by uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'open') = (closed_at is null))
);

create index config_drafts_open_idx on galaxy.config_drafts (updated_at desc) where status = 'open';
create index config_drafts_closed_idx on galaxy.config_drafts (closed_at) where status <> 'open';

alter table galaxy.config_drafts enable row level security;
create policy galaxy_api_all on galaxy.config_drafts for all to galaxy_api using (true) with check (true);

revoke all on galaxy.config_drafts from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.config_drafts to galaxy_api;
