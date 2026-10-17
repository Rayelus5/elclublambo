-- F2b: private image storage. Bucket + view-scoped policies, storage-verified attachment claims,
-- and a broadcast fix for channel cascades.

-- ===== bucket =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ===== policies =====
-- Path layout: <channel_id>/<member_id>/<uuid>.<ext>. The regex is checked inside CASE before any uuid cast,
-- because Postgres does not guarantee AND short-circuiting in a policy and an invalid cast would error.
-- No UPDATE policy (no overwrite / upsert) and no DELETE policy: cleanup runs with the service role.
create policy chat_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
        then split_part(name, '/', 2) = public.current_member_id()::text
             and public.is_active_member()
             and public.can(split_part(name, '/', 1)::uuid, 1024)
      else false
    end
  );

create policy chat_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-images'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        then public.can_view(split_part(name, '/', 1)::uuid)
      else false
    end
  );

-- ===== post core: verify attachments against storage =====
-- The single place where a message is created. p_member is the author (already identified by the caller).
create or replace function public._post_message_core(
  p_member uuid, p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_alpha_address text
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
      -- the object must exist in storage; its metadata (set by Storage, not the client) overrides the client claims
      select true, o.metadata into v_found, v_meta
      from storage.objects o where o.bucket_id = 'chat-images' and o.name = v_path;
      if v_found is not true then
        raise exception 'invalid_input';
      end if;
      v_mime := coalesce(v_meta ->> 'mimetype', v_att ->> 'mime');
      v_size := coalesce(v_meta ->> 'size', v_att ->> 'size');
      if v_mime is null or v_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
         or v_size is null or v_size !~ '^[0-9]{1,9}$' or v_size::bigint not between 1 and 5242880
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
                               allow_links, kind, quoted_message_id)
  values (p_channel, p_thread_root, p_member, p_body, v_text, v_expanded,
          (v_perms & 2048) = 2048, v_kind, p_quoted)
  returning id into v_id;

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

-- ===== broadcast: no per-message events for rows removed by a channel cascade =====
create or replace function public.broadcast_message_event()
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
    -- a channel delete cascades here after the channel row is gone: the topic is dead, send nothing
    if not exists (select 1 from public.channels c where c.id = old.channel_id) then
      return null;
    end if;
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
