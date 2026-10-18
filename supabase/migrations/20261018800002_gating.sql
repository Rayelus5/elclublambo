-- F3d Task 2: real DAO gating (two OR-ed rules), lock state for visible-but-locked channels, gate admin RPC.
-- gate_mode/gate_value become gate_min_share_bps / gate_min_net_usdc (a gate is active when either is set;
-- it passes when share_bps >= min_share OR net >= min_net, read from the ACTIVE chain's ledger).
-- channel_permissions keeps its contract; its body moves into _channel_permissions_core with a flag that
-- ignores view-gates, which is what lock state needs ("would see it, were it not for the gate").
-- Lock-state functions reveal only id/parent/kind/name/position and the requirement, never content, and only for
-- channels the member could see except for a view-gate. Channel bits stay: CHANNEL_MASK 97295, ALL_PERMS 131071.

-- ===== schema =====
alter table public.channels
  add column gate_min_share_bps int check (gate_min_share_bps between 0 and 10000),
  add column gate_min_net_usdc numeric(78, 0) check (gate_min_net_usdc >= 0);

update public.channels
set gate_min_share_bps = least(10000, floor(gate_value))::int
where gate_mode = 'min_share_bps' and gate_value is not null;

update public.channels
set gate_min_net_usdc = floor(gate_value)
where gate_mode = 'min_net_usdc' and gate_value is not null;

-- dropping the columns also drops the check constraints that reference them
alter table public.channels drop column gate_mode, drop column gate_value;

-- ===== standing of a member on the active chain (internal) =====
create function public._member_dao_standing(p_member uuid)
returns table (chain_id int, share_bps int, net_usdc numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (c.value #>> '{}')::int as chain from public.app_config c where c.key = 'active_chain_id'
  )
  select cfg.chain,
         case when coalesce(s.total_shares, 0) = 0 then 0
              else floor(coalesce(p.shares, 0) * 10000 / s.total_shares)::int end,
         coalesce(p.net_contributed_usdc, 0)
  from cfg
  left join public.dao_state s on s.chain_id = cfg.chain
  left join public.dao_positions p on p.chain_id = cfg.chain and p.member_id = p_member
$$;

-- ===== gate_passes: the real body =====
create or replace function public.gate_passes(p_member uuid, p_channel uuid, p_scope text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ch public.channels;
  v_share int;
  v_net numeric;
begin
  select * into v_ch from public.channels c where c.id = p_channel;
  if not found
     or (v_ch.gate_min_share_bps is null and v_ch.gate_min_net_usdc is null)
     or v_ch.gate_scope is distinct from p_scope then
    return true;
  end if;

  select st.share_bps, st.net_usdc into v_share, v_net from public._member_dao_standing(p_member) st;

  return (v_ch.gate_min_share_bps is not null and coalesce(v_share, 0) >= v_ch.gate_min_share_bps)
      or (v_ch.gate_min_net_usdc is not null and coalesce(v_net, 0) >= v_ch.gate_min_net_usdc);
end;
$$;

-- ===== core permission walk (latest body = 20261018700001, plus the view-gate flag) =====
-- p_ignore_post_gate exists only so lock state can tell whether a post-gate is what removes SEND.
create function public._channel_permissions_walk(
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
  v_gate_mask bigint := 131071;
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
    return 97295;
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
        v_gate_mask := v_gate_mask & ~97295;
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
  return v_p & v_gate_mask & 97295;
end;
$$;

create function public._channel_permissions_core(p_member uuid, p_channel uuid, p_ignore_view_gate boolean)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public._channel_permissions_walk(p_member, p_channel, p_ignore_view_gate, false)
$$;

create or replace function public.channel_permissions(p_member uuid, p_channel uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public._channel_permissions_core(p_member, p_channel, false)
$$;

-- ===== outermost failing gate of a scope on the path to a channel (internal) =====
create function public._channel_failing_gate(p_member uuid, p_channel uuid, p_scope text)
returns table (channel_id uuid, min_share_bps int, min_net_usdc numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive a as (
    select c.id, c.parent_id, 1 as depth, c.gate_min_share_bps, c.gate_min_net_usdc, c.gate_scope
    from public.channels c where c.id = p_channel
    union all
    select c.id, c.parent_id, a.depth + 1, c.gate_min_share_bps, c.gate_min_net_usdc, c.gate_scope
    from public.channels c join a on c.id = a.parent_id
  ) cycle id set is_cycle using walk
  select a.id, a.gate_min_share_bps, a.gate_min_net_usdc
  from a
  where not a.is_cycle
    and a.gate_scope = p_scope
    and (a.gate_min_share_bps is not null or a.gate_min_net_usdc is not null)
    and not public.gate_passes(p_member, a.id, a.gate_scope)
  order by a.depth desc
  limit 1
$$;

-- ===== lock state of one channel, for its lock page =====
-- null unless the caller would see the channel but for a view-gate they fail, or sees it but fails a post-gate.
-- Only name, kind and parent of the channel itself are returned, plus the requirement and the caller's standing.
create function public.channel_lock_state(p_channel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_ch public.channels;
  v_full bigint;
  v_nogate bigint;
  v_scope text;
  v_gate record;
  v_st record;
begin
  if v_me is null or not public.is_active_member() or p_channel is null then
    return null;
  end if;
  select * into v_ch from public.channels c where c.id = p_channel;
  if not found then
    return null;
  end if;

  v_full := public._channel_permissions_core(v_me, p_channel, false);
  v_nogate := public._channel_permissions_walk(v_me, p_channel, true, true);
  if (v_nogate & 1) = 0 then
    return null; -- not visible even without the gate: its existence is not revealed
  end if;
  if (v_full & 1) = 0 then
    v_scope := 'view';
  elsif (v_nogate & ~v_full & 6) <> 0 then
    v_scope := 'post';
  else
    return null;
  end if;

  select * into v_gate from public._channel_failing_gate(v_me, p_channel, v_scope);
  if not found then
    return null;
  end if;
  select * into v_st from public._member_dao_standing(v_me);

  return jsonb_build_object(
    'scope', v_scope,
    'minShareBps', v_gate.min_share_bps,
    'minNetUsdc', v_gate.min_net_usdc,
    'myShareBps', coalesce(v_st.share_bps, 0),
    'myNet', coalesce(v_st.net_usdc, 0),
    'chainId', v_st.chain_id,
    'name', v_ch.name,
    'kind', v_ch.kind,
    'parentId', v_ch.parent_id
  );
end;
$$;

-- ===== channels the caller sees locked by a view-gate (sidebar) =====
create function public.locked_channels()
returns table (id uuid, parent_id uuid, kind text, name text, "position" int, scope text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.parent_id, c.kind, c.name, c.position, 'view'::text
  from public.channels c
  where public.is_active_member()
    and (public._channel_permissions_core(public.current_member_id(), c.id, true) & 1) <> 0
    and (public._channel_permissions_core(public.current_member_id(), c.id, false) & 1) = 0
  order by c.position, c.created_at
$$;

-- ===== gate admin RPC =====
-- Both nulls clear the rules. A null scope keeps the channel's current one.
create function public.set_channel_gate(p_channel uuid, p_min_share_bps int, p_min_net_usdc numeric, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_node public.channels;
  v_scope text;
begin
  perform pg_advisory_xact_lock(hashtext('public.channels_tree'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;
  if p_channel is null
     or (p_min_share_bps is not null and p_min_share_bps not between 0 and 10000)
     or (p_min_net_usdc is not null and (p_min_net_usdc < 0 or p_min_net_usdc <> trunc(p_min_net_usdc)
                                         or p_min_net_usdc > 1000000000000000000000000000000::numeric))
     or (p_scope is not null and p_scope not in ('view', 'post')) then
    raise exception 'invalid_input';
  end if;

  select * into v_node from public.channels c where c.id = p_channel for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  -- cannot act on what you cannot see
  if (public.channel_permissions(v_actor, p_channel) & 1) = 0 then
    raise exception 'forbidden';
  end if;

  v_scope := coalesce(p_scope, v_node.gate_scope);

  update public.channels
  set gate_min_share_bps = p_min_share_bps,
      gate_min_net_usdc = p_min_net_usdc,
      gate_scope = v_scope
  where id = p_channel;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_gate_set', 'channel', p_channel,
          jsonb_build_object('channel_id', p_channel, 'minShareBps', p_min_share_bps, 'minNetUsdc', p_min_net_usdc,
                             'scope', v_scope,
                             'previous', jsonb_build_object('minShareBps', v_node.gate_min_share_bps,
                                                            'minNetUsdc', v_node.gate_min_net_usdc,
                                                            'scope', v_node.gate_scope)));
end;
$$;

-- ===== grants =====
revoke execute on function
  public._member_dao_standing(uuid),
  public._channel_permissions_core(uuid, uuid, boolean),
  public._channel_permissions_walk(uuid, uuid, boolean, boolean),
  public._channel_failing_gate(uuid, uuid, text),
  public.channel_lock_state(uuid),
  public.locked_channels(),
  public.set_channel_gate(uuid, int, numeric, text)
from public, anon;

revoke execute on function
  public._member_dao_standing(uuid),
  public._channel_permissions_core(uuid, uuid, boolean),
  public._channel_permissions_walk(uuid, uuid, boolean, boolean),
  public._channel_failing_gate(uuid, uuid, text)
from authenticated;

grant execute on function
  public.channel_lock_state(uuid),
  public.locked_channels(),
  public.set_channel_gate(uuid, int, numeric, text)
to authenticated, service_role;
