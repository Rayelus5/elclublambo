-- P1 Task 12: data for the new Inicio. Two definer reads for active members, nothing from channels the caller cannot
-- view.
--   - home_unread_channels(p_limit): the my_unread_channels criteria (20261016200003) with what the card shows: how many
--     unread messages (capped at 99), and the newest one (excerpt, author label, time). Newest first.
--   - home_highlights(): open bounties count (home_open_bounties criteria, latest 20261024100002), the newest open poll
--     in a channel the caller can view, the open giveaway closing first (and whether the caller entered), and whether
--     the caller holds Mecenas (system_key 'donor').

-- ===== unread channels with their newest unread message =====
create function public.home_unread_channels(p_limit int default 6)
returns table (channel_id uuid, channel_name text, unread_count int, last_excerpt text, last_author text,
               last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.created_at from public.members m where m.auth_user_id = auth.uid() and m.status = 'active'
  )
  select c.id, c.name, n.unread, left(l.body_text, 140), public._member_label(l.author_id), l.created_at
  from public.visible_channels() c
  cross join me
  left join public.channel_reads cr on cr.member_id = me.id and cr.channel_id = c.id
  -- the newest unread message (answered by the (channel_id, created_at desc, id) index)
  cross join lateral (
    select x.body_text, x.author_id, x.created_at
    from public.messages x
    where x.channel_id = c.id
      and x.created_at > coalesce(cr.last_read_at, me.created_at)
      and x.deleted_at is null
      and x.author_id <> me.id
    order by x.created_at desc, x.id desc
    limit 1
  ) l
  -- counting stops at 100: the card shows 99 at most
  cross join lateral (
    select least(count(*), 99)::int as unread
    from (
      select 1
      from public.messages x
      where x.channel_id = c.id
        and x.created_at > coalesce(cr.last_read_at, me.created_at)
        and x.deleted_at is null
        and x.author_id <> me.id
      limit 100
    ) capped
  ) n
  where c.kind = 'text'
  order by l.created_at desc, c.id
  limit greatest(1, least(20, coalesce(p_limit, 6)))
$$;

-- ===== what is going on in the club right now =====
create function public.home_highlights()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_bounties int;
  v_poll jsonb;
  v_giveaway jsonb;
  v_mecenas boolean;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;

  select count(*)::int into v_bounties
  from public.bounties b
  join public.messages m on m.id = b.message_id
  cross join lateral (select public.bounty_status(b) as status) s
  where private.chain_enabled(b.chain_id)
    and b.paid_at is null and b.cancelled_at is null
    and m.deleted_at is null
    and s.status in ('open', 'solution_marked')
    and public.can(b.channel_id, 1);

  select jsonb_build_object('messageId', p.message_id, 'channelId', p.channel_id, 'question', m.body_text,
                            'closesAt', p.closes_at)
  into v_poll
  from public.polls p
  join public.messages m on m.id = p.message_id
  where p.finalized_at is null
    and p.closes_at > now()
    and m.deleted_at is null
    and public.can(p.channel_id, 1)
  order by p.created_at desc, p.message_id
  limit 1;

  select jsonb_build_object('id', g.id, 'title', g.title, 'closesAt', g.closes_at,
                            'iEntered', exists (select 1 from public.giveaway_entries e
                                                where e.giveaway_id = g.id and e.member_id = v_me))
  into v_giveaway
  from public.giveaways g
  where g.status = 'open' and g.closes_at > now()
  order by g.closes_at, g.id
  limit 1;

  select exists (
    select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id
    where mr.member_id = v_me and r.system_key = 'donor'
  ) into v_mecenas;

  return jsonb_build_object(
    'openBounties', v_bounties,
    'poll', coalesce(v_poll, 'null'::jsonb),
    'giveaway', coalesce(v_giveaway, 'null'::jsonb),
    'donor', jsonb_build_object('isMecenas', v_mecenas)
  );
end;
$$;

revoke execute on function
  public.home_unread_channels(int),
  public.home_highlights()
from public, anon, service_role;

grant execute on function
  public.home_unread_channels(int),
  public.home_highlights()
to authenticated;
