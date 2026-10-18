-- Home summary (Inicio) and the contextual right rail. Every read is a definer RPC for active members that only returns
-- rows from channels the caller can view (can_view: permissions + DAO gates) and keeps the F3 privacy rules: anonymous
-- tips and hidden DAO donors read "Anónimo" to everyone else, and no tx hash ever leaves. Amounts travel as text
-- (numeric(78,0) would lose precision as a JSON number). Money figures are for the active chain only.

create function public._active_chain()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id'
$$;

-- ===== open bounties (open or solution chosen and still within its payment window), newest first =====
create function public.home_open_bounties(p_limit int default 5, p_channel uuid default null)
returns table (message_id uuid, channel_id uuid, channel_name text, token text, amount_text text, status text,
               excerpt text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.message_id, b.channel_id, c.name, b.token, b.amount::text, s.status, left(m.body_text, 140), b.created_at
  from public.bounties b
  join public.messages m on m.id = b.message_id
  join public.channels c on c.id = b.channel_id
  cross join lateral (select public.bounty_status(b) as status) s
  where public.is_active_member()
    and b.chain_id = public._active_chain()
    and m.deleted_at is null
    and s.status in ('open', 'solution_marked')
    and (p_channel is null or b.channel_id = p_channel)
    and public.can_view(b.channel_id)
  order by b.created_at desc
  limit greatest(1, least(20, coalesce(p_limit, 5)))
$$;

-- ===== pinned messages across the channels the member can see, latest pin first =====
create function public.home_pinned(p_limit int default 5, p_channel uuid default null)
returns table (message_id uuid, channel_id uuid, channel_name text, author_label text, excerpt text, pinned_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.channel_id, c.name,
         case when m.author_id is null then null else public._member_label(m.author_id) end,
         left(m.body_text, 160), m.pinned_at
  from public.messages m
  join public.channels c on c.id = m.channel_id
  where public.is_active_member()
    and m.pinned_at is not null
    and m.deleted_at is null
    and m.thread_root_id is null
    and (p_channel is null or m.channel_id = p_channel)
    and public.can_view(m.channel_id)
  order by m.pinned_at desc
  limit greatest(1, least(20, coalesce(p_limit, 5)))
$$;

-- ===== channels with the most recent activity (last 7 days) =====
create function public.home_active_channels(p_limit int default 6)
returns table (channel_id uuid, channel_name text, last_at timestamptz, recent_count int)
language sql
stable
security definer
set search_path = ''
as $$
  with recent as (
    select m.channel_id, max(m.created_at) as last_at, count(*)::int as n
    from public.messages m
    where m.created_at > now() - interval '7 days' and m.deleted_at is null and m.kind <> 'system'
    group by m.channel_id
  )
  select r.channel_id, c.name, r.last_at, r.n
  from recent r
  join public.channels c on c.id = r.channel_id
  where public.is_active_member() and public.can_view(r.channel_id)
  order by r.last_at desc
  limit greatest(1, least(20, coalesce(p_limit, 6)))
$$;

-- ===== live club activity: tips, donations and new bounties on the active chain =====
create function public.club_activity(p_limit int default 15)
returns table (kind text, at timestamptz, actor_label text, target_label text, token text, amount_text text,
               channel_id uuid, message_id uuid, target_wallet text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.current_member_id() as id),
  tips as (
    select 'tip'::text as kind, t.created_at as at,
           case when t.anonymous and t.from_member <> (select id from me) then 'Anónimo'
                else public._member_label(t.from_member) end as actor_label,
           public._member_label(t.to_member) as target_label,
           t.token, t.amount::text as amount_text,
           m.channel_id, t.message_id,
           (select w.wallet_address::text from public.members w where w.id = t.to_member) as target_wallet
    from public.tips t
    left join public.messages m on m.id = t.message_id
    where t.chain_id = public._active_chain()
      and (t.target_type = 'profile' or (m.id is not null and m.deleted_at is null and public.can_view(m.channel_id)))
  ),
  donations as (
    select 'donation'::text, l.created_at,
           case when d.dao_ranking_visible or l.member_id = (select id from me) then public._member_label(l.member_id)
                else 'Anónimo' end,
           null::text, 'USDC'::text, l.amount_usdc::text, null::uuid, null::uuid, null::text
    from public.dao_ledger l
    join public.members d on d.id = l.member_id
    where l.chain_id = public._active_chain() and l.status in ('pending_finality', 'credited')
  ),
  new_bounties as (
    select 'bounty'::text, b.created_at, public._member_label(b.author_id), null::text, b.token, b.amount::text,
           b.channel_id, b.message_id, null::text
    from public.bounties b
    join public.messages m on m.id = b.message_id
    where b.chain_id = public._active_chain() and m.deleted_at is null and public.can_view(b.channel_id)
  )
  select * from (
    select * from tips union all select * from donations union all select * from new_bounties
  ) a
  where public.is_active_member()
  order by a.at desc
  limit greatest(1, least(50, coalesce(p_limit, 15)))
$$;

-- ===== one channel at a glance (right rail inside a channel) =====
create function public.channel_overview(p_channel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_topic text;
  v_members int;
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_channel is null or not public.can_view(p_channel) then
    raise exception 'not_found';
  end if;
  select c.name, c.topic into v_name, v_topic from public.channels c where c.id = p_channel;
  select count(*)::int into v_members
  from public.members m
  where m.status = 'active' and (public.channel_permissions(m.id, p_channel) & 1) <> 0;
  return jsonb_build_object('name', v_name, 'topic', v_topic, 'memberCount', v_members);
end;
$$;

-- ===== realtime: the rail's activity feed refreshes on a private, id-free "activity" topic =====
create policy "realtime_receive_activity_topic"
  on realtime.messages
  for select
  to authenticated
  -- CASE like the other topic policies (ruling F2b-R3).
  using (
    case
      when realtime.topic() = 'activity' then public.is_active_member()
      else false
    end
  );

create function public.broadcast_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nested: PL/pgSQL would resolve new.status on a tips/bounties row too if it were one AND chain.
  if tg_table_name = 'dao_ledger' and tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return null;
    end if;
  end if;
  perform realtime.send('{}'::jsonb, 'activity_changed', 'activity', true);
  return null;
end;
$$;

create trigger tips_activity_broadcast after insert on public.tips
  for each row execute function public.broadcast_activity_event();
create trigger bounties_activity_broadcast after insert on public.bounties
  for each row execute function public.broadcast_activity_event();
create trigger dao_ledger_activity_broadcast after insert or update on public.dao_ledger
  for each row execute function public.broadcast_activity_event();

-- ===== grants =====
revoke execute on function
  public._active_chain(),
  public.home_open_bounties(int, uuid),
  public.home_pinned(int, uuid),
  public.home_active_channels(int),
  public.club_activity(int),
  public.channel_overview(uuid),
  public.broadcast_activity_event()
from public, anon;
revoke execute on function public._active_chain(), public.broadcast_activity_event() from authenticated, service_role;
grant execute on function
  public.home_open_bounties(int, uuid),
  public.home_pinned(int, uuid),
  public.home_active_channels(int),
  public.club_activity(int),
  public.channel_overview(uuid)
to authenticated;
