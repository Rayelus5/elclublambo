-- F2b: message schema. Reads are scoped to channels the member can view; writes only via RPCs (later tasks).

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  thread_root_id uuid references public.messages (id) on delete cascade,
  author_id uuid not null references public.members (id),
  body jsonb not null,
  body_text text not null,
  expanded boolean not null default false,
  allow_links boolean not null,
  kind text not null default 'text' check (kind in ('text', 'alpha')),
  quoted_message_id uuid references public.messages (id) on delete set null,
  reply_count integer not null default 0,
  last_reply_at timestamptz,
  pinned_at timestamptz,
  pinned_by uuid references public.members (id),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.members (id),
  created_at timestamptz not null default now(),
  constraint messages_body_text_len check (char_length(body_text) <= 20000)
);

create index messages_channel_created_idx on public.messages (channel_id, created_at desc, id);
create index messages_thread_idx on public.messages (thread_root_id, created_at);
create index messages_author_idx on public.messages (channel_id, author_id, created_at desc);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  storage_path text not null unique,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  width integer,
  height integer
);
create index message_attachments_message_idx on public.message_attachments (message_id);

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  emoji text not null check (octet_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, member_id, emoji)
);

create table public.message_mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  kind text not null check (kind in ('member', 'role', 'everyone')),
  target_id uuid,
  notify boolean not null default false,
  constraint message_mentions_target check ((kind = 'everyone') = (target_id is null))
);
create index message_mentions_message_idx on public.message_mentions (message_id);

create table public.alpha_details (
  message_id uuid primary key references public.messages (id) on delete cascade,
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null default 59144 check (chain_id = 59144)
);

create table public.channel_reads (
  member_id uuid not null references public.members (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (member_id, channel_id)
);

alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_mentions enable row level security;
alter table public.alpha_details enable row level security;
alter table public.channel_reads enable row level security;

-- visible_channels() is evaluated once per query (InitPlan); children join through messages' own RLS.
create policy messages_select on public.messages for select to authenticated
  using (channel_id in (select v.id from public.visible_channels() v));

create policy message_attachments_select on public.message_attachments for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
create policy message_reactions_select on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
create policy message_mentions_select on public.message_mentions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
create policy alpha_details_select on public.alpha_details for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

create policy channel_reads_select on public.channel_reads for select to authenticated
  using (member_id = public.current_member_id());

revoke all on public.messages, public.message_attachments, public.message_reactions,
  public.message_mentions, public.alpha_details, public.channel_reads from anon;
revoke insert, update, delete, truncate on public.messages, public.message_attachments,
  public.message_reactions, public.message_mentions, public.alpha_details,
  public.channel_reads from authenticated;
