-- F2c Task 5: private support tickets (author + staff with MANAGE_TICKETS in the ticket's channel), with realtime.
-- Tickets live in their own tables, apart from messages. Writes only through RPCs.
-- Ticket notices carry ticket_id and actor_id but NO channel_id, so channel visibility never hides a ticket from
-- its author; access is decided by _can_access_ticket / _member_can_access_ticket.

-- ===== tables =====
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.members (id),
  subject text not null check (char_length(subject) between 3 and 120),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references public.members (id),
  closed_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index tickets_author_status_idx on public.tickets (author_id, status);
create index tickets_channel_status_idx on public.tickets (channel_id, status, last_message_at desc);
create index tickets_closed_by_idx on public.tickets (closed_by) where closed_by is not null;

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid not null references public.members (id),
  body_text text not null check (char_length(btrim(body_text)) between 1 and 4000),
  allow_links boolean not null default false,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_created_idx on public.ticket_messages (ticket_id, created_at);
create index ticket_messages_author_idx on public.ticket_messages (author_id);

alter table public.notifications
  add constraint notifications_ticket_id_fkey foreign key (ticket_id) references public.tickets (id) on delete cascade;
create index notifications_ticket_idx on public.notifications (ticket_id) where ticket_id is not null;

alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
revoke all on public.tickets, public.ticket_messages from anon;
revoke insert, update, delete, truncate on public.tickets, public.ticket_messages from authenticated;

-- ===== access helpers =====

-- Definer-only (no grant): used by fan-out, the unread count and push. The author needs to be active (no VIEW of
-- the channel required); staff need MANAGE_TICKETS in the ticket's channel (channel_permissions is 0 without VIEW).
create function public._member_can_access_ticket(p_member uuid, p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    join public.members m on m.id = p_member and m.status = 'active'
    where t.id = p_ticket
      and (t.author_id = p_member or (public.channel_permissions(p_member, t.channel_id) & 16384) = 16384)
  )
$$;

create function public._can_access_ticket(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public._member_can_access_ticket(public.current_member_id(), p_ticket), false)
$$;

-- ===== RLS =====
create policy tickets_select on public.tickets
  for select to authenticated
  using ((author_id = public.current_member_id() and public.is_active_member()) or public.can(channel_id, 16384));

create policy ticket_messages_select on public.ticket_messages
  for select to authenticated
  using (ticket_id in (select t.id from public.tickets t));

-- Notifications: the ticket filter is the same in the policy, the unread count and mark-as-read.
drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    recipient_id = public.current_member_id()
    and (channel_id is null or channel_id in (select v.id from public.visible_channels() v))
    and (ticket_id is null or public._can_access_ticket(ticket_id))
  );

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
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
    and (n.channel_id is null or n.channel_id in (select v.id from public.visible_channels() v))
    and (n.ticket_id is null or public._member_can_access_ticket(v_me, n.ticket_id))
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.my_unread_notification_count()
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
    and (n.ticket_id is null or public._member_can_access_ticket(n.recipient_id, n.ticket_id))
$$;

-- ===== RPCs =====

-- Check order: forbidden (no access / wrong channel kind / tickets disabled / no VIEW+SEND, one indistinguishable
-- error) -> invalid_input -> too_many_open_tickets. At most 3 open tickets per author, serialized per author.
create function public.open_ticket(p_channel uuid, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_perms bigint;
  v_subject text := btrim(p_subject);
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() or p_channel is null then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from public.channels c where c.id = p_channel and c.kind = 'text' and c.tickets_enabled
  ) then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_me, p_channel);
  if (v_perms & 1) = 0 or (v_perms & 2) = 0 then
    raise exception 'forbidden';
  end if;
  if v_subject is null or char_length(v_subject) not between 3 and 120
     or v_body is null or char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ticket_open:' || v_me::text, 0));
  if (select count(*) from public.tickets t where t.author_id = v_me and t.status = 'open') >= 3 then
    raise exception 'too_many_open_tickets';
  end if;

  insert into public.tickets (channel_id, author_id, subject) values (p_channel, v_me, v_subject)
  returning id into v_id;
  insert into public.ticket_messages (ticket_id, author_id, body_text, allow_links)
  values (v_id, v_me, v_body, (v_perms & 2048) = 2048);

  insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
  select s.id, 'ticket_new', v_me, v_id
  from public.members s
  where s.status = 'active'
    and s.id <> v_me
    and (public.channel_permissions(s.id, p_channel) & 16384) = 16384;

  return v_id;
end;
$$;

create function public.post_ticket_message(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  t public.tickets;
  v_body text := btrim(p_body);
  v_id uuid;
  v_links boolean;
  v_now timestamptz := clock_timestamp();
begin
  if v_me is null or not public.is_active_member() or p_ticket is null then
    raise exception 'forbidden';
  end if;
  select * into t from public.tickets x where x.id = p_ticket for update;
  if not found or not public._member_can_access_ticket(v_me, t.id) then
    raise exception 'forbidden';
  end if;
  if t.status = 'closed' then
    raise exception 'ticket_closed';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_input';
  end if;

  v_links := (public.channel_permissions(v_me, t.channel_id) & 2048) = 2048;
  insert into public.ticket_messages (ticket_id, author_id, body_text, allow_links, created_at)
  values (t.id, v_me, v_body, v_links, v_now)
  returning id into v_id;
  update public.tickets set last_message_at = v_now where id = t.id;

  if v_me = t.author_id then
    -- staff who already replied; if nobody has, every staff member of the channel
    if exists (select 1 from public.ticket_messages tm where tm.ticket_id = t.id and tm.author_id <> t.author_id) then
      insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
      select s.id, 'ticket_reply', v_me, t.id
      from public.members s
      where s.status = 'active'
        and s.id <> v_me
        and s.id in (select tm.author_id from public.ticket_messages tm where tm.ticket_id = t.id and tm.author_id <> t.author_id)
        and (public.channel_permissions(s.id, t.channel_id) & 16384) = 16384;
    else
      insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
      select s.id, 'ticket_reply', v_me, t.id
      from public.members s
      where s.status = 'active'
        and s.id <> v_me
        and (public.channel_permissions(s.id, t.channel_id) & 16384) = 16384;
    end if;
  else
    insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
    select a.id, 'ticket_reply', v_me, t.id
    from public.members a
    where a.id = t.author_id and a.status = 'active';
  end if;

  return v_id;
end;
$$;

-- The author (without MANAGE_TICKETS) can only close; staff close and reopen. Same status: no-op, no notice.
create function public.set_ticket_status(p_ticket uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  t public.tickets;
  v_staff boolean;
begin
  if v_me is null or not public.is_active_member() or p_ticket is null then
    raise exception 'forbidden';
  end if;
  select * into t from public.tickets x where x.id = p_ticket for update;
  if not found or not public._member_can_access_ticket(v_me, t.id) then
    raise exception 'forbidden';
  end if;
  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'invalid_input';
  end if;
  v_staff := (public.channel_permissions(v_me, t.channel_id) & 16384) = 16384;
  if p_status = 'open' and not v_staff then
    raise exception 'forbidden';
  end if;
  if t.status = p_status then
    return;
  end if;

  if p_status = 'closed' then
    update public.tickets set status = 'closed', closed_by = v_me, closed_at = now() where id = t.id;
  else
    update public.tickets set status = 'open', closed_by = null, closed_at = null where id = t.id;
  end if;

  if v_me <> t.author_id then
    insert into public.notifications (recipient_id, kind, actor_id, ticket_id, data)
    select a.id, 'ticket_status', v_me, t.id, jsonb_build_object('status', p_status)
    from public.members a
    where a.id = t.author_id and a.status = 'active';
  else
    insert into public.notifications (recipient_id, kind, actor_id, ticket_id, data)
    select s.id, 'ticket_status', v_me, t.id, jsonb_build_object('status', p_status)
    from public.members s
    where s.status = 'active'
      and s.id <> v_me
      and s.id in (select tm.author_id from public.ticket_messages tm where tm.ticket_id = t.id and tm.author_id <> t.author_id)
      and (public.channel_permissions(s.id, t.channel_id) & 16384) = 16384;
  end if;
end;
$$;

-- ===== realtime =====
create function public.broadcast_ticket_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'ticket_id', new.ticket_id),
    'ticket_message_created',
    'ticket:' || new.ticket_id::text,
    true
  );
  return null;
end;
$$;

create function public.broadcast_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'ticket_id', new.id),
    'ticket_updated',
    'ticket:' || new.id::text,
    true
  );
  return null;
end;
$$;

create trigger ticket_messages_broadcast_insert after insert on public.ticket_messages
  for each row execute function public.broadcast_ticket_message_event();
create trigger tickets_broadcast_update after update on public.tickets
  for each row execute function public.broadcast_ticket_event();

-- Receive authorization evaluated at join time. CASE guards the uuid cast (ruling F2b-R3). No INSERT policy.
create policy "realtime_receive_ticket_topics"
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when realtime.topic() ~ '^ticket:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public._can_access_ticket(substring(realtime.topic() from 8)::uuid)
      else false
    end
  );

-- ===== Task 4 review fixes: reports =====
-- The queue is scoped per channel: visible AND MANAGE_MESSAGES in that very channel.
drop policy reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (channel_id in (select v.id from public.visible_channels() v where public.can(v.id, 8)));

-- resolve_report: the update is also bound to the target report's channel.
create or replace function public.resolve_report(p_report uuid, p_status text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  r public.reports;
  v_n int;
begin
  if v_me is null or not public.is_active_member() or p_report is null then
    raise exception 'forbidden';
  end if;
  select * into r from public.reports x where x.id = p_report;
  if not found or not public.can(r.channel_id, 8) then
    raise exception 'forbidden';
  end if;
  if p_status is null or p_status not in ('dismissed', 'actioned') then
    raise exception 'invalid_input';
  end if;

  update public.reports x
  set status = p_status, resolved_by = v_me, resolved_at = now()
  where x.status = 'open'
    and x.channel_id = r.channel_id
    and case when r.message_id is null then x.id = r.id else x.message_id = r.message_id end;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (v_me, 'report_resolved', 'report', r.id,
            jsonb_build_object('status', p_status, 'count', v_n, 'message_id', r.message_id));
  end if;
  return v_n;
end;
$$;

-- ===== grants =====
revoke execute on function
  public._member_can_access_ticket(uuid, uuid),
  public._can_access_ticket(uuid),
  public.broadcast_ticket_message_event(),
  public.broadcast_ticket_event(),
  public.open_ticket(uuid, text, text),
  public.post_ticket_message(uuid, text),
  public.set_ticket_status(uuid, text),
  public.mark_notifications_read(bigint[]),
  public.my_unread_notification_count(),
  public.resolve_report(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public._can_access_ticket(uuid),
  public.open_ticket(uuid, text, text),
  public.post_ticket_message(uuid, text),
  public.set_ticket_status(uuid, text),
  public.mark_notifications_read(bigint[]),
  public.my_unread_notification_count(),
  public.resolve_report(uuid, text)
to authenticated;
