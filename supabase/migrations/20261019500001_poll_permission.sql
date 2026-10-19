-- F4e Task 1: CREATE_POLLS channel bit (131072), labelled "Crear encuestas".
-- CHANNEL_MASK 97295 -> 228367 (97295 | 131072), ALL_PERMS 131071 -> 262143, member-safe mask 76823 -> 207895
-- (76823 | 131072). GLOBAL_MASK (33776) and the override global mask (33264) do not change: the new bit is a channel bit.
-- Creating polls is not a moderation power, so non-admin delegates may grant it to @everyone and system_key roles;
-- they still need to hold it themselves (set_overwrite / update_role only let a non-admin touch bits they hold).
-- Every function below is redefined from its latest body (_channel_permissions_walk: 20261018800002_gating;
-- the rest: 20261018700001_bounty_permission); only the mask literals change. channel_permissions itself is a thin
-- wrapper over _channel_permissions_core -> _channel_permissions_walk, so it needs no change.

-- Default grant (spec 12): Verificado and Moderador can create polls.
update public.roles set permissions = permissions | 131072 where system_key = 'verified' or name = 'Moderador';

-- Channel overwrites may now carry bit 131072.
alter table public.permission_overwrites drop constraint permission_overwrites_allow_check;
alter table public.permission_overwrites drop constraint permission_overwrites_deny_check;
alter table public.permission_overwrites
  add constraint permission_overwrites_allow_check check ((allow & ~228367::bigint) = 0);
alter table public.permission_overwrites
  add constraint permission_overwrites_deny_check check ((deny & ~228367::bigint) = 0);

create or replace function public._channel_permissions_walk(
  p_member uuid, p_channel uuid, p_ignore_view_gate boolean, p_ignore_post_gate boolean
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_everyone uuid;
  v_base bigint;
  v_p bigint;
  v_allow bigint;
  v_deny bigint;
  v_pen_deny bigint;
  v_gate_mask bigint := 262143;
  v_node record;
begin
  select m.status into v_status from public.members m where m.id = p_member;
  if v_status is distinct from 'active' then
    return 0;
  end if;
  if not exists (select 1 from public.channels c where c.id = p_channel) then
    return 0;
  end if;

  select r.id into v_everyone from public.roles r where r.is_everyone;

  select coalesce(bit_or(r.permissions), 0)
    into v_base
  from public.roles r
  where r.is_everyone
     or r.id in (select mr.role_id from public.member_roles mr where mr.member_id = p_member);

  if (v_base & 512) <> 0 then
    return 228367;
  end if;

  v_p := v_base;

  -- Path root -> channel. CYCLE guards a corrupt tree against infinite recursion.
  for v_node in
    with recursive a as (
      select c.id, c.parent_id, 1 as depth, c.gate_min_share_bps, c.gate_min_net_usdc, c.gate_scope
      from public.channels c where c.id = p_channel
      union all
      select c.id, c.parent_id, a.depth + 1, c.gate_min_share_bps, c.gate_min_net_usdc, c.gate_scope
      from public.channels c join a on c.id = a.parent_id
    ) cycle id set is_cycle using walk
    select a.id, a.depth, a.gate_min_share_bps, a.gate_min_net_usdc, a.gate_scope
    from a where not a.is_cycle
    order by a.depth desc
  loop
    -- 1. @everyone overwrite
    select o.allow, o.deny into v_allow, v_deny
    from public.permission_overwrites o
    where o.channel_id = v_node.id and o.target_type = 'role' and o.target_id = v_everyone;
    if found then
      v_p := (v_p & ~v_deny) | v_allow;
    end if;

    -- 2. overwrites of the member's other roles: all denies, then all allows
    select coalesce(bit_or(o.allow), 0), coalesce(bit_or(o.deny), 0) into v_allow, v_deny
    from public.permission_overwrites o
    where o.channel_id = v_node.id
      and o.target_type = 'role'
      and o.target_id is distinct from v_everyone
      and o.target_id in (select mr.role_id from public.member_roles mr where mr.member_id = p_member);
    v_p := (v_p & ~v_deny) | v_allow;

    -- 3. member overwrite
    select o.allow, o.deny into v_allow, v_deny
    from public.permission_overwrites o
    where o.channel_id = v_node.id and o.target_type = 'member' and o.target_id = p_member;
    if found then
      v_p := (v_p & ~v_deny) | v_allow;
    end if;

    -- 4. hidden node hides its whole subtree (channel bits only -> nothing)
    if (v_p & 1) = 0 then
      return 0;
    end if;

    -- DAO gate hook (masks accumulate; applied after the penalty)
    if (v_node.gate_min_share_bps is not null or v_node.gate_min_net_usdc is not null)
       and not (p_ignore_view_gate and v_node.gate_scope = 'view')
       and not (p_ignore_post_gate and v_node.gate_scope = 'post')
       and not public.gate_passes(p_member, v_node.id, v_node.gate_scope) then
      if v_node.gate_scope = 'view' then
        v_gate_mask := v_gate_mask & ~228367;
      else
        v_gate_mask := v_gate_mask & ~6;
      end if;
    end if;
  end loop;

  -- 5. penalty: only its deny applies at channel level (its allow never adds channel bits)
  select o.deny into v_pen_deny from public.member_permission_overrides o where o.member_id = p_member;
  v_p := v_p & ~coalesce(v_pen_deny, 0);
  if (v_p & 1) = 0 then
    return 0;
  end if;

  -- 6. DAO gating
  return v_p & v_gate_mask & 228367;
end;
$$;

create or replace function public.member_global_permissions(p_member uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base bigint;
  v_allow bigint;
  v_deny bigint;
begin
  select coalesce(bit_or(r.permissions), 0)
    into v_base
  from public.roles r
  where r.is_everyone
     or r.id in (select mr.role_id from public.member_roles mr where mr.member_id = p_member);

  if (v_base & 512) <> 0 then
    return 262143;
  end if;

  select o.allow, o.deny
    into v_allow, v_deny
  from public.member_permission_overrides o
  where o.member_id = p_member;

  -- 33264 = GLOBAL_MASK 33776 & ~512: an override never grants channel bits nor ADMINISTRATOR
  return (v_base & ~coalesce(v_deny, 0)) | (coalesce(v_allow, 0) & 33264);
end;
$$;

create or replace function public.can(p_channel uuid, p_bit bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bit is not null and (p_bit & ~228367::bigint) <> 0 then
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

create or replace function public.has_any_channel_perm(p_bit bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bit is null or p_bit <= 0 or (p_bit & ~228367::bigint) <> 0 then
    raise exception 'invalid_input';
  end if;
  return exists (select 1 from public.visible_channels() v where public.can(v.id, p_bit));
end;
$$;

create or replace function public.set_overwrite(
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
     or (v_allow | v_deny) < 0 or ((v_allow | v_deny) & ~228367::bigint) <> 0 or (v_allow & v_deny) <> 0 then
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
    -- mass-grant guard: roles held by (nearly) everyone only take member-safe allows from non-admins
    if not v_admin and (v_role.is_everyone or v_role.system_key is not null)
       and (v_allow & ~207895::bigint) <> 0 then
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

create or replace function public.create_role(p_name text, p_color text, p_permissions bigint)
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
     or p_permissions is null or p_permissions < 0 or p_permissions > 262143 then
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

create or replace function public.update_role(p_role uuid, p_name text, p_color text, p_permissions bigint)
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
     or p_permissions is null or p_permissions < 0 or p_permissions > 262143 then
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
    -- roles held by everyone (@everyone, system_key roles) only take the member-safe mask:
    -- VIEW 1 | SEND 2 | SEND_IN_THREADS 4 | CREATE_INVITES 16 | ATTACH 1024 | EMBED 2048 | ADD_REACTIONS 8192 | CREATE_BOUNTIES 65536 | CREATE_POLLS 131072
    if (v_role.is_everyone or v_role.system_key is not null)
       and (p_permissions & ~207895::bigint) <> 0 then
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
