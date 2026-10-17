-- F2b: private realtime broadcast of message events. Payloads carry ids only; clients re-read content through RLS.
-- Absorbs the Task 1 spike (receive policy) and replaces its test helper with triggers.

-- Receive authorization: only members who can view the channel.
-- CASE (not AND) guards the uuid cast: Postgres does not guarantee AND evaluation order in a policy.
-- Authorization is evaluated when the client joins the topic, so access is cut on resubscribe.
create policy "realtime_receive_channel_topics"
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when realtime.topic() ~ '^channel:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.can_view(substring(realtime.topic() from 9)::uuid)
      else false
    end
  );
-- Intentionally NO insert policy on realtime.messages: clients must never broadcast.

-- messages: created / updated / pinned / deleted. Payload is exactly {id, channel_id, thread_root_id}.
create function public.broadcast_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_row public.messages;
begin
  if tg_op = 'INSERT' then
    v_event := 'message_created';
    v_row := new;
  elsif tg_op = 'DELETE' then
    v_event := 'message_deleted';
    v_row := old;
  else
    v_row := new;
    if old.deleted_at is null and new.deleted_at is not null then
      v_event := 'message_deleted';
    elsif old.pinned_at is distinct from new.pinned_at then
      v_event := 'message_pinned';
    else
      v_event := 'message_updated';
    end if;
  end if;

  perform realtime.send(
    jsonb_build_object('id', v_row.id, 'channel_id', v_row.channel_id, 'thread_root_id', v_row.thread_root_id),
    v_event,
    'channel:' || v_row.channel_id::text,
    true
  );
  return null;
end;
$$;

-- reactions: reaction_changed with the message's ids (id = message_id).
-- Cascaded deletes from a vanished message emit nothing: its own message_deleted covers it.
create function public.broadcast_reaction_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid := case when tg_op = 'DELETE' then old.message_id else new.message_id end;
  v_msg record;
begin
  select m.channel_id, m.thread_root_id into v_msg from public.messages m where m.id = v_message_id;
  if not found then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object('id', v_message_id, 'channel_id', v_msg.channel_id, 'thread_root_id', v_msg.thread_root_id),
    'reaction_changed',
    'channel:' || v_msg.channel_id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function public.broadcast_message_event(), public.broadcast_reaction_event()
  from public, anon, authenticated, service_role;

create trigger messages_broadcast_insert after insert on public.messages
  for each row execute function public.broadcast_message_event();
create trigger messages_broadcast_update after update on public.messages
  for each row execute function public.broadcast_message_event();
create trigger messages_broadcast_delete after delete on public.messages
  for each row execute function public.broadcast_message_event();
create trigger message_reactions_broadcast_insert after insert on public.message_reactions
  for each row execute function public.broadcast_reaction_event();
create trigger message_reactions_broadcast_delete after delete on public.message_reactions
  for each row execute function public.broadcast_reaction_event();

-- Task 4 review fixes -----------------------------------------------------------------------------------------

-- toggle_reaction: the message row is locked FOR SHARE so a concurrent soft/hard delete cannot interleave with
-- the reaction write. Missing / hidden -> forbidden, deleted -> invalid_input (unchanged error codes).
create or replace function public.toggle_reaction(p_message uuid, p_emoji text)
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
  select * into v_msg from public.messages m where m.id = p_message for share;
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

  if v_msg.deleted_at is not null then
    raise exception 'invalid_input';
  end if;

  -- serialize reactions per message so the distinct-emoji limit cannot be raced
  perform pg_advisory_xact_lock(hashtextextended('reaction:' || p_message::text, 0));

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

-- set_pinned: no update, no audit, no event when the pinned state does not change.
create or replace function public.set_pinned(p_message uuid, p_pinned boolean)
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

  if (v_msg.pinned_at is not null) = p_pinned then
    return;
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
