-- Galaxy Survivor M5b-2 (GDD §14.4): the chats. Messages go to the global channel or to a clan's ('clan:<id>'); a
-- moderator or enough reports hide one (it is never deleted, so moderation keeps its record); each account reports a
-- message once; a mute keeps an account from writing until a date. The body's length here is a backstop: the live
-- config `chat.maxLength` (280 by default) is what the server enforces.

create table galaxy.chat_messages (
  id bigint generated always as identity primary key,
  channel text not null check (channel = 'global' or channel ~ '^clan:[0-9a-f-]{36}$'),
  author_id uuid not null references galaxy.accounts (id) on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references galaxy.accounts (id) on delete set null,
  hidden_reason text check (hidden_reason in ('moderator', 'reports')),
  check ((hidden_at is null) = (hidden_reason is null))
);
create index chat_messages_channel on galaxy.chat_messages (channel, id desc) where hidden_at is null;
create index chat_messages_author_time on galaxy.chat_messages (author_id, created_at desc);

create table galaxy.chat_reports (
  message_id bigint not null references galaxy.chat_messages (id) on delete cascade,
  reporter_id uuid not null references galaxy.accounts (id) on delete cascade,
  reason text check (length(reason) <= 140),
  created_at timestamptz not null default now(),
  primary key (message_id, reporter_id)
);

create table galaxy.chat_mutes (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  until timestamptz not null,
  reason text not null check (length(reason) between 1 and 140),
  by_id uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table galaxy.chat_messages enable row level security;
alter table galaxy.chat_reports enable row level security;
alter table galaxy.chat_mutes enable row level security;
create policy galaxy_api_all on galaxy.chat_messages for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.chat_reports for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.chat_mutes for all to galaxy_api using (true) with check (true);
revoke all on galaxy.chat_messages, galaxy.chat_reports, galaxy.chat_mutes from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.chat_messages to galaxy_api;
grant select, insert on galaxy.chat_reports to galaxy_api;
grant select, insert, update on galaxy.chat_mutes to galaxy_api;
