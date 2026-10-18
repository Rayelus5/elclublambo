-- Presence per device (review LP1): a member is online while any of their devices beats; a goodbye only removes the
-- device that closed, and "offline" is announced only when no other device is still online. The device id is a random
-- uuid kept in the browser; it only scopes the caller's own rows (the member always comes from the session).

delete from public.member_presence;
alter table public.member_presence drop constraint member_presence_pkey;
alter table public.member_presence add column device_id uuid not null default gen_random_uuid();
alter table public.member_presence alter column device_id drop default;
alter table public.member_presence add primary key (member_id, device_id);

create or replace function public._member_online(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.member_presence p
                 where p.member_id = p_member and p.last_seen_at > now() - interval '75 seconds')
$$;

drop function public.touch_presence();
create function public.touch_presence(p_device uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_was boolean;
begin
  if v_me is null or not public.is_active_member() or p_device is null then
    return;
  end if;
  v_was := public._member_online(v_me);
  insert into public.member_presence as p (member_id, device_id, last_seen_at) values (v_me, p_device, now())
  on conflict (member_id, device_id) do update set last_seen_at = now()
  where p.last_seen_at < now() - interval '15 seconds';
  -- a member never keeps more than a handful of device rows: drop the long-dead ones
  delete from public.member_presence p where p.member_id = v_me and p.last_seen_at < now() - interval '1 day';
  if not v_was then
    perform realtime.send(jsonb_build_object('member_id', v_me, 'online', true), 'presence_changed', 'presence', true);
  end if;
end;
$$;

drop function public.leave_presence();
create function public.leave_presence(p_device uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() or p_device is null then
    return;
  end if;
  delete from public.member_presence p where p.member_id = v_me and p.device_id = p_device;
  if found and not public._member_online(v_me) then
    perform realtime.send(jsonb_build_object('member_id', v_me, 'online', false), 'presence_changed', 'presence', true);
  end if;
end;
$$;

revoke execute on function public.touch_presence(uuid), public.leave_presence(uuid) from public, anon;
grant execute on function public.touch_presence(uuid), public.leave_presence(uuid) to authenticated;
