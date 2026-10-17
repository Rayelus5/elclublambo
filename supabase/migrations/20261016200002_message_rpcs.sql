-- F2b: message write RPCs. Every chat write is authorized here (tables have no write grants).
-- Shared logic lives in private definer functions revoked from every API role.

-- Last post time per (member, channel). Survives deletion of the message, so deleting your own message
-- cannot reset the slowmode window. Only written by _post_message_core; not readable through the API.
create table public.member_channel_last_post (
  member_id uuid not null references public.members (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  last_post_at timestamptz not null,
  primary key (member_id, channel_id)
);
create index member_channel_last_post_channel_idx on public.member_channel_last_post (channel_id);
alter table public.member_channel_last_post enable row level security;
revoke all on public.member_channel_last_post from anon, authenticated;

-- Plain text of a Tiptap doc, derived server-side (body_text sent by clients is ignored: it cannot be trusted
-- for length limits, search or notifications). Rules, mirrored by the TS docToPlainText (Task 7):
--   text node -> its text; mention -> '@' || attrs.label ('@' alone without a label); hardBreak -> newline;
--   any other node -> its children joined; two consecutive inline children (text/mention/hardBreak) join with '',
--   every other pair of siblings is separated by a newline; nesting deeper than 40 levels is ignored;
--   the result is trimmed of leading/trailing whitespace.
create function public._doc_text_rec(p_node jsonb, p_depth int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text;
  v_out text := '';
  v_child jsonb;
  v_inline boolean;
  v_prev_inline boolean := false;
  v_first boolean := true;
begin
  if p_depth > 40 or jsonb_typeof(p_node) is distinct from 'object' then
    return '';
  end if;
  v_type := p_node ->> 'type';
  if v_type = 'text' then
    return case when jsonb_typeof(p_node -> 'text') = 'string' then p_node ->> 'text' else '' end;
  elsif v_type = 'mention' then
    return '@' || case when jsonb_typeof(p_node -> 'attrs' -> 'label') = 'string'
                       then p_node -> 'attrs' ->> 'label' else '' end;
  elsif v_type = 'hardBreak' then
    return E'\n';
  end if;
  if jsonb_typeof(p_node -> 'content') is distinct from 'array' then
    return '';
  end if;
  for v_child in select e.value from jsonb_array_elements(p_node -> 'content') e loop
    v_inline := (v_child ->> 'type') in ('text', 'mention', 'hardBreak');
    if not v_first and not (v_inline and v_prev_inline) then
      v_out := v_out || E'\n';
    end if;
    v_out := v_out || public._doc_text_rec(v_child, p_depth + 1);
    v_prev_inline := v_inline;
    v_first := false;
  end loop;
  return v_out;
end;
$$;

create function public._doc_text(p_doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(public._doc_text_rec(p_doc, 0), '^\s+|\s+$', '', 'g')
$$;

-- Seconds the member still has to wait before posting in the channel (0 = free to post).
-- Slowmode applies when slowmode_seconds > 0 and the member lacks MANAGE_MESSAGES. Uses the database clock only.
create function public._slowmode_remaining(p_member uuid, p_channel uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slow int;
  v_last timestamptz;
begin
  select c.slowmode_seconds into v_slow from public.channels c where c.id = p_channel;
  if coalesce(v_slow, 0) = 0 or (public.channel_permissions(p_member, p_channel) & 8) <> 0 then
    return 0;
  end if;
  select l.last_post_at into v_last
  from public.member_channel_last_post l where l.member_id = p_member and l.channel_id = p_channel;
  if v_last is null then
    return 0;
  end if;
  return least(greatest(ceil(v_slow - extract(epoch from (now() - v_last)))::int, 0), v_slow);
end;
$$;

create function public.my_slowmode_remaining(p_channel uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.can_view(p_channel)
    then coalesce(public._slowmode_remaining(public.current_member_id(), p_channel), 0) else 0 end
$$;

-- Parses the mention nodes of a Tiptap doc into message_mentions (deduped, max 50).
-- member: must exist and be active (notify true), otherwise skipped. role: must exist.
-- role/everyone notify only when the author holds MENTION_EVERYONE (4096) in the channel.
create function public._insert_mentions(p_message uuid, p_body jsonb, p_perms bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  with raw as (
    select n.val -> 'attrs' ->> 'kind' as kind, n.val -> 'attrs' ->> 'id' as id, n.ord
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "mention")') with ordinality as n(val, ord)
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

-- The single place where a message is created. p_member is the author (already identified by the caller).
create function public._post_message_core(
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
      v_mime := v_att ->> 'mime';
      v_size := v_att ->> 'size';
      if v_mime is null or v_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
         or v_size is null or v_size !~ '^[0-9]{1,9}$' or v_size::bigint not between 1 and 5242880
         or v_path = any (v_paths)
         or exists (select 1 from public.message_attachments a where a.storage_path = v_path) then
        raise exception 'invalid_input';
      end if;
      v_paths := v_paths || v_path;
    end loop;
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

create function public.post_message(
  p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public._post_message_core(public.current_member_id(), p_channel, p_body, p_body_text, p_expanded,
                                   p_thread_root, p_quoted, p_attachments, null)
$$;

-- Alpha posts: the server action verifies the session and the on-chain contract first, then calls this as service_role.
create function public.post_message_as(
  p_member uuid, p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_alpha_address text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_alpha_address is null then
    raise exception 'invalid_input';
  end if;
  return public._post_message_core(p_member, p_channel, p_body, p_body_text, p_expanded,
                                   p_thread_root, p_quoted, p_attachments, p_alpha_address);
end;
$$;

create function public.edit_message(p_id uuid, p_body jsonb, p_body_text text)
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

create function public.delete_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_root uuid;
  v_root_row public.messages;
  v_perms bigint;
  v_paths text[];
  v_soft boolean;
begin
  select * into v_msg from public.messages m where m.id = p_id;
  if v_actor is null or not found then
    raise exception 'forbidden';
  end if;
  -- lock order: thread root first, then the message (post/delete of replies serialize on the root)
  v_root := coalesce(v_msg.thread_root_id, v_msg.id);
  select * into v_root_row from public.messages r where r.id = v_root for update;
  select * into v_msg from public.messages m where m.id = p_id for update;
  if not found then
    raise exception 'forbidden';
  end if;

  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  if (v_perms & 1) = 0 or not (v_msg.author_id = v_actor or (v_perms & 8) = 8) then
    raise exception 'forbidden';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'invalid_input';
  end if;

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_paths
  from public.message_attachments a where a.message_id = p_id;

  if v_msg.author_id <> v_actor then
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (v_actor, 'message_deleted', 'message', p_id,
            jsonb_build_object('channel_id', v_msg.channel_id, 'author_id', v_msg.author_id));
  end if;

  v_soft := v_msg.thread_root_id is null
            and exists (select 1 from public.messages r where r.thread_root_id = p_id);

  if v_soft then
    delete from public.message_attachments where message_id = p_id;
    delete from public.message_reactions where message_id = p_id;
    delete from public.message_mentions where message_id = p_id;
    delete from public.alpha_details where message_id = p_id;
    update public.messages
    set body = '{"type":"doc","content":[]}'::jsonb, body_text = '', kind = 'text', pinned_at = null,
        pinned_by = null, deleted_at = now(), deleted_by = v_actor
    where id = p_id;
    return jsonb_build_object('hard', false, 'paths', to_jsonb(v_paths));
  end if;

  delete from public.messages where id = p_id;

  if v_msg.thread_root_id is not null then
    update public.messages
    set reply_count = greatest(reply_count - 1, 0),
        last_reply_at = (select max(r.created_at) from public.messages r where r.thread_root_id = v_root)
    where id = v_root;
    -- a tombstone whose last reply is gone has nothing left to hold
    if v_root_row.deleted_at is not null
       and not exists (select 1 from public.messages r where r.thread_root_id = v_root) then
      delete from public.messages where id = v_root;
    end if;
  end if;
  return jsonb_build_object('hard', true, 'paths', to_jsonb(v_paths));
end;
$$;

revoke execute on function
  public._doc_text_rec(jsonb, int),
  public._doc_text(jsonb),
  public._slowmode_remaining(uuid, uuid),
  public._insert_mentions(uuid, jsonb, bigint),
  public._post_message_core(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text),
  public.post_message(uuid, jsonb, text, boolean, uuid, uuid, jsonb),
  public.post_message_as(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text),
  public.edit_message(uuid, jsonb, text),
  public.delete_message(uuid),
  public.my_slowmode_remaining(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.post_message(uuid, jsonb, text, boolean, uuid, uuid, jsonb),
  public.edit_message(uuid, jsonb, text),
  public.delete_message(uuid),
  public.my_slowmode_remaining(uuid)
to authenticated;
grant execute on function
  public.post_message_as(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text)
to service_role;

-- delete_channel now reports the Storage objects of the channel's messages and audits the message count.
drop function public.delete_channel(uuid);
create function public.delete_channel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_node public.channels;
  v_paths text[];
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext('public.channels_tree'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;
  if p_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_node from public.channels c where c.id = p_id for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if (public.channel_permissions(v_actor, p_id) & 1) = 0 then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from public.channels c where c.parent_id = p_id) then
    -- do not reveal children the actor cannot see
    if exists (select 1 from public.channels c
               where c.parent_id = p_id and (public.channel_permissions(v_actor, c.id) & 1) <> 0) then
      raise exception 'not_empty';
    end if;
    raise exception 'forbidden';
  end if;

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_paths
  from public.message_attachments a join public.messages m on m.id = a.message_id
  where m.channel_id = p_id;
  select count(*)::int into v_count from public.messages m where m.channel_id = p_id;

  delete from public.channels where id = p_id;

  -- keep the remaining siblings contiguous
  update public.channels c set position = o.ord - 1
  from (
    select s.id, row_number() over (order by s.position, s.created_at, s.id) as ord
    from public.channels s where s.parent_id is not distinct from v_node.parent_id
  ) o
  where c.id = o.id and c.position is distinct from o.ord - 1;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_deleted', 'channel', p_id,
          jsonb_build_object('name', v_node.name, 'kind', v_node.kind, 'parent_id', v_node.parent_id,
                             'message_count', v_count));

  return jsonb_build_object('paths', to_jsonb(v_paths));
end;
$$;

revoke execute on function public.delete_channel(uuid) from public, anon;
grant execute on function public.delete_channel(uuid) to authenticated;
