-- Member card (click a name in the chat) and the channel member list with online status in the right rail.
--
-- Presence is server-authoritative: the browser calls touch_presence() about once a minute and the server stamps
-- last_seen_at for the session's own member (no client-supplied identity, unlike Realtime Presence where any client
-- could claim to be anyone). "Online" = seen in the last 3 minutes. Every active member can see who is online, as in
-- any chat community.

alter table public.members add column last_seen_at timestamptz;

create function public._is_online(p_seen timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_seen is not null and p_seen > now() - interval '3 minutes'
$$;

-- ===== heartbeat (throttled to one write per 30 s per member) =====
create function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() then
    return;
  end if;
  update public.members
  set last_seen_at = now()
  where id = v_me and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
end;
$$;

-- ===== the card shown when a member's name is clicked =====
create function public.member_card(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.members;
  v_roles jsonb;
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select * into v from public.members m where m.id = p_member;
  if not found then
    raise exception 'not_found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'color', r.color) order by r.position desc), '[]'::jsonb)
    into v_roles
  from public.member_roles mr join public.roles r on r.id = mr.role_id
  where mr.member_id = p_member and not r.is_everyone;
  return jsonb_build_object(
    'id', v.id,
    'handle', v.handle,
    'displayName', v.display_name,
    'walletAddress', v.wallet_address,
    'avatarPath', v.avatar_path,
    'bio', left(v.bio, 280),
    'status', v.status,
    'joinedAt', v.created_at,
    'online', v.status = 'active' and public._is_online(v.last_seen_at),
    'roles', v_roles
  );
end;
$$;

-- ===== members who can view a channel, online first, with the colour of their highest coloured role =====
create function public.channel_members(p_channel uuid, p_limit int default 300)
returns table (member_id uuid, handle text, display_name text, wallet_address text, avatar_path text, online boolean,
               role_color text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_channel is null or not public.can_view(p_channel) then
    raise exception 'not_found';
  end if;
  return query
    select m.id, m.handle::text, m.display_name, m.wallet_address, m.avatar_path, public._is_online(m.last_seen_at),
           (select r.color from public.member_roles mr join public.roles r on r.id = mr.role_id
            where mr.member_id = m.id and not r.is_everyone order by r.position desc limit 1)
    from public.members m
    where m.status = 'active' and (public.channel_permissions(m.id, p_channel) & 1) <> 0
    order by public._is_online(m.last_seen_at) desc, lower(coalesce(m.display_name, m.handle::text, m.wallet_address))
    limit greatest(1, least(500, coalesce(p_limit, 300)));
end;
$$;

-- channel_overview keeps name/topic; the member list above replaces its count (one permission walk instead of two)
create or replace function public.channel_overview(p_channel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_topic text;
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_channel is null or not public.can_view(p_channel) then
    raise exception 'not_found';
  end if;
  select c.name, c.topic into v_name, v_topic from public.channels c where c.id = p_channel;
  return jsonb_build_object('name', v_name, 'topic', v_topic);
end;
$$;

revoke execute on function public._is_online(timestamptz), public.touch_presence(), public.member_card(uuid),
  public.channel_members(uuid, int) from public, anon;
revoke execute on function public._is_online(timestamptz) from authenticated, service_role;
grant execute on function public.touch_presence(), public.member_card(uuid), public.channel_members(uuid, int) to authenticated;
