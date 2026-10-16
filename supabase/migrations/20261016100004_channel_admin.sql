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
  v_changes jsonb;
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

  -- audit only the changed fields, as {field: {from, to}}
  v_changes := '{}'::jsonb;
  if v_node.name is distinct from v_name then
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', v_node.name, 'to', v_name));
  end if;
  if v_node.topic is distinct from v_topic then
    v_changes := v_changes || jsonb_build_object('topic', jsonb_build_object('from', v_node.topic, 'to', v_topic));
  end if;
  if v_node.slowmode_seconds is distinct from v_slow then
    v_changes := v_changes || jsonb_build_object('slowmode_seconds',
      jsonb_build_object('from', v_node.slowmode_seconds, 'to', v_slow));
  end if;
  if v_node.tickets_enabled is distinct from coalesce(p_tickets, false) then
    v_changes := v_changes || jsonb_build_object('tickets_enabled',
      jsonb_build_object('from', v_node.tickets_enabled, 'to', coalesce(p_tickets, false)));
  end if;
  if v_node.alpha_enabled is distinct from coalesce(p_alpha, false) then
    v_changes := v_changes || jsonb_build_object('alpha_enabled',
      jsonb_build_object('from', v_node.alpha_enabled, 'to', coalesce(p_alpha, false)));
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_updated', 'channel', p_id,
          jsonb_build_object('name', v_name, 'changes', v_changes));
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

  -- Moving a subtree changes the inherited permissions of every descendant for other members:
  -- the actor must be able to see the whole subtree, not just the root of it.
  if exists (
    with recursive d as (
      select c.id from public.channels c where c.parent_id = p_id
      union all
      select c.id from public.channels c join d on c.parent_id = d.id
    ) cycle id set is_cycle using path
    select 1 from d
    where not d.is_cycle and (public.channel_permissions(v_actor, d.id) & 1) = 0
  ) then
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

  -- p_index null means "append at the end"; otherwise clamped to [0, n].
  v_idx := greatest(0, least(coalesce(p_index, coalesce(array_length(v_new_ids, 1), 0)),
                             coalesce(array_length(v_new_ids, 1), 0)));
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
    -- do not reveal children the actor cannot see
    if exists (select 1 from public.channels c
               where c.parent_id = p_id and (public.channel_permissions(v_actor, c.id) & 1) <> 0) then
      raise exception 'not_empty';
    end if;
    raise exception 'forbidden';
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

-- ===== Overwrites, roles and allowed domains (F2a Task 5) =====
-- Anti-escalation: an actor only touches bits they hold in that channel (admins all), only targets strictly
-- below their top role position, and never the SuperAdmin / any is_system role.

create function public.set_overwrite(
  p_channel uuid, p_target_type text, p_target uuid, p_allow bigint, p_deny bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_admin boolean;
  v_top int;
  v_allow bigint := coalesce(p_allow, 0);
  v_deny bigint := coalesce(p_deny, 0);
  v_role public.roles;
  v_old_allow bigint := 0;
  v_old_deny bigint := 0;
  v_changed bigint;
begin
  -- same key as the role RPCs: role positions cannot move between the hierarchy check and the write
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;
  if p_channel is null or (public.channel_permissions(v_actor, p_channel) & 1) = 0 then
    raise exception 'forbidden';
  end if;
  if p_target is null or p_target_type is null or p_target_type not in ('role', 'member')
     or (v_allow | v_deny) < 0 or ((v_allow | v_deny) & ~31759::bigint) <> 0 or (v_allow & v_deny) <> 0 then
    raise exception 'invalid_input';
  end if;

  v_admin := (public.member_global_permissions(v_actor) & 512) <> 0;
  v_top := public.member_top_position(v_actor);

  if not v_admin and ((v_allow | v_deny) & ~public.channel_permissions(v_actor, p_channel)) <> 0 then
    raise exception 'forbidden';
  end if;

  -- Changing or deleting an existing row also touches its OLD bits: those must be held too.
  select o.allow, o.deny into v_old_allow, v_old_deny
  from public.permission_overwrites o
  where o.channel_id = p_channel and o.target_type = p_target_type and o.target_id = p_target
  for update;
  if not found then
    v_old_allow := 0;
    v_old_deny := 0;
  end if;
  v_changed := (v_old_allow # v_allow) | (v_old_deny # v_deny);
  if not v_admin and (v_changed & ~public.channel_permissions(v_actor, p_channel)) <> 0 then
    raise exception 'forbidden';
  end if;

  if p_target_type = 'role' then
    select * into v_role from public.roles r where r.id = p_target for key share;
    if not found then
      raise exception 'invalid_input';
    end if;
    if v_role.is_system then
      raise exception 'forbidden';
    end if;
    if not v_admin and v_role.position >= v_top then
      raise exception 'hierarchy';
    end if;
  else
    perform 1 from public.members m where m.id = p_target for key share;
    if not found then
      raise exception 'invalid_input';
    end if;
    if not v_admin and (p_target = v_actor or public.member_top_position(p_target) >= v_top) then
      raise exception 'hierarchy';
    end if;
  end if;

  if v_allow = 0 and v_deny = 0 then
    delete from public.permission_overwrites
    where channel_id = p_channel and target_type = p_target_type and target_id = p_target;
  else
    insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
    values (p_channel, p_target_type, p_target, v_allow, v_deny)
    on conflict (channel_id, target_type, target_id)
    do update set allow = excluded.allow, deny = excluded.deny;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'overwrite_set', 'channel', p_channel,
          jsonb_build_object('channel_id', p_channel, 'target_type', p_target_type, 'target_id', p_target,
                             'allow', v_allow, 'deny', v_deny));
end;
$$;

create function public.create_role(p_name text, p_color text, p_permissions bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_admin boolean;
  v_top int;
  v_name text := btrim(p_name);
  v_color text := upper(p_color);
  v_pos int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(64) then
    raise exception 'forbidden';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 32
     or v_color is null or v_color !~ '^#[0-9A-F]{6}$'
     or p_permissions is null or p_permissions < 0 or p_permissions > 65535 then
    raise exception 'invalid_input';
  end if;
  -- ADMINISTRATOR is reserved to the is_system SuperAdmin role
  if (p_permissions & 512) <> 0 then
    raise exception 'forbidden';
  end if;

  v_admin := (public.member_global_permissions(v_actor) & 512) <> 0;
  v_top := public.member_top_position(v_actor);
  if not v_admin and (p_permissions & ~public.member_global_permissions(v_actor)) <> 0 then
    raise exception 'hierarchy';
  end if;

  select coalesce(max(r.position), 0) + 1 into v_pos from public.roles r where r.position < v_top;
  if v_pos >= v_top then
    raise exception 'hierarchy';
  end if;

  begin
    insert into public.roles (name, color, position, permissions)
    values (v_name, v_color, v_pos, p_permissions)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'invalid_input';
  end;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'role_created', 'role', v_id,
          jsonb_build_object('name', v_name, 'color', v_color, 'permissions', p_permissions, 'position', v_pos));
  return v_id;
end;
$$;

create function public.update_role(p_role uuid, p_name text, p_color text, p_permissions bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_admin boolean;
  v_top int;
  v_role public.roles;
  v_name text := btrim(p_name);
  v_color text := upper(p_color);
begin
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(64) then
    raise exception 'forbidden';
  end if;
  if p_role is null then
    raise exception 'invalid_input';
  end if;

  select * into v_role from public.roles r where r.id = p_role for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if v_role.is_system then
    raise exception 'forbidden';
  end if;

  v_admin := (public.member_global_permissions(v_actor) & 512) <> 0;
  v_top := public.member_top_position(v_actor);
  if not v_admin and v_role.position >= v_top then
    raise exception 'hierarchy';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 32
     or v_color is null or v_color !~ '^#[0-9A-F]{6}$'
     or p_permissions is null or p_permissions < 0 or p_permissions > 65535 then
    raise exception 'invalid_input';
  end if;

  if v_role.is_everyone and (v_name <> v_role.name or v_color <> v_role.color) then
    raise exception 'forbidden';
  end if;
  if v_role.system_key is not null and v_name <> v_role.name then
    raise exception 'forbidden';
  end if;

  if (p_permissions & 512) <> 0 then
    raise exception 'forbidden';
  end if;

  if not v_admin then
    -- roles held by everyone (@everyone, system_key roles) never get global bits except CREATE_INVITES
    if (v_role.is_everyone or v_role.system_key is not null)
       and (p_permissions & ~(31759::bigint | 16)) <> 0 then
      raise exception 'forbidden';
    end if;
    -- only the bits that change must be held by the actor (untouched foreign bits are fine)
    if ((v_role.permissions # p_permissions) & ~public.member_global_permissions(v_actor)) <> 0 then
      raise exception 'hierarchy';
    end if;
  end if;

  begin
    update public.roles set name = v_name, color = v_color, permissions = p_permissions where id = p_role;
  exception when unique_violation then
    raise exception 'invalid_input';
  end;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'role_updated', 'role', p_role,
          jsonb_build_object('name', v_name, 'color', v_color, 'permissions', p_permissions,
                             'previous_permissions', v_role.permissions));
end;
$$;

create function public.delete_role(p_role uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_role public.roles;
begin
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(64) then
    raise exception 'forbidden';
  end if;
  if p_role is null then
    raise exception 'invalid_input';
  end if;

  select * into v_role from public.roles r where r.id = p_role for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if v_role.is_system or v_role.is_everyone or v_role.system_key is not null then
    raise exception 'forbidden';
  end if;
  if (public.member_global_permissions(v_actor) & 512) = 0
     and v_role.position >= public.member_top_position(v_actor) then
    raise exception 'hierarchy';
  end if;

  -- member_roles cascades by FK; overwrites by the roles_overwrites_cleanup trigger
  delete from public.roles where id = p_role;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'role_deleted', 'role', p_role,
          jsonb_build_object('name', v_role.name, 'position', v_role.position));
end;
$$;

create function public.move_role(p_role uuid, p_position int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_admin boolean;
  v_top int;
  v_role public.roles;
  v_end int;
begin
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(64) then
    raise exception 'forbidden';
  end if;
  if p_role is null or p_position is null then
    raise exception 'invalid_input';
  end if;

  select * into v_role from public.roles r where r.id = p_role for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if v_role.is_system or v_role.is_everyone then
    raise exception 'forbidden';
  end if;

  v_admin := (public.member_global_permissions(v_actor) & 512) <> 0;
  v_top := public.member_top_position(v_actor);
  if not v_admin and v_role.position >= v_top then
    raise exception 'hierarchy';
  end if;
  if p_position < 1 or p_position >= v_top then
    raise exception 'hierarchy';
  end if;

  -- Make room: shift only the contiguous run of occupied positions starting at the target slot.
  with recursive run(pos) as (
    select p_position
    where exists (select 1 from public.roles r
                  where r.position = p_position and r.id <> p_role and not r.is_everyone and not r.is_system)
    union all
    select run.pos + 1 from run
    where exists (select 1 from public.roles r
                  where r.position = run.pos + 1 and r.id <> p_role and not r.is_everyone and not r.is_system)
  )
  select max(pos) into v_end from run;

  if v_end is not null then
    if v_end + 1 >= v_top then
      raise exception 'hierarchy';
    end if;
    update public.roles r set position = r.position + 1
    where r.position between p_position and v_end and r.id <> p_role and not r.is_everyone and not r.is_system;
  end if;

  update public.roles set position = p_position where id = p_role;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'role_moved', 'role', p_role,
          jsonb_build_object('name', v_role.name, 'from_position', v_role.position, 'to_position', p_position));
end;
$$;

create table public.allowed_domains (
  domain text primary key check (domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'),
  added_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index allowed_domains_added_by_idx on public.allowed_domains (added_by);
alter table public.allowed_domains enable row level security;
revoke all on public.allowed_domains from anon;
revoke insert, update, delete, truncate on public.allowed_domains from authenticated;
create policy allowed_domains_select on public.allowed_domains
  for select to authenticated using (public.is_active_member());

insert into public.allowed_domains (domain) values
  ('lineascan.build'), ('sepolia.lineascan.build'), ('linea.build'), ('github.com'),
  ('x.com'), ('dexscreener.com'), ('etherscan.io');

create function public.add_allowed_domain(p_domain text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_domain text := lower(btrim(p_domain));
  v_rows int;
begin
  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;
  if v_domain is null or v_domain !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' or char_length(v_domain) > 253 then
    raise exception 'invalid_input';
  end if;

  insert into public.allowed_domains (domain, added_by) values (v_domain, v_actor)
  on conflict (domain) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    insert into public.audit_log (actor_member_id, action, target_type, payload)
    values (v_actor, 'domain_added', 'domain', jsonb_build_object('domain', v_domain));
  end if;
end;
$$;

create function public.remove_allowed_domain(p_domain text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_domain text := lower(btrim(p_domain));
  v_rows int;
begin
  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;
  if v_domain is null then
    raise exception 'invalid_input';
  end if;

  delete from public.allowed_domains where domain = v_domain;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    insert into public.audit_log (actor_member_id, action, target_type, payload)
    values (v_actor, 'domain_removed', 'domain', jsonb_build_object('domain', v_domain));
  end if;
end;
$$;

revoke execute on function
  public.set_overwrite(uuid, text, uuid, bigint, bigint),
  public.create_role(text, text, bigint),
  public.update_role(uuid, text, text, bigint),
  public.delete_role(uuid),
  public.move_role(uuid, int),
  public.add_allowed_domain(text),
  public.remove_allowed_domain(text)
from public, anon;
grant execute on function
  public.set_overwrite(uuid, text, uuid, bigint, bigint),
  public.create_role(text, text, bigint),
  public.update_role(uuid, text, text, bigint),
  public.delete_role(uuid),
  public.move_role(uuid, int),
  public.add_allowed_domain(text),
  public.remove_allowed_domain(text)
to authenticated;
