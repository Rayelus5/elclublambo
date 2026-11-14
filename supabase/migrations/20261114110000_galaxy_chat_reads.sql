-- Galaxy Survivor (the owner's chat asks, 2026-11-14): what each player has read in each channel, and the mentions of
-- them. A channel's unread count is the visible messages after `last_read_id` by others (99 at most, by the channel's
-- own index); a player with no row starts at the channel's head. The mentions are kept by account id, so a rename never
-- loses them; one goes with its message (retention, a deleted account). Usernames are searched by prefix for the
-- mention box (`@ab…`).

create table galaxy.chat_reads (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  channel text not null check (channel = 'global' or channel ~ '^clan:[0-9a-f-]{36}$' or channel ~ '^room:[0-9a-f-]{36}$'),
  last_read_id bigint not null default 0 check (last_read_id >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, channel)
);

create table galaxy.chat_mentions (
  message_id bigint not null references galaxy.chat_messages (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  channel text not null,
  primary key (message_id, account_id)
);
create index chat_mentions_account on galaxy.chat_mentions (account_id, channel, message_id desc);

-- `username like 'ab%'` by the index (the unique one sorts by the database's collation).
create index accounts_username_prefix on galaxy.accounts (username text_pattern_ops);

alter table galaxy.chat_reads enable row level security;
alter table galaxy.chat_mentions enable row level security;
create policy galaxy_api_all on galaxy.chat_reads for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.chat_mentions for all to galaxy_api using (true) with check (true);
revoke all on galaxy.chat_reads, galaxy.chat_mentions from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.chat_reads to galaxy_api;
grant select, insert, delete on galaxy.chat_mentions to galaxy_api;
