-- F2b final review fixes:
--   1. chat-images SELECT: only the uploader, or anyone who can view a message the object is attached to.
--   2. chat-images INSERT: also needs SEND_MESSAGES (2) or SEND_IN_THREADS (4) in the channel (ruling R10).
--   3. _post_message_core: Storage metadata is the only authority for mime and size (fail closed when missing).
--   4. Message bodies must be a `doc`; mentions are counted only where the renderer shows them.
--   5. _doc_text trims ASCII whitespace only, independent of LC_CTYPE (ruling R11).

-- ===== 1 + 2. storage policies =====
-- The regex is checked inside CASE before any uuid cast (no short-circuit guarantee in a policy).
drop policy chat_images_insert on storage.objects;
create policy chat_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
        then split_part(name, '/', 2) = public.current_member_id()::text
             and public.is_active_member()
             and public.can(split_part(name, '/', 1)::uuid, 1024)
             -- an attachment is only usable by posting it: no posting rights, no upload (no orphan quota abuse)
             and (public.can(split_part(name, '/', 1)::uuid, 2) or public.can(split_part(name, '/', 1)::uuid, 4))
      else false
    end
  );

drop policy chat_images_select on storage.objects;
create policy chat_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-images'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
        then (
          -- the uploader (drafts). Also required by Storage: its INSERT ... RETURNING must pass SELECT for the new row.
          (split_part(name, '/', 2) = (select public.current_member_id())::text and (select public.is_active_member()))
          -- or attached to a message of a channel the member can view (set form, evaluated once per query)
          or name in (
            select a.storage_path
            from public.message_attachments a
            join public.messages m on m.id = a.message_id
            where m.channel_id in (select v.id from public.visible_channels() v)
          )
        )
      else false
    end
  );

-- ===== 5. plain text: ASCII-only trim =====
-- ASCII whitespace only, mirrors docToPlainText; independent of LC_CTYPE (a locale-aware \s would also strip NBSP
-- and other Unicode spaces, so SQL and TS would disagree on the stored text and on "empty").
create or replace function public._doc_text(p_doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(public._doc_text_rec(p_doc, 0), '^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$', '', 'g')
$$;

-- ===== 4. mentions: only the rendered content tree =====
-- Walks `content` arrays only (never attrs, marks or other keys), nodes at depth <= 40, and mirrors the sanitizer's
-- allowlist (src/lib/chat/content.ts sanitizeDoc): text, mention and hardBreak have no children; codeBlock keeps text
-- only; horizontalRule has no children; a table keeps only tableRow children; a tableRow keeps only cells.
-- Unknown nodes are walked (the sanitizer keeps their children). Order: document order via the ordinal path.
create or replace function public._insert_mentions(p_message uuid, p_body jsonb, p_perms bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  with recursive walk(node, depth, ord) as (
    select p_body, 0, array[]::bigint[]
    union all
    select c.value, w.depth + 1, w.ord || c.i
    from walk w
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(w.node) = 'object' and jsonb_typeof(w.node -> 'content') = 'array'
           then w.node -> 'content' else '[]'::jsonb end
    ) with ordinality as c(value, i)
    where w.depth < 40
      and coalesce(w.node ->> 'type', '') not in ('text', 'mention', 'hardBreak', 'codeBlock', 'horizontalRule')
      and not (w.node ->> 'type' = 'table' and c.value ->> 'type' is distinct from 'tableRow')
      and not (w.node ->> 'type' = 'tableRow' and coalesce(c.value ->> 'type', '') not in ('tableCell', 'tableHeader'))
  ),
  raw as (
    select w.node -> 'attrs' ->> 'kind' as kind, w.node -> 'attrs' ->> 'id' as id, w.ord
    from walk w
    where jsonb_typeof(w.node) = 'object' and w.node ->> 'type' = 'mention'
  ),
  norm as (
    select r.kind,
           case when r.kind = 'everyone' then null else r.id::uuid end as target,
           r.ord
    from raw r
    where r.kind = 'everyone'
       or (r.kind in ('member', 'role')
           and r.id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  ),
  uniq as (
    select distinct on (kind, target) kind, target, ord from norm order by kind, target, ord
  ),
  resolved as (
    select u.kind, u.target, true as notify, u.ord
    from uniq u join public.members m on m.id = u.target and m.status = 'active'
    where u.kind = 'member'
    union all
    select u.kind, u.target, (p_perms & 4096) = 4096, u.ord
    from uniq u join public.roles ro on ro.id = u.target
    where u.kind = 'role'
    union all
    select u.kind, u.target, (p_perms & 4096) = 4096, u.ord
    from uniq u where u.kind = 'everyone'
  )
  insert into public.message_mentions (message_id, kind, target_id, notify)
  select p_message, r.kind, r.target, r.notify from resolved r order by r.ord limit 50
$$;

-- ===== 3 + 4. post core =====
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

-- ===== 4. edit: same root rule =====
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
end;
$$;

-- create or replace keeps the existing grants; restated so the intent is visible here.
revoke execute on function
  public._doc_text(jsonb),
  public._insert_mentions(uuid, jsonb, bigint),
  public._post_message_core(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text),
  public.edit_message(uuid, jsonb, text)
from public, anon, authenticated, service_role;
grant execute on function public.edit_message(uuid, jsonb, text) to authenticated;
