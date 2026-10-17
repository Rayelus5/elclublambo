-- F2a cascading channel permissions (Discord-style) + read policies for the channel tree.
-- TS mirror: src/lib/permissions/channel.ts (computeChannelPermissions). Parity is proven with
-- tests/fixtures/channel-permissions.json. Constants: CHANNEL_MASK 31759, GLOBAL_MASK 33776, ALL 65535.
-- channel_permissions returns CHANNEL bits only (every return is masked with 31759; admin -> 31759).
-- Global bits come from has_global_perm / my_permissions.

-- DAO gating hook. F3 replaces the body; until then nothing is gated.
create function public.gate_passes(p_member uuid, p_channel uuid, p_scope text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- F3: DAO gating
  return true;
end;
$$;

-- Effective permissions of p_member on p_channel.
create function public.channel_permissions(p_member uuid, p_channel uuid)
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
  v_gate_mask bigint := 65535;
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
    return 31759;
  end if;

  v_p := v_base;

  -- Path root -> channel. CYCLE guards a corrupt tree against infinite recursion.
  for v_node in
    with recursive a as (
      select c.id, c.parent_id, 1 as depth, c.gate_mode, c.gate_scope
      from public.channels c where c.id = p_channel
      union all
      select c.id, c.parent_id, a.depth + 1, c.gate_mode, c.gate_scope
      from public.channels c join a on c.id = a.parent_id
    ) cycle id set is_cycle using walk
    select a.id, a.depth, a.gate_mode, a.gate_scope
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
    if v_node.gate_mode <> 'none' and not public.gate_passes(p_member, v_node.id, v_node.gate_scope) then
      if v_node.gate_scope = 'view' then
        v_gate_mask := v_gate_mask & ~31759;
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
  return v_p & v_gate_mask & 31759;
end;
$$;

-- Permissions of the current member on a channel (0 if not an active member).
create function public.my_channel_permissions(p_channel uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.channel_permissions(m.id, p_channel)
     from public.members m
     where m.auth_user_id = auth.uid() and m.status = 'active'),
    0
  )
$$;

-- Current member helpers
create function public.can(p_channel uuid, p_bit bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_bit > 0 and coalesce(
    (select (public.channel_permissions(m.id, p_channel) & p_bit) = p_bit
     from public.members m
     where m.auth_user_id = auth.uid() and m.status = 'active'),
    false
  )
$$;

create function public.can_view(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can(p_channel, 1)
$$;

create function public.visible_channels()
returns setof public.channels
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.channels c where public.can_view(c.id) order by c.position, c.created_at
$$;

revoke execute on function
  public.gate_passes(uuid, uuid, text),
  public.channel_permissions(uuid, uuid),
  public.can(uuid, bigint),
  public.can_view(uuid),
  public.visible_channels(),
  public.my_channel_permissions(uuid)
from public, anon;

-- Internal: no information oracle about other members' permissions for API users.
revoke execute on function
  public.gate_passes(uuid, uuid, text),
  public.channel_permissions(uuid, uuid),
  public.member_global_permissions(uuid),
  public.member_top_position(uuid)
from authenticated;

grant execute on function
  public.my_channel_permissions(uuid),
  public.can(uuid, bigint),
  public.can_view(uuid),
  public.visible_channels()
to authenticated;
grant execute on function public.channel_permissions(uuid, uuid) to service_role;

-- Read policies (writes only through RPCs)
create policy channels_select on public.channels
  for select to authenticated using (public.can_view(id));
create policy permission_overwrites_select on public.permission_overwrites
  for select to authenticated using (public.has_global_perm(128) and public.can_view(channel_id));
