-- Galaxy Survivor (plan «notas de versión»): the release notes the admin writes or corrects from the panel. The notes
-- of the code (packages/shared notes/entries.ts) are the base; a row here with the same id replaces one of them (or
-- hides it), and a row with a new id adds a note. Content, not a player's data: a beta reset keeps it.

create table galaxy.release_notes (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  version text not null check (version ~ '^[0-9]{1,3}\.[0-9]{1,3}$'),
  date date not null,
  title text not null check (char_length(title) between 1 and 80),
  summary text not null default '' check (char_length(summary) <= 280),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  hidden boolean not null default false,
  updated_by uuid references galaxy.accounts (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table galaxy.release_notes enable row level security;
create policy galaxy_api_all on galaxy.release_notes for all to galaxy_api using (true) with check (true);
revoke all on galaxy.release_notes from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.release_notes to galaxy_api;
