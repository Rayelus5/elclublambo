-- F2c Task 2: message notification fan-out (mention > reply > channel_message), plus Task 1 review minors.
-- notifications keep ids only. Recipients are filtered with channel_permissions(recipient, channel) & 1 at creation.

-- ===== Task 1 review minors =====

-- (c) a message notification always carries its channel
alter table public.notifications
  add constraint notifications_message_has_channel check (message_id is null or channel_id is not null);

-- (a) the endpoint just saved must never be the one trimmed: refresh created_at on upsert
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
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
    set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth,
        last_used_at = now(), created_at = clock_timestamp();

  -- keep the 10 newest
  delete from public.push_subscriptions s
  where s.member_id = v_me
    and s.id not in (
      select k.id from public.push_subscriptions k where k.member_id = v_me
      order by k.created_at desc, k.id desc limit 10
    );
end;
$$;

-- (b) only rows that pass the same visibility filter as RLS / the unread count can be marked read
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
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ===== fan-out =====

-- One set-based INSERT ... SELECT. Candidates are collected per kind with a priority, de-duplicated per recipient
-- (lowest priority number wins: mention 1, reply 2, channel_message 3), then filtered once by active status and
-- channel_permissions & 1. p_only_mentions=true (edits) evaluates only mentions; the unique index
-- (recipient_id, message_id) + ON CONFLICT DO NOTHING keeps anyone already notified from getting a second row.
create function public._notify_message(p_message uuid, p_only_mentions boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  v_default text;
  v_data jsonb;
begin
  select * into m from public.messages x where x.id = p_message;
  if not found or m.deleted_at is not null then
    return;
  end if;
  select c.default_follow into v_default from public.channels c where c.id = m.channel_id;
  v_data := case when m.thread_root_id is null then '{}'::jsonb
                 else jsonb_build_object('thread_root_id', m.thread_root_id) end;

  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  select r.recipient, r.kind, m.author_id, m.channel_id, m.id,
         case when r.kind = 'channel_message' then '{}'::jsonb else v_data end
  from (
    select distinct on (cand.recipient) cand.recipient, cand.kind
    from (
      -- direct member mentions: never suppressed by mute
      select mm.target_id as recipient, 'mention'::text as kind, 1 as prio
      from public.message_mentions mm
      where mm.message_id = m.id and mm.kind = 'member' and mm.notify

      union all
      -- role mentions (notify only when the author had MENTION_EVERYONE): skip members who muted the channel
      select mr.member_id, 'mention', 1
      from public.message_mentions mm
      join public.member_roles mr on mr.role_id = mm.target_id
      where mm.message_id = m.id and mm.kind = 'role' and mm.notify
        and not exists (
          select 1 from public.channel_follow_prefs f
          where f.member_id = mr.member_id and f.channel_id = m.channel_id and f.level = 'mute')

      union all
      -- @everyone: every active member, minus muted
      select mb.id, 'mention', 1
      from public.message_mentions mm
      join public.members mb on mb.status = 'active'
      where mm.message_id = m.id and mm.kind = 'everyone' and mm.notify
        and not exists (
          select 1 from public.channel_follow_prefs f
          where f.member_id = mb.id and f.channel_id = m.channel_id and f.level = 'mute')

      union all
      -- replies: root author, earlier participants of the thread
      select a.author_id, 'reply', 2
      from (
        select r0.author_id from public.messages r0
        where not p_only_mentions and m.thread_root_id is not null and r0.id = m.thread_root_id
        union
        select r1.author_id from public.messages r1
        where not p_only_mentions and m.thread_root_id is not null and r1.thread_root_id = m.thread_root_id
          and r1.id <> m.id and r1.deleted_at is null
      ) a

      union all
      -- quoted message author
      select q.author_id, 'reply', 2
      from public.messages q
      where not p_only_mentions and m.quoted_message_id is not null and q.id = m.quoted_message_id

      union all
      -- followers of the channel at level 'all': root messages only
      select mb.id, 'channel_message', 3
      from public.members mb
      left join public.channel_follow_prefs f on f.member_id = mb.id and f.channel_id = m.channel_id
      where not p_only_mentions and m.thread_root_id is null and mb.status = 'active'
        and coalesce(f.level, v_default) = 'all'
    ) cand
    where cand.recipient is not null and cand.recipient <> m.author_id
    order by cand.recipient, cand.prio
  ) r
  join public.members rm on rm.id = r.recipient and rm.status = 'active'
  where (public.channel_permissions(r.recipient, m.channel_id) & 1) = 1
  order by case r.kind when 'mention' then 1 when 'reply' then 2 else 3 end, r.recipient
  on conflict (recipient_id, message_id) where message_id is not null do nothing;
end;
$$;

-- ===== post wrappers (same signatures and grants as F2b) =====

create or replace function public.post_message(
  p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := public._post_message_core(public.current_member_id(), p_channel, p_body, p_body_text, p_expanded,
                                    p_thread_root, p_quoted, p_attachments, null);
  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

create or replace function public.post_message_as(
  p_member uuid, p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_alpha_address text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_alpha_address is null then
    raise exception 'invalid_input';
  end if;
  v_id := public._post_message_core(p_member, p_channel, p_body, p_body_text, p_expanded,
                                    p_thread_root, p_quoted, p_attachments, p_alpha_address);
  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

-- edit_message: identical to 20261016200006 plus the final mention-only fan-out
create or replace function public.edit_message(p_id uuid, p_body jsonb, p_body_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_perms bigint;
  v_text text;
begin
  select * into v_msg from public.messages m where m.id = p_id for update;
  if v_actor is null or not found or v_msg.author_id <> v_actor or v_msg.deleted_at is not null then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  -- must still be able to see the channel and to write there (root or thread)
  if (v_perms & 1) = 0 or (v_perms & case when v_msg.thread_root_id is null then 2 else 4 end) = 0 then
    raise exception 'forbidden';
  end if;

  -- p_body_text is accepted for signature compatibility only: the stored text is derived from the doc
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'invalid_input';
  end if;
  if p_body ->> 'type' is distinct from 'doc' then
    raise exception 'invalid_input';
  end if;
  if octet_length(p_body::text) > 65536 then
    raise exception 'too_long';
  end if;
  v_text := public._doc_text(p_body);
  if char_length(v_text) > 20000 or (not v_msg.expanded and char_length(v_text) > 4000) then
    raise exception 'too_long';
  end if;
  if v_text = '' and not exists (
    select 1 from public.message_attachments a where a.message_id = p_id) then
    raise exception 'invalid_input';
  end if;

  update public.messages
  set body = p_body, body_text = v_text, allow_links = (v_perms & 2048) = 2048, edited_at = now()
  where id = p_id;

  delete from public.message_mentions where message_id = p_id;
  perform public._insert_mentions(p_id, p_body, v_perms);

  -- only new mention recipients get a notification (existing rows win through the unique index)
  perform public._notify_message(p_id, true);
end;
$$;

-- ===== grants =====
revoke execute on function
  public._notify_message(uuid, boolean),
  public.post_message(uuid, jsonb, text, boolean, uuid, uuid, jsonb),
  public.post_message_as(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text),
  public.edit_message(uuid, jsonb, text),
  public.save_push_subscription(text, text, text),
  public.mark_notifications_read(bigint[])
from public, anon, authenticated, service_role;

grant execute on function
  public.post_message(uuid, jsonb, text, boolean, uuid, uuid, jsonb),
  public.edit_message(uuid, jsonb, text),
  public.save_push_subscription(text, text, text),
  public.mark_notifications_read(bigint[])
to authenticated;
grant execute on function
  public.post_message_as(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text)
to service_role;
