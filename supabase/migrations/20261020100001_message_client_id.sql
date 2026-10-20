-- Ronda 1 T-004 (R1-3): idempotent post_message through a client key.
--
-- The chat sends optimistically and may retry after a broken call, when it cannot know whether the first call wrote
-- the message. The client now sends a key per message (`p_client_id`, the pending row's key) and the server dedups it:
--   * messages.client_id (nullable: system notices, bounties, polls and post_message_as never set it), unique per author.
--   * post_message(..., p_client_id uuid default null): if the author already has a message with that key, its id is
--     returned at once, BEFORE the rate limit, the slowmode check and every side effect (attachments, mentions,
--     notifications, push, broadcast). Retries of one key are serialised with an advisory lock, and the insert itself
--     is `on conflict do nothing` (re-selecting on a miss) as the last guard.
--   * One post_message signature only (the 7-argument one is dropped; 7-argument calls still resolve through the
--     default). Grants are restated exactly as before.

alter table public.messages add column client_id uuid;
create unique index messages_author_client_id_key on public.messages (author_id, client_id) where client_id is not null;

-- ===== _post_message_core: latest definition 20261019700101_rate_limits.sql, plus p_client_id =====
-- create_bounty, create_poll, vote flows and post_message_as call it with 9 arguments: the new one defaults to null.
drop function public._post_message_core(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text);
create function public._post_message_core(
  p_member uuid, p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_alpha_address text,
  p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perms bigint;
  v_channel public.channels;
  v_expanded boolean := coalesce(p_expanded, false);
  v_atts jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_att jsonb;
  v_path text;
  v_mime text;
  v_size text;
  v_path_re text;
  v_meta jsonb;
  v_found boolean;
  v_norm jsonb := '[]'::jsonb;
  v_remaining int;
  v_id uuid;
  v_kind text := 'text';
  v_paths text[] := '{}';
  v_text text;
begin
  if p_member is null or p_channel is null then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(p_member, p_channel);
  if (v_perms & 1) = 0 then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 per minute and 600 per hour per author (post_message, post_message_as, create_bounty, create_poll)
  perform private.rate_limit(p_member::text, 'message_min', 30, interval '1 minute');
  perform private.rate_limit(p_member::text, 'message_hour', 600, interval '1 hour');

  select * into v_channel from public.channels c where c.id = p_channel;
  if v_channel.kind <> 'text' then
    raise exception 'invalid_input';
  end if;

  if p_thread_root is null then
    if (v_perms & 2) = 0 then
      raise exception 'forbidden';
    end if;
  else
    if (v_perms & 4) = 0 then
      raise exception 'forbidden';
    end if;
    -- one-level threads: the root belongs to this channel and is not itself a reply (soft-deleted roots keep their thread)
    perform 1 from public.messages r
    where r.id = p_thread_root and r.channel_id = p_channel and r.thread_root_id is null
    for update;
    if not found then
      raise exception 'thread_invalid';
    end if;
  end if;

  -- p_body_text is accepted for signature compatibility only: the stored text is derived from the doc
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'invalid_input';
  end if;
  -- the renderer shows nothing for a non-doc root, so it must not carry text or mentions either
  if p_body ->> 'type' is distinct from 'doc' then
    raise exception 'invalid_input';
  end if;
  if octet_length(p_body::text) > 65536 then
    raise exception 'too_long';
  end if;
  v_text := public._doc_text(p_body);
  if char_length(v_text) > 20000 or (not v_expanded and char_length(v_text) > 4000) then
    raise exception 'too_long';
  end if;

  if jsonb_typeof(v_atts) <> 'array' then
    raise exception 'invalid_input';
  end if;
  if jsonb_array_length(v_atts) > 4 then
    raise exception 'too_many_attachments';
  end if;
  if v_text = '' and jsonb_array_length(v_atts) = 0 then
    raise exception 'invalid_input';
  end if;

  if jsonb_array_length(v_atts) > 0 then
    if (v_perms & 1024) = 0 then
      raise exception 'forbidden';
    end if;
    v_path_re := '^' || p_channel::text || '/' || p_member::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$';
    for v_att in select e.value from jsonb_array_elements(v_atts) e loop
      if jsonb_typeof(v_att) <> 'object' or jsonb_typeof(v_att -> 'path') is distinct from 'string' then
        raise exception 'invalid_input';
      end if;
      v_path := v_att ->> 'path';
      if v_path !~ v_path_re then
        raise exception 'forbidden';
      end if;
      -- the object must exist in storage; its metadata (set by Storage, not the client) is the only source of
      -- mime and size: the client claims are ignored
      select true, o.metadata into v_found, v_meta
      from storage.objects o where o.bucket_id = 'chat-images' and o.name = v_path;
      if v_found is not true then
        raise exception 'invalid_input';
      end if;
      v_mime := v_meta ->> 'mimetype';
      v_size := v_meta ->> 'size';
      if v_mime is null or v_size is null then
        raise exception 'invalid_input';   -- fail closed: Storage is the only authority
      end if;
      if v_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
         or v_size !~ '^[0-9]{1,9}$' or v_size::bigint not between 1 and 5242880
         or v_path = any (v_paths)
         or exists (select 1 from public.message_attachments a where a.storage_path = v_path) then
        raise exception 'invalid_input';
      end if;
      v_paths := v_paths || v_path;
      v_norm := v_norm || jsonb_build_array((v_att - 'mime' - 'size')
                                            || jsonb_build_object('mime', v_mime, 'size', v_size::bigint));
    end loop;
    v_atts := v_norm;
  end if;

  if p_alpha_address is not null then
    if not v_channel.alpha_enabled or (v_perms & 2048) = 0 then
      raise exception 'forbidden';
    end if;
    if p_alpha_address !~ '^0x[0-9a-fA-F]{40}$' then
      raise exception 'invalid_input';
    end if;
    v_kind := 'alpha';
  end if;

  -- serialize one author's posts in a channel so concurrent requests cannot skip the slowmode window
  perform pg_advisory_xact_lock(hashtextextended(p_member::text || p_channel::text, 0));
  v_remaining := public._slowmode_remaining(p_member, p_channel);
  if v_remaining > 0 then
    raise exception 'slowmode' using detail = v_remaining::text;
  end if;

  if p_quoted is not null then
    perform 1 from public.messages q
    where q.id = p_quoted and q.channel_id = p_channel and q.deleted_at is null;
    if not found then
      raise exception 'invalid_input';
    end if;
  end if;

  insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, expanded,
                               allow_links, kind, quoted_message_id, client_id)
  values (p_channel, p_thread_root, p_member, p_body, v_text, v_expanded,
          (v_perms & 2048) = 2048, v_kind, p_quoted, p_client_id)
  on conflict (author_id, client_id) where client_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    -- R1-3: a concurrent call with the same key won the insert: that message is the answer, with no side effects
    select m.id into v_id from public.messages m where m.author_id = p_member and m.client_id = p_client_id;
    return v_id;
  end if;

  if p_thread_root is not null then
    update public.messages set reply_count = reply_count + 1, last_reply_at = now() where id = p_thread_root;
  end if;

  if v_kind = 'alpha' then
    insert into public.alpha_details (message_id, contract_address) values (v_id, lower(p_alpha_address));
  end if;

  insert into public.member_channel_last_post (member_id, channel_id, last_post_at)
  values (p_member, p_channel, now())
  on conflict (member_id, channel_id) do update set last_post_at = excluded.last_post_at;

  begin
    insert into public.message_attachments (message_id, storage_path, mime, size_bytes, width, height)
    select v_id, e.value ->> 'path', e.value ->> 'mime', (e.value ->> 'size')::int,
           case when (e.value ->> 'width') ~ '^[0-9]{1,5}$' then (e.value ->> 'width')::int end,
           case when (e.value ->> 'height') ~ '^[0-9]{1,5}$' then (e.value ->> 'height')::int end
    from jsonb_array_elements(v_atts) e;
  exception when unique_violation then
    -- a concurrent request claimed the same storage path
    raise exception 'invalid_input';
  end;

  perform public._insert_mentions(v_id, p_body, v_perms);
  return v_id;
end;
$$;


-- ===== post_message: latest definition 20261017300002_message_notify.sql, plus p_client_id =====
drop function public.post_message(uuid, jsonb, text, boolean, uuid, uuid, jsonb);
create function public.post_message(
  p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_id uuid;
  v_channel uuid;
begin
  if p_client_id is not null and v_me is not null then
    -- one key at a time per author: a retry waits for the first call and then sees its row
    perform pg_advisory_xact_lock(hashtextextended('message_client:' || v_me::text || ':' || p_client_id::text, 0));
    select m.id, m.channel_id into v_id, v_channel
    from public.messages m where m.author_id = v_me and m.client_id = p_client_id;
    if v_id is not null then
      -- the same key is the same message: never an answer about another channel
      if v_channel <> p_channel then
        raise exception 'invalid_input';
      end if;
      return v_id;
    end if;
  end if;
  v_id := public._post_message_core(v_me, p_channel, p_body, p_body_text, p_expanded,
                                    p_thread_root, p_quoted, p_attachments, null, p_client_id);
  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

-- ===== grants (as before) =====
revoke execute on function
  public._post_message_core(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text, uuid),
  public.post_message(uuid, jsonb, text, boolean, uuid, uuid, jsonb, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.post_message(uuid, jsonb, text, boolean, uuid, uuid, jsonb, uuid) to authenticated;
