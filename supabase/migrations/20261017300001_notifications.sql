-- F2c Task 1: notifications, channel follow preferences and web push subscriptions.
-- notifications hold ids and flags only: never user text. Reads go through RLS, which re-checks channel visibility.

-- ===== channel follow default =====
alter table public.channels
  add column default_follow text not null default 'mentions' check (default_follow in ('all', 'mentions'));

-- Anuncios (F2a seed, inside the top-level Comunidad category) notifies every root message by default.
update public.channels c
set default_follow = 'all'
where c.kind = 'text'
  and c.name = 'Anuncios'
  and c.parent_id = (
    select p.id from public.channels p where p.parent_id is null and p.kind = 'category' and p.name = 'Comunidad'
  );

-- ===== tables =====
create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.members (id) on delete cascade,
  kind text not null check (kind in (
    'mention', 'reply', 'channel_message',
    'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
    'report_new', 'member_review',
    'ticket_new', 'ticket_reply', 'ticket_status'
  )),
  actor_id uuid references public.members (id) on delete set null,
  channel_id uuid references public.channels (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  ticket_id uuid, -- FK added with the tickets table (Task 5)
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create unique index notifications_recipient_message_uidx on public.notifications (recipient_id, message_id)
  where message_id is not null;
create index notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;
create index notifications_actor_idx on public.notifications (actor_id) where actor_id is not null;
create index notifications_channel_idx on public.notifications (channel_id) where channel_id is not null;

create table public.channel_follow_prefs (
  member_id uuid not null references public.members (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  level text not null check (level in ('all', 'mentions', 'mute')),
  primary key (member_id, channel_id)
);
create index channel_follow_prefs_channel_idx on public.channel_follow_prefs (channel_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 2048),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz
);
create index push_subscriptions_member_idx on public.push_subscriptions (member_id, created_at);

alter table public.notifications enable row level security;
alter table public.channel_follow_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.notifications, public.channel_follow_prefs, public.push_subscriptions from anon;
revoke insert, update, delete, truncate on public.notifications, public.channel_follow_prefs, public.push_subscriptions
  from authenticated;

create policy notifications_select on public.notifications
  for select to authenticated
  using (
    recipient_id = public.current_member_id()
    and (channel_id is null or channel_id in (select v.id from public.visible_channels() v))
  );
create policy channel_follow_prefs_select on public.channel_follow_prefs
  for select to authenticated using (member_id = public.current_member_id());
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (member_id = public.current_member_id());

-- ===== follow helpers / RPCs =====

-- Effective follow level: the member's own pref, else the channel default. Definer-only helper.
create function public._follow_level(p_member uuid, p_channel uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select f.level from public.channel_follow_prefs f where f.member_id = p_member and f.channel_id = p_channel),
    (select c.default_follow from public.channels c where c.id = p_channel)
  )
$$;

create function public.my_channel_follow(p_channel uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or p_channel is null or not public.can_view(p_channel) then
    raise exception 'forbidden';
  end if;
  return public._follow_level(v_me, p_channel);
end;
$$;

create function public.set_channel_follow(p_channel uuid, p_level text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_kind text;
  v_default text;
begin
  if v_me is null or not public.is_active_member() or p_channel is null or not public.can_view(p_channel) then
    raise exception 'forbidden';
  end if;
  if p_level is null or p_level not in ('all', 'mentions', 'mute') then
    raise exception 'invalid_input';
  end if;
  select c.kind, c.default_follow into v_kind, v_default from public.channels c where c.id = p_channel;
  if v_kind is distinct from 'text' then
    raise exception 'invalid_input';
  end if;

  if p_level = v_default then
    delete from public.channel_follow_prefs where member_id = v_me and channel_id = p_channel;
  else
    insert into public.channel_follow_prefs (member_id, channel_id, level) values (v_me, p_channel, p_level)
    on conflict (member_id, channel_id) do update set level = excluded.level;
  end if;
end;
$$;

-- ===== reading =====

create function public.mark_notifications_read(p_ids bigint[] default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_n int;
begin
  if v_me is null then
    raise exception 'forbidden';
  end if;
  update public.notifications n
  set read_at = now()
  where n.recipient_id = v_me
    and n.read_at is null
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Same visibility filter as the RLS policy: a notification of a channel the member can no longer see is not counted.
create function public.my_unread_notification_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.notifications n
  where n.recipient_id = public.current_member_id()
    and n.read_at is null
    and (n.channel_id is null or n.channel_id in (select v.id from public.visible_channels() v))
$$;

-- ===== web push subscriptions =====

-- Anti-SSRF allowlist. https only, no userinfo, no port, host is an exact entry or a dot-boundary subdomain of a
-- wildcard entry. Pure helper (no table access).
create function public._valid_push_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_endpoint is not null
    and char_length(p_endpoint) <= 2048
    and p_endpoint ~* (
      '^https://('
      || 'fcm\.googleapis\.com'
      || '|updates\.push\.services\.mozilla\.com'
      || '|web\.push\.apple\.com'
      || '|([a-z0-9-]+\.)+notify\.windows\.com'
      || '|([a-z0-9-]+\.)+push\.apple\.com'
      || ')(/[A-Za-z0-9._~!$&''()*+,;=:@%/?-]*)?$'
    )
$$;

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if not public._valid_push_endpoint(p_endpoint)
     or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{60,100}$'
     or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{16,40}$' then
    raise exception 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push_sub:' || v_me::text, 0));

  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
  values (v_me, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, last_used_at = now();

  -- keep the 10 newest
  delete from public.push_subscriptions s
  where s.member_id = v_me
    and s.id not in (
      select k.id from public.push_subscriptions k where k.member_id = v_me
      order by k.created_at desc, k.id desc limit 10
    );
end;
$$;

create function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null then
    raise exception 'forbidden';
  end if;
  delete from public.push_subscriptions s where s.member_id = v_me and s.endpoint = p_endpoint;
end;
$$;

-- ===== realtime =====

create function public.broadcast_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id),
    'notification_created',
    'member:' || new.recipient_id::text,
    true
  );
  return null;
end;
$$;

create trigger notifications_broadcast_insert after insert on public.notifications
  for each row execute function public.broadcast_notification_event();

-- Only the owner joins member:<id>. CASE guards the uuid cast (ruling F2b-R3).
create policy "realtime_receive_member_topics"
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when realtime.topic() ~ '^member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then substring(realtime.topic() from 8)::uuid = public.current_member_id()
      else false
    end
  );

-- ===== grants =====
revoke execute on function
  public._follow_level(uuid, uuid),
  public._valid_push_endpoint(text),
  public.broadcast_notification_event(),
  public.my_channel_follow(uuid),
  public.set_channel_follow(uuid, text),
  public.mark_notifications_read(bigint[]),
  public.my_unread_notification_count(),
  public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.my_channel_follow(uuid),
  public.set_channel_follow(uuid, text),
  public.mark_notifications_read(bigint[]),
  public.my_unread_notification_count(),
  public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text)
to authenticated;
