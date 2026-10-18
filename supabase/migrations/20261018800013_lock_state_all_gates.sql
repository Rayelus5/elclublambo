-- F3d Task 5 (folded fix from the Task 2 review): channel_lock_state reports EVERY failing gate of the scope on the
-- path to the channel, not only the outermost one. Otherwise a donation that satisfies the outer gate would leave the
-- member locked by an inner gate the lock page never mentioned.
--
-- Shape: the existing top-level fields (scope, minShareBps, minNetUsdc, ...) are kept and keep describing the
-- OUTERMOST failing gate (the first entry of `requirements`), so older readers still work. `requirements` is the full
-- list, outermost first: [{ channelId, scope, minShareBps, minNetUsdc }]. A member passes the channel only when they
-- satisfy all of them (each gate is "share OR net"; gates on the path are ANDed by the permission walk).
-- Nothing new is revealed: the ancestors' gates are on the path of a channel the member would see but for a gate.

create function public._channel_failing_gates(p_member uuid, p_channel uuid, p_scope text)
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
$$;

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
  v_share int;
  v_net numeric;
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

  select jsonb_agg(jsonb_build_object('channelId', g.channel_id, 'scope', v_scope,
                                      'minShareBps', g.min_share_bps, 'minNetUsdc', g.min_net_usdc) order by g.ord),
         (array_agg(g.min_share_bps order by g.ord))[1],
         (array_agg(g.min_net_usdc order by g.ord))[1]
    into v_reqs, v_share, v_net
  from public._channel_failing_gates(v_me, p_channel, v_scope) with ordinality as g(channel_id, min_share_bps, min_net_usdc, ord);
  if v_reqs is null then
    return null;
  end if;
  select * into v_st from public._member_dao_standing(v_me);

  return jsonb_build_object(
    'scope', v_scope,
    'minShareBps', v_share,
    'minNetUsdc', v_net,
    'myShareBps', coalesce(v_st.share_bps, 0),
    'myNet', coalesce(v_st.net_usdc, 0),
    'chainId', v_st.chain_id,
    'name', v_ch.name,
    'kind', v_ch.kind,
    'parentId', v_ch.parent_id,
    'requirements', v_reqs
  );
end;
$$;

revoke execute on function public._channel_failing_gates(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.channel_lock_state(uuid) from public, anon;
grant execute on function public.channel_lock_state(uuid) to authenticated, service_role;
