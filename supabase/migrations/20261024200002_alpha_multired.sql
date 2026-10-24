-- P1 Task 2 (D19): alphas on Base and Arbitrum, each with its own network.
--   - alpha_details.chain_id: the Linea check (= 59144) and the default are dropped; a foreign key to public.chains
--     takes their place. Old rows keep 59144, which stays a valid chains row (disabled), so they remain readable.
--   - _post_message_core gets p_alpha_chain (11th argument, default null). With an alpha address it requires
--     private.chain_enabled(p_alpha_chain), else 'chain_invalid', and stores the chain. The 10-argument version is
--     dropped; every 9- and 10-argument caller (post_message, create_bounty, create_poll, tips...) resolves through
--     the defaults.
--   - post_message_as(..., p_alpha_address, p_alpha_chain) replaces the 9-argument version. service_role only.

-- ===== alpha_details.chain_id: no Linea check, no default, FK to chains =====
-- The check was named by Postgres, so it is found by definition.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.alpha_details'::regclass
      and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%59144%'
  loop
    execute format('alter table public.alpha_details drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table public.alpha_details alter column chain_id drop default;
alter table public.alpha_details add foreign key (chain_id) references public.chains (chain_id);

-- ===== _post_message_core: latest definition 20261020100001_message_client_id.sql, plus p_alpha_chain =====
drop function public._post_message_core(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text, uuid);
create function public._post_message_core(
  p_member uuid, p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_alpha_address text,
  p_client_id uuid default null, p_alpha_chain int default null
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
    if p_alpha_chain is null or not private.chain_enabled(p_alpha_chain) then
      raise exception 'chain_invalid';
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
    -- R1-3: last guard only. A concurrent call with the same key won the insert, so return that message's id and skip
    -- this function's own writes (reply count, alpha, last post, attachments). It is not side-effect free for the
    -- caller: post_message would still run _notify_message on the returned id. In practice this branch is unreachable,
    -- because post_message takes a per-key advisory lock and returns an existing id before calling this function.
    select m.id into v_id from public.messages m where m.author_id = p_member and m.client_id = p_client_id;
    return v_id;
  end if;

  if p_thread_root is not null then
    update public.messages set reply_count = reply_count + 1, last_reply_at = now() where id = p_thread_root;
  end if;

  if v_kind = 'alpha' then
    insert into public.alpha_details (message_id, contract_address, chain_id)
    values (v_id, lower(p_alpha_address), p_alpha_chain);
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


-- ===== post_message_as: latest definition 20261017300002_message_notify.sql, plus p_alpha_chain =====
drop function public.post_message_as(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text);
create function public.post_message_as(
  p_member uuid, p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_alpha_address text, p_alpha_chain int
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
                                    p_thread_root, p_quoted, p_attachments, p_alpha_address, null, p_alpha_chain);
  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

-- ===== grants: the core is internal, post_message_as is service_role only =====
revoke execute on function
  public._post_message_core(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text, uuid, int),
  public.post_message_as(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text, int)
from public, anon, authenticated, service_role;
grant execute on function
  public.post_message_as(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text, int)
to service_role;
