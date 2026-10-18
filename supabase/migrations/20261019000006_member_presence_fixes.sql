-- Review of the member card / presence commit.
-- MC3: last_seen_at moves out of members (whose rows every active member can read) into member_presence, which has
--      RLS on and no client grants: only the online yes/no ever leaves, through the definer RPCs.
-- MC1: the channel member list ignores the DAO view gates (role/overwrite permissions only). Listing who passes a
--      gate would name the donors above its threshold, including those who chose to stay "Anónimo".
-- MC2: the list is read once per channel; members_online() is the cheap per-minute presence refresh.

create table public.member_presence (
  member_id uuid primary key references public.members (id) on delete cascade,
  last_seen_at timestamptz not null
);
alter table public.member_presence enable row level security;
revoke all on public.member_presence from anon, authenticated;

insert into public.member_presence (member_id, last_seen_at)
  select id, last_seen_at from public.members where last_seen_at is not null;
alter table public.members drop column last_seen_at;

create or replace function public.touch_presence()
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
  insert into public.member_presence as p (member_id, last_seen_at) values (v_me, now())
  on conflict (member_id) do update set last_seen_at = now()
  where p.last_seen_at < now() - interval '30 seconds';
end;
$$;

create function public._member_online(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.member_presence p
                 where p.member_id = p_member and p.last_seen_at > now() - interval '3 minutes')
$$;

create or replace function public.member_card(p_member uuid)
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
    'online', v.status = 'active' and public._member_online(v.id),
    'roles', v_roles
  );
end;
$$;

drop function public.channel_members(uuid, int);
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

-- the cheap per-minute refresh: which of these members are online now (active members only)
create function public.members_online(p_members uuid[])
returns table (member_id uuid, online boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, public._member_online(m.id)
  from public.members m
  where public.is_active_member() and m.status = 'active' and m.id = any (p_members[1:500])
$$;

drop function public._is_online(timestamptz);

revoke execute on function public._member_online(uuid), public.channel_members(uuid, int), public.members_online(uuid[])
  from public, anon;
revoke execute on function public._member_online(uuid) from authenticated, service_role;
grant execute on function public.channel_members(uuid, int), public.members_online(uuid[]) to authenticated;
