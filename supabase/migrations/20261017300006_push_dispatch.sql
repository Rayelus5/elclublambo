-- F2c Task 6: web push dispatch with send-time visibility checks, plus Task 5 review minors.
-- The dispatcher (Node, service_role) claims pending notifications through claim_push_notifications, which
-- re-validates every recipient at send time and builds a safe title/body/url. No message or ticket text is ever
-- copied: only a <= 80 char excerpt of a message the recipient still sees, never any ticket text.

-- ===== push: build one payload =====

-- Returns zero rows when the recipient may no longer receive the notice (inactive, lost VIEW of the channel, no
-- access to the ticket, lost the permission a moderation notice needs). Definer-only helper.
create function public._push_build(p_id bigint)
returns table (title text, body text, url text, tag text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  n public.notifications;
  v_perms bigint := 0;
  v_actor text;
  v_wallet text;
  v_channel text;
  v_subject text;
  v_phrase text;
  v_title text;
  v_url text;
  v_excerpt text;
  v_root text;
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.channel_id is not null then
    v_perms := public.channel_permissions(n.recipient_id, n.channel_id);
    if (v_perms & 1) = 0 then
      return;
    end if;
  end if;
  if n.ticket_id is not null and not public._member_can_access_ticket(n.recipient_id, n.ticket_id) then
    return;
  end if;
  if n.kind = 'report_new' and (v_perms & 8) = 0 then
    return;
  end if;
  if n.kind = 'member_review' and (public.member_global_permissions(n.recipient_id) & (32 | 512)) = 0 then
    return;
  end if;

  -- The actor's name always comes from members, never from user-controlled mention labels.
  select coalesce(nullif(btrim(regexp_replace(a.display_name, '[[:cntrl:]]+', ' ', 'g')), ''),
                  left(a.wallet_address, 6) || '…' || right(a.wallet_address, 4)),
         a.wallet_address
    into v_actor, v_wallet
  from public.members a where a.id = n.actor_id;
  v_actor := coalesce(v_actor, 'Alguien');

  if n.channel_id is not null then
    select btrim(regexp_replace(c.name, '[[:cntrl:]]+', ' ', 'g')) into v_channel
    from public.channels c where c.id = n.channel_id;
  end if;
  if n.ticket_id is not null then
    select btrim(regexp_replace(t.subject, '[[:cntrl:]]+', ' ', 'g')) into v_subject
    from public.tickets t where t.id = n.ticket_id;
  end if;

  v_url := '/notifications';
  if n.kind in ('mention', 'reply', 'channel_message') then
    v_url := '/c/' || n.channel_id::text;
    v_root := n.data ->> 'thread_root_id';
    if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_url := v_url || '?thread=' || v_root;
    end if;
    -- Excerpt only while the message exists and is not deleted (the recipient still sees the channel, checked above).
    select left(btrim(regexp_replace(m.body_text, '[[:space:][:cntrl:]]+', ' ', 'g')), 80) into v_excerpt
    from public.messages m where m.id = n.message_id and m.deleted_at is null;
    v_excerpt := nullif(v_excerpt, '');
  elsif n.kind in ('invite_redeemed', 'godchild_banned', 'sponsor_penalized') then
    if v_wallet is not null then
      v_url := '/u/' || v_wallet;
    end if;
  elsif n.kind = 'report_new' then
    v_url := '/moderation/reports';
  elsif n.kind = 'member_review' then
    v_url := '/admin/members';
  elsif n.ticket_id is not null then
    v_url := '/tickets/' || n.ticket_id::text;
  end if;

  case n.kind
    when 'mention' then
      v_title := 'Nueva mención';
      v_phrase := v_actor || ' te mencionó en #' || coalesce(v_channel, '');
    when 'reply' then
      v_title := 'Nueva respuesta';
      v_phrase := v_actor || ' respondió en #' || coalesce(v_channel, '');
    when 'channel_message' then
      v_title := 'Nuevo mensaje';
      v_phrase := v_actor || ' publicó en #' || coalesce(v_channel, '');
    when 'invite_redeemed' then
      v_title := 'Invitación canjeada';
      v_phrase := v_actor || ' se unió con tu invitación';
    when 'godchild_banned' then
      v_title := 'Ahijado baneado';
      v_phrase := 'Tu ahijado ' || v_actor || ' ha sido baneado';
    when 'sponsor_penalized' then
      v_title := 'Penalización de padrino';
      v_phrase := 'Te han penalizado porque ' || v_actor || ' fue baneado';
    when 'report_new' then
      v_title := 'Nuevo reporte';
      v_phrase := v_actor || ' reportó un mensaje en #' || coalesce(v_channel, '');
    when 'member_review' then
      v_title := 'Miembro por revisar';
      v_phrase := v_actor || ' necesita revisión';
    when 'ticket_new' then
      v_title := 'Nuevo ticket';
      v_phrase := v_actor || ' abrió un ticket: ' || coalesce(v_subject, '');
    when 'ticket_reply' then
      v_title := 'Respuesta en un ticket';
      v_phrase := v_actor || ' escribió en el ticket: ' || coalesce(v_subject, '');
    when 'ticket_status' then
      if n.data ->> 'status' = 'closed' then
        v_title := 'Ticket cerrado';
        v_phrase := v_actor || ' cerró el ticket: ' || coalesce(v_subject, '');
      else
        v_title := 'Ticket reabierto';
        v_phrase := v_actor || ' reabrió el ticket: ' || coalesce(v_subject, '');
      end if;
    else
      return;
  end case;

  title := v_title;
  body := case when v_excerpt is not null then v_phrase || ': «' || v_excerpt || '»' else v_phrase end;
  url := v_url;
  tag := n.kind || ':' || coalesce(n.message_id::text, n.ticket_id::text, n.id::text);
  return next;
end;
$$;

-- Claims up to p_limit (max 200) pending notifications of the last 15 minutes: marks them as pushed, re-validates
-- the recipient and returns one row per push subscription. Older pending notices are marked without being sent.
create function public.claim_push_notifications(p_limit int default 200)
returns table (
  notification_id bigint,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  url text,
  tag text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 200));
begin
  update public.notifications n
  set pushed_at = now()
  where n.pushed_at is null
    and n.created_at <= now() - interval '15 minutes';

  return query
  with picked as (
    select n.id
    from public.notifications n
    where n.pushed_at is null
      and n.created_at > now() - interval '15 minutes'
    order by n.id
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set pushed_at = now()
    from picked
    where n.id = picked.id
    returning n.id, n.recipient_id
  ),
  built as (
    select c.id as nid, c.recipient_id as rid, b.title as btitle, b.body as bbody, b.url as burl, b.tag as btag
    from claimed c
    cross join lateral public._push_build(c.id) b
  )
  select b.nid, s.endpoint, s.p256dh, s.auth, b.btitle, b.bbody, b.burl, b.btag
  from built b
  join public.push_subscriptions s on s.member_id = b.rid
  order by b.nid, s.created_at, s.id;
end;
$$;

create function public.delete_push_subscription_by_endpoint(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint
$$;

-- ===== Task 5 review minors =====

-- (a) whitespace-only subject/body rejected: trim space, \t \n \v \f \r (locale-independent), then apply the length rules.
-- (b) the author's reply falls back to every staff member when no participating staff still has access.
create or replace function public.open_ticket(p_channel uuid, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_perms bigint;
  v_subject text := btrim(p_subject, E' \t\n\x0b\f\r');
  v_body text := btrim(p_body, E' \t\n\x0b\f\r');
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

create or replace function public.post_ticket_message(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  t public.tickets;
  v_body text := btrim(p_body, E' \t\n\x0b\f\r');
  v_id uuid;
  v_links boolean;
  v_now timestamptz := clock_timestamp();
  v_n int;
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
    -- staff who already replied and still have access; if there are none, every staff member of the channel
    insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
    select s.id, 'ticket_reply', v_me, t.id
    from public.members s
    where s.status = 'active'
      and s.id <> v_me
      and s.id in (select tm.author_id from public.ticket_messages tm where tm.ticket_id = t.id and tm.author_id <> t.author_id)
      and (public.channel_permissions(s.id, t.channel_id) & 16384) = 16384;
    get diagnostics v_n = row_count;
    if v_n = 0 then
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

-- (c) one ticket_updated event per real change: a post only moves last_message_at and is announced by
-- ticket_message_created, so it must not also fire ticket_updated.
drop trigger tickets_broadcast_update on public.tickets;
create trigger tickets_broadcast_update after update on public.tickets
  for each row
  when ((old.channel_id, old.author_id, old.subject, old.status, old.closed_by, old.closed_at)
        is distinct from (new.channel_id, new.author_id, new.subject, new.status, new.closed_by, new.closed_at))
  execute function public.broadcast_ticket_event();

-- (d) tickets RLS: staff branch through visible_channels() (set-based, same shape as the other policies).
drop policy tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    (author_id = public.current_member_id() and public.is_active_member())
    or channel_id in (select v.id from public.visible_channels() v where public.can(v.id, 16384))
  );

-- ===== grants =====
revoke execute on function
  public._push_build(bigint),
  public.claim_push_notifications(int),
  public.delete_push_subscription_by_endpoint(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.claim_push_notifications(int),
  public.delete_push_subscription_by_endpoint(text)
to service_role;
