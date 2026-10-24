-- P1 Task 7 (P1-R4, D8): channel gates by what the member has donated.
--   - A channel gate is now ONE rule: channels.gate_min_donated_usd6. It is active when not null and passes when the
--     member's total in public.donations (usd6) is >= it. gate_scope ('view' | 'post') is unchanged.
--   - gate_min_share_bps / gate_min_net_usdc stay in the table but are ignored and set to null.
--   - gate_passes, _channel_failing_gates, channel_lock_state and set_channel_gate are redefined from their latest
--     bodies (20261018800002 / 20261018800013). _channel_permissions_walk is redefined from 20261019500001 because its
--     "is there a gate" guard read the old columns; only that guard and the columns it selects change.
--   - Money values travel as text in jsonb (numeric(78,0)).

-- ===== schema =====
alter table public.channels
  add column gate_min_donated_usd6 numeric(78, 0) check (gate_min_donated_usd6 >= 0);

update public.channels set gate_min_share_bps = null, gate_min_net_usdc = null
where gate_min_share_bps is not null or gate_min_net_usdc is not null;

-- ===== what a member has donated (internal) =====
create function public._member_donated_usd6(p_member uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(d.usd6), 0) from public.donations d where d.member_id = p_member
$$;

-- ===== gate_passes (latest: 20261018800002) =====
create or replace function public.gate_passes(p_member uuid, p_channel uuid, p_scope text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ch public.channels;
begin
  select * into v_ch from public.channels c where c.id = p_channel;
  if not found
     or v_ch.gate_min_donated_usd6 is null
     or v_ch.gate_scope is distinct from p_scope then
    return true;
  end if;
  return public._member_donated_usd6(p_member) >= v_ch.gate_min_donated_usd6;
end;
$$;

-- ===== permission walk (latest: 20261019500001; only the gate guard and its columns change) =====
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
      select c.id, c.parent_id, 1 as depth, c.gate_min_donated_usd6, c.gate_scope
      from public.channels c where c.id = p_channel
      union all
      select c.id, c.parent_id, a.depth + 1, c.gate_min_donated_usd6, c.gate_scope
      from public.channels c join a on c.id = a.parent_id
    ) cycle id set is_cycle using walk
    select a.id, a.depth, a.gate_min_donated_usd6, a.gate_scope
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

    -- Donation gate hook (masks accumulate; applied after the penalty)
    if v_node.gate_min_donated_usd6 is not null
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

-- ===== failing gates on the path (latest: 20261018800013) =====
drop function public._channel_failing_gates(uuid, uuid, text);
create function public._channel_failing_gates(p_member uuid, p_channel uuid, p_scope text)
returns table (channel_id uuid, min_donated_usd6 numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive a as (
    select c.id, c.parent_id, 1 as depth, c.gate_min_donated_usd6, c.gate_scope
    from public.channels c where c.id = p_channel
    union all
    select c.id, c.parent_id, a.depth + 1, c.gate_min_donated_usd6, c.gate_scope
    from public.channels c join a on c.id = a.parent_id
  ) cycle id set is_cycle using walk
  select a.id, a.gate_min_donated_usd6
  from a
  where not a.is_cycle
    and a.gate_scope = p_scope
    and a.gate_min_donated_usd6 is not null
    and not public.gate_passes(p_member, a.id, a.gate_scope)
  order by a.depth desc
$$;

-- ===== lock state (latest: 20261018800013) =====
-- Top-level minDonatedUsd6 describes the outermost failing gate; requirements lists all of them, outermost first.
create or replace function public.channel_lock_state(p_channel uuid)
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
  v_reqs jsonb;
  v_min numeric;
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

  select jsonb_agg(jsonb_build_object('channelId', g.channel_id, 'scope', v_scope,
                                      'minDonatedUsd6', g.min_donated_usd6::text) order by g.ord),
         (array_agg(g.min_donated_usd6 order by g.ord))[1]
    into v_reqs, v_min
  from public._channel_failing_gates(v_me, p_channel, v_scope) with ordinality as g(channel_id, min_donated_usd6, ord);
  if v_reqs is null then
    return null;
  end if;

  return jsonb_build_object(
    'scope', v_scope,
    'minDonatedUsd6', v_min::text,
    'myDonatedUsd6', public._member_donated_usd6(v_me)::text,
    'name', v_ch.name,
    'kind', v_ch.kind,
    'parentId', v_ch.parent_id,
    'requirements', v_reqs
  );
end;
$$;

-- ===== gate admin RPC (latest: 20261018800002; the 4-argument signature is gone) =====
-- A null amount clears the rule. A null scope keeps the channel's current one.
drop function public.set_channel_gate(uuid, int, numeric, text);
create function public.set_channel_gate(p_channel uuid, p_min_donated_usd6 numeric, p_scope text)
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
     or (p_min_donated_usd6 is not null and (p_min_donated_usd6 < 0 or p_min_donated_usd6 <> trunc(p_min_donated_usd6)
                                             or p_min_donated_usd6 > 1000000000000000000000000000000::numeric))
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
  set gate_min_donated_usd6 = p_min_donated_usd6,
      gate_min_share_bps = null,
      gate_min_net_usdc = null,
      gate_scope = v_scope
  where id = p_channel;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_gate_set', 'channel', p_channel,
          jsonb_build_object('channel_id', p_channel, 'minDonatedUsd6', p_min_donated_usd6::text,
                             'scope', v_scope,
                             'previous', jsonb_build_object('minDonatedUsd6', v_node.gate_min_donated_usd6::text,
                                                            'scope', v_node.gate_scope)));
end;
$$;

-- ===== grants =====
revoke execute on function public._member_donated_usd6(uuid) from public, anon, authenticated;
revoke execute on function public._channel_failing_gates(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.channel_lock_state(uuid) from public, anon;
grant execute on function public.channel_lock_state(uuid) to authenticated, service_role;
revoke execute on function public.set_channel_gate(uuid, numeric, text) from public, anon;
grant execute on function public.set_channel_gate(uuid, numeric, text) to authenticated, service_role;
