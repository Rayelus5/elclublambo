-- F2a final-review hardening.

-- 5. Padrino gets a stable identity (name stays locked by the system_key rules in update_role).
update public.roles set system_key = 'sponsor' where name = 'Padrino' and system_key is null;

-- 2. An override can never grant ADMINISTRATOR (bit 512).
update public.member_permission_overrides set allow = allow & ~512::bigint where (allow & 512) <> 0;
alter table public.member_permission_overrides
  add constraint member_permission_overrides_no_admin_allow check ((allow & 512) = 0);

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
    return 65535;
  end if;

  select o.allow, o.deny
    into v_allow, v_deny
  from public.member_permission_overrides o
  where o.member_id = p_member;

  -- 33264 = GLOBAL_MASK 33776 & ~512: an override never grants channel bits nor ADMINISTRATOR
  return (v_base & ~coalesce(v_deny, 0)) | (coalesce(v_allow, 0) & 33264);
end;
$$;

-- 1. member-safe mass grants (mask 11287), 4. system_key roles are not movable.
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
    -- mass-grant guard: roles held by (nearly) everyone only take member-safe allows from non-admins
    if not v_admin and (v_role.is_everyone or v_role.system_key is not null)
       and (v_allow & ~11287::bigint) <> 0 then
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
    -- roles held by everyone (@everyone, system_key roles) only take the member-safe mask:
    -- VIEW 1 | SEND 2 | SEND_IN_THREADS 4 | CREATE_INVITES 16 | ATTACH 1024 | EMBED 2048 | ADD_REACTIONS 8192
    if (v_role.is_everyone or v_role.system_key is not null)
       and (p_permissions & ~11287::bigint) <> 0 then
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

create or replace function public.move_role(p_role uuid, p_position int)
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
  if v_role.is_system or v_role.is_everyone or v_role.system_key is not null then
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

-- 3 + 5. set_member_role: tree lock first, only active targets, Verificado only via set_verified.
create or replace function public.set_member_role(p_member uuid, p_role uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_role public.roles;
  v_target public.members;
  v_actor_top int;
begin
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null
     or not public.is_active_member()
     or not public.has_global_perm(64) then
    raise exception 'forbidden';
  end if;

  if p_member is null or p_role is null or p_enabled is null then
    raise exception 'invalid_input';
  end if;

  select * into v_role from public.roles r where r.id = p_role;
  if not found then
    raise exception 'invalid_input';
  end if;

  select * into v_target from public.members m where m.id = p_member for update;
  if not found then
    raise exception 'invalid_input';
  end if;

  if v_role.is_everyone or v_role.is_system or v_role.system_key = 'verified' then
    raise exception 'forbidden';
  end if;
  if v_target.status <> 'active' then
    raise exception 'invalid_input';
  end if;

  v_actor_top := public.member_top_position(v_actor);
  if v_role.position >= v_actor_top
     or (v_role.permissions & ~public.member_global_permissions(v_actor)) <> 0
     or public.member_top_position(v_target.id) >= v_actor_top then
    raise exception 'hierarchy';
  end if;

  if p_enabled then
    insert into public.member_roles (member_id, role_id)
    values (v_target.id, v_role.id)
    on conflict do nothing;
  else
    delete from public.member_roles where member_id = v_target.id and role_id = v_role.id;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'member_role_set', 'member', v_target.id,
          jsonb_build_object('role_id', v_role.id, 'enabled', p_enabled));
end;
$$;

-- 6. the one-off data migration already ran.
drop function public._backfill_verified();

-- 7. Writes only go through RPCs: drop the default table-level write grants (RLS had no write policies anyway).
-- members keeps its column-level UPDATE (display_name, avatar_path).
revoke insert, update, delete on all tables in schema public from authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from authenticated;
grant update (display_name, avatar_path) on public.members to authenticated;
