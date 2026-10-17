-- F2b: reactions, pins, read marks and unread tracking. All writes are authorized inside these definer RPCs.

-- Toggles the caller's reaction. Returns true when added, false when removed.
-- Requires VIEW + ADD_REACTIONS (8192) in the message's channel, and a message that is not deleted.
-- At most 20 distinct emojis per message; removing a reaction is always allowed while permitted.
create function public.toggle_reaction(p_message uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_perms bigint;
begin
  if v_actor is null or p_message is null then
    raise exception 'forbidden';
  end if;
  select * into v_msg from public.messages m where m.id = p_message;
  if not found then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  if (v_perms & 1) = 0 or (v_perms & 8192) = 0 then
    raise exception 'forbidden';
  end if;

  -- plain emoji sequences only: no whitespace or control characters, 1..32 bytes
  if p_emoji is null or octet_length(p_emoji) not between 1 and 32 or p_emoji ~ '[[:cntrl:][:space:]]' then
    raise exception 'invalid_input';
  end if;

  -- serialize reactions per message so the distinct-emoji limit cannot be raced
  perform pg_advisory_xact_lock(hashtextextended('reaction:' || p_message::text, 0));

  perform 1 from public.messages m where m.id = p_message and m.deleted_at is null;
  if not found then
    raise exception 'invalid_input';
  end if;

  delete from public.message_reactions r
  where r.message_id = p_message and r.member_id = v_actor and r.emoji = p_emoji;
  if found then
    return false;
  end if;

  if not exists (select 1 from public.message_reactions r where r.message_id = p_message and r.emoji = p_emoji)
     and (select count(distinct r.emoji) from public.message_reactions r where r.message_id = p_message) >= 20 then
    raise exception 'too_many_reactions';
  end if;

  insert into public.message_reactions (message_id, member_id, emoji) values (p_message, v_actor, p_emoji);
  return true;
end;
$$;

-- Pins or unpins a root message. Requires MANAGE_MESSAGES (8) in the channel; replies and deleted messages are invalid.
create function public.set_pinned(p_message uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_perms bigint;
begin
  if v_actor is null or p_message is null or p_pinned is null then
    raise exception 'forbidden';
  end if;
  select * into v_msg from public.messages m where m.id = p_message for update;
  if not found then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  if (v_perms & 1) = 0 or (v_perms & 8) = 0 then
    raise exception 'forbidden';
  end if;
  if v_msg.thread_root_id is not null or v_msg.deleted_at is not null then
    raise exception 'invalid_input';
  end if;

  if p_pinned then
    update public.messages set pinned_at = now(), pinned_by = v_actor where id = p_message;
  else
    update public.messages set pinned_at = null, pinned_by = null where id = p_message;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, case when p_pinned then 'message_pinned' else 'message_unpinned' end, 'message', p_message,
          jsonb_build_object('channel_id', v_msg.channel_id));
end;
$$;

-- Marks the channel as read now. Requires VIEW.
create function public.mark_channel_read(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
begin
  if v_actor is null or p_channel is null or (public.channel_permissions(v_actor, p_channel) & 1) = 0 then
    raise exception 'forbidden';
  end if;
  insert into public.channel_reads (member_id, channel_id, last_read_at)
  values (v_actor, p_channel, now())
  on conflict (member_id, channel_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- Visible text channels holding a root message or reply (not deleted, by someone else) newer than the member's
-- read mark (no mark: the member's join date). One pass over visible_channels(); the per-channel EXISTS
-- is answered by the (channel_id, created_at desc, id) index.
create function public.my_unread_channels()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.created_at from public.members m where m.auth_user_id = auth.uid() and m.status = 'active'
  )
  select c.id
  from public.visible_channels() c
  cross join me
  left join public.channel_reads cr on cr.member_id = me.id and cr.channel_id = c.id
  where c.kind = 'text'
    and exists (
      select 1 from public.messages x
      where x.channel_id = c.id
        and x.created_at > coalesce(cr.last_read_at, me.created_at)
        and x.deleted_at is null
        and x.author_id <> me.id
    )
$$;

revoke execute on function
  public.toggle_reaction(uuid, text),
  public.set_pinned(uuid, boolean),
  public.mark_channel_read(uuid),
  public.my_unread_channels()
from public, anon, service_role;

grant execute on function
  public.toggle_reaction(uuid, text),
  public.set_pinned(uuid, boolean),
  public.mark_channel_read(uuid),
  public.my_unread_channels()
to authenticated;
