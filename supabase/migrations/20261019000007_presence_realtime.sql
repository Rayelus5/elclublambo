-- Real-time presence (still server-authoritative). The database itself announces transitions on a private "presence"
-- topic: touch_presence() broadcasts {member_id, online: true} when the caller goes from offline to online, and
-- leave_presence() (sent as the last tab closes) broadcasts {member_id, online: false}. A crash or lost connection has
-- no goodbye: clients fall back to a cheap members_online() poll, and the online window is 75 s (heartbeat every 30 s).
-- Identities come from the session (current_member_id), never from the client.

create policy "realtime_receive_presence_topic"
  on realtime.messages
  for select
  to authenticated
  -- CASE like the other topic policies (ruling F2b-R3).
  using (
    case
      when realtime.topic() = 'presence' then public.is_active_member()
      else false
    end
  );

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

create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_was boolean;
begin
  if v_me is null or not public.is_active_member() then
    return;
  end if;
  v_was := public._member_online(v_me);
  insert into public.member_presence as p (member_id, last_seen_at) values (v_me, now())
  on conflict (member_id) do update set last_seen_at = now()
  where p.last_seen_at < now() - interval '15 seconds';
  if not v_was then
    perform realtime.send(jsonb_build_object('member_id', v_me, 'online', true), 'presence_changed', 'presence', true);
  end if;
end;
$$;

create function public.leave_presence()
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
  if public._member_online(v_me) then
    update public.member_presence set last_seen_at = now() - interval '1 hour' where member_id = v_me;
    perform realtime.send(jsonb_build_object('member_id', v_me, 'online', false), 'presence_changed', 'presence', true);
  end if;
end;
$$;

revoke execute on function public.leave_presence() from public, anon;
grant execute on function public.leave_presence() to authenticated;
