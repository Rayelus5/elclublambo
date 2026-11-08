-- Galaxy Survivor M6d-1 (GDD §16.5): communication. The mailbox's messages (news for everyone or for a segment, with
-- gifts attached), one receipt per message and account (when it was read and when its gift was claimed: once), and
-- the notices of the title screen between two dates. A message is withdrawn, never edited or deleted; a notice is
-- ended early, never deleted.

create table galaxy.mailbox_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  body text not null check (length(body) between 1 and 2000),
  gifts jsonb not null default '{}'::jsonb check (jsonb_typeof(gifts) = 'object'),
  audience jsonb not null check (jsonb_typeof(audience) = 'object'),
  created_by uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  withdrawn_at timestamptz,
  check (expires_at > created_at)
);
create index mailbox_messages_live on galaxy.mailbox_messages (created_at desc) where withdrawn_at is null;

create table galaxy.mailbox_receipts (
  message_id uuid not null references galaxy.mailbox_messages (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  read_at timestamptz,
  claimed_at timestamptz,
  primary key (message_id, account_id),
  check (claimed_at is null or read_at is not null)
);

create table galaxy.title_notices (
  id uuid primary key default gen_random_uuid(),
  text text not null check (length(text) between 1 and 200),
  tone text not null check (tone in ('info', 'warning')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ends_at > starts_at)
);
create index title_notices_window on galaxy.title_notices (ends_at desc) where ended_at is null;

alter table galaxy.mailbox_messages enable row level security;
alter table galaxy.mailbox_receipts enable row level security;
alter table galaxy.title_notices enable row level security;
create policy galaxy_api_all on galaxy.mailbox_messages for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.mailbox_receipts for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.title_notices for all to galaxy_api using (true) with check (true);
revoke all on galaxy.mailbox_messages, galaxy.mailbox_receipts, galaxy.title_notices from public, anon, authenticated, service_role;
grant select, insert on galaxy.mailbox_messages, galaxy.mailbox_receipts, galaxy.title_notices to galaxy_api;
grant update (withdrawn_at) on galaxy.mailbox_messages to galaxy_api;
grant update (read_at, claimed_at) on galaxy.mailbox_receipts to galaxy_api;
grant update (ended_at) on galaxy.title_notices to galaxy_api;
