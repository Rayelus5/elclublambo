-- F2a tree management RPCs (create / update / move / delete channels) with anti-escalation:
-- MANAGE_CHANNELS (128) globally AND VIEW on the affected node and on the destination parent.
-- Lock order: every mutating RPC takes the tree advisory lock FIRST (same key as channels_tree_guard),
-- then reads/locks rows, so RPCs and the trigger never deadlock on each other.

-- Deferred from Task 3: can() only understands channel bits. Global bits go through has_global_perm.
create or replace function public.can(p_channel uuid, p_bit bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bit is not null and (p_bit & ~31759::bigint) <> 0 then
    raise exception 'invalid_input';
  end if;
  return coalesce(p_bit, 0) > 0 and coalesce(
    (select (public.channel_permissions(m.id, p_channel) & p_bit) = p_bit
     from public.members m
     where m.auth_user_id = auth.uid() and m.status = 'active'),
    false
  );
end;
$$;

create function public.create_channel(p_parent uuid, p_kind text, p_name text, p_topic text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text;
  v_topic text;
  v_pos int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('public.channels_tree'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;

  v_name := btrim(p_name);
  v_topic := nullif(btrim(p_topic), '');
  if v_name is null or char_length(v_name) not between 1 and 50
     or (v_topic is not null and char_length(v_topic) > 300)
     or p_kind is null or p_kind not in ('category', 'forum', 'text') then
    raise exception 'invalid_input';
  end if;

  if p_parent is not null then
    perform 1 from public.channels c where c.id = p_parent for update;
    if not found then
      raise exception 'invalid_input';
    end if;
    if (public.channel_permissions(v_actor, p_parent) & 1) = 0 then
      raise exception 'forbidden';
    end if;
  end if;

  select coalesce(max(c.position) + 1, 0) into v_pos
  from public.channels c where c.parent_id is not distinct from p_parent;

  insert into public.channels (parent_id, kind, name, topic, position, created_by)
  values (p_parent, p_kind, v_name, v_topic, v_pos, v_actor)
  returning id into v_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_created', 'channel', v_id,
          jsonb_build_object('name', v_name, 'kind', p_kind, 'parent_id', p_parent));

  return v_id;
end;
$$;

create function public.update_channel(
  p_id uuid, p_name text, p_topic text, p_slowmode int, p_tickets boolean, p_alpha boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_node public.channels;
  v_name text;
  v_topic text;
  v_slow int := coalesce(p_slowmode, 0);
begin
  perform pg_advisory_xact_lock(hashtext('public.channels_tree'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;

  v_name := btrim(p_name);
  v_topic := nullif(btrim(p_topic), '');
  if p_id is null or v_name is null or char_length(v_name) not between 1 and 50
     or (v_topic is not null and char_length(v_topic) > 300)
     or not (v_slow = 0 or v_slow between 5 and 604800) then
    raise exception 'invalid_input';
  end if;

  select * into v_node from public.channels c where c.id = p_id for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if (public.channel_permissions(v_actor, p_id) & 1) = 0 then
    raise exception 'forbidden';
  end if;

  if v_node.kind <> 'text' and (coalesce(p_tickets, false) or coalesce(p_alpha, false)) then
    raise exception 'invalid_input';
  end if;

  update public.channels
  set name = v_name,
      topic = v_topic,
      slowmode_seconds = v_slow,
      tickets_enabled = coalesce(p_tickets, false),
      alpha_enabled = coalesce(p_alpha, false)
  where id = p_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_updated', 'channel', p_id,
          jsonb_build_object('name', v_name, 'previous_name', v_node.name));
end;
$$;

create function public.move_channel(p_id uuid, p_new_parent uuid, p_index int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_node public.channels;
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_idx int;
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
  if p_new_parent is not null then
    perform 1 from public.channels c where c.id = p_new_parent for update;
    if not found then
      raise exception 'invalid_input';
    end if;
  end if;

  if (public.channel_permissions(v_actor, p_id) & 1) = 0 then
    raise exception 'forbidden';
  end if;
  if p_new_parent is not null and (public.channel_permissions(v_actor, p_new_parent) & 1) = 0 then
    raise exception 'forbidden';
  end if;

  -- Reparent first: the tree guard rejects cycles, bad kinds and depth > 6; the whole call rolls back.
  if v_node.parent_id is distinct from p_new_parent then
    update public.channels set parent_id = p_new_parent where id = p_id;
  end if;

  -- Source siblings (without the node) and destination siblings (without the node).
  if v_node.parent_id is distinct from p_new_parent then
    select coalesce(array_agg(c.id order by c.position, c.created_at, c.id), '{}')
      into v_old_ids
    from public.channels c
    where c.parent_id is not distinct from v_node.parent_id and c.id <> p_id;

    update public.channels c set position = o.ord - 1
    from unnest(v_old_ids) with ordinality as o(id, ord)
    where c.id = o.id and c.position is distinct from o.ord - 1;
  end if;

  select coalesce(array_agg(c.id order by c.position, c.created_at, c.id), '{}')
    into v_new_ids
  from public.channels c
  where c.parent_id is not distinct from p_new_parent and c.id <> p_id;

  v_idx := greatest(0, least(coalesce(p_index, 0), coalesce(array_length(v_new_ids, 1), 0)));
  v_new_ids := v_new_ids[1:v_idx] || p_id || v_new_ids[v_idx + 1:coalesce(array_length(v_new_ids, 1), 0)];

  update public.channels c set position = o.ord - 1
  from unnest(v_new_ids) with ordinality as o(id, ord)
  where c.id = o.id and c.position is distinct from o.ord - 1;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_moved', 'channel', p_id,
          jsonb_build_object('name', v_node.name, 'from_parent_id', v_node.parent_id,
                             'to_parent_id', p_new_parent, 'index', v_idx));
end;
$$;

create function public.delete_channel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_node public.channels;
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
    raise exception 'not_empty';
  end if;

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
          jsonb_build_object('name', v_node.name, 'kind', v_node.kind, 'parent_id', v_node.parent_id));
end;
$$;

revoke execute on function
  public.create_channel(uuid, text, text, text),
  public.update_channel(uuid, text, text, int, boolean, boolean),
  public.move_channel(uuid, uuid, int),
  public.delete_channel(uuid)
from public, anon;
grant execute on function
  public.create_channel(uuid, text, text, text),
  public.update_channel(uuid, text, text, int, boolean, boolean),
  public.move_channel(uuid, uuid, int),
  public.delete_channel(uuid)
to authenticated;
