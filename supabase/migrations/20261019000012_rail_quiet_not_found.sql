-- The right rail on a channel the member cannot view (a DAO-locked channel shows its lock page) asked for the channel's
-- overview and members, and both raised not_found: a 400 in the browser console and an error in the rail. They now
-- answer null / no rows, and the rail falls back to the club activity. Same information (nothing), no error.

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
  -- a channel the caller cannot view (missing, hidden or DAO-locked) reads as null: the rail shows the activity
  if p_channel is null or not public.can_view(p_channel) then
    return null;
  end if;
  select c.name, c.topic into v_name, v_topic from public.channels c where c.id = p_channel;
  return jsonb_build_object('name', v_name, 'topic', v_topic);
end;
$$;

create or replace function public.channel_members(p_channel uuid, p_limit int default 300)
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
  -- a channel the caller cannot view (missing, hidden or DAO-locked) lists nobody: no error to log
  if p_channel is null or not public.can_view(p_channel) then
    return;
  end if;
  return query
    with listed as (
      select m.id, m.handle::text as handle, m.display_name, m.wallet_address, m.avatar_path,
             public._member_online(m.id) as online
      from public.members m
      -- role/overwrite VIEW only: the DAO view gate is ignored on purpose (MC1)
      where m.status = 'active' and (public._channel_permissions_core(m.id, p_channel, true) & 1) <> 0
    )
    select l.id, l.handle, l.display_name, l.wallet_address, l.avatar_path, l.online,
           (select r.color from public.member_roles mr join public.roles r on r.id = mr.role_id
            where mr.member_id = l.id and not r.is_everyone order by r.position desc limit 1)
    from listed l
    order by l.online desc, lower(coalesce(l.display_name, l.handle, l.wallet_address))
    limit greatest(1, least(500, coalesce(p_limit, 300)));
end;
$$;
