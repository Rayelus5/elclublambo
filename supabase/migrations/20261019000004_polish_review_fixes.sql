-- Review fixes for the roles drag & drop and the home/rail reads (F3 polish round).
--
-- I1: hierarchy no longer counts system_key roles. Verificado and Padrino are badges that many members hold; now that the
--     SuperAdmin may reorder them, ranking them above Moderador must not make every verified moderator outrank (and be
--     able to strip) the Moderador role. member_top_position ignores them (the TS mirror in src/lib/roles/queries.ts too).
-- I2: a delegate's move_role may not shift a system_key role out of its slot (make-room run).
-- I3: home/rail reads resolve the visible channels once (visible_channels()) and limit each source before computing
--     labels; the activity feed lists credited donations only (M2: a pending one can still be reverted).
-- M3: active channels probe the (channel_id, created_at) index per visible channel instead of scanning all messages.

create or replace function public.member_top_position(p_member uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.position), 0)
  from public.roles r
  where r.is_everyone
     or (r.system_key is null
         and r.id in (select mr.role_id from public.member_roles mr where mr.member_id = p_member))
$$;

create or replace function public.move_role(p_role uuid, p_position int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_admin boolean;
  v_top int;
  v_role public.roles;
  v_end int;
begin
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(64) then
    raise exception 'forbidden';
  end if;
  if p_role is null or p_position is null then
    raise exception 'invalid_input';
  end if;

  select * into v_role from public.roles r where r.id = p_role for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if v_role.is_system or v_role.is_everyone then
    raise exception 'forbidden';
  end if;

  v_admin := (public.member_global_permissions(v_actor) & 512) <> 0;
  -- Roles held by everyone they are given to (Verificado, Padrino): only the SuperAdmin reorders them.
  if v_role.system_key is not null and not v_admin then
    raise exception 'forbidden';
  end if;
  v_top := public.member_top_position(v_actor);
  if not v_admin and v_role.position >= v_top then
    raise exception 'hierarchy';
  end if;
  if p_position < 1 or p_position >= v_top then
    raise exception 'hierarchy';
  end if;

  -- Make room: shift only the contiguous run of occupied positions starting at the target slot.
  with recursive run(pos) as (
    select p_position
    where exists (select 1 from public.roles r
                  where r.position = p_position and r.id <> p_role and not r.is_everyone and not r.is_system)
    union all
    select run.pos + 1 from run
    where exists (select 1 from public.roles r
                  where r.position = run.pos + 1 and r.id <> p_role and not r.is_everyone and not r.is_system)
  )
  select max(pos) into v_end from run;

  -- Review I2: a delegate's move must not shift a system_key role (Verificado, Padrino) out of its slot either.
  if v_end is not null and not v_admin and exists (
    select 1 from public.roles r
    where r.position between p_position and v_end and r.id <> p_role and r.system_key is not null) then
    raise exception 'hierarchy';
  end if;

  if v_end is not null then
    if v_end + 1 >= v_top then
      raise exception 'hierarchy';
    end if;
    update public.roles r set position = r.position + 1
    where r.position between p_position and v_end and r.id <> p_role and not r.is_everyone and not r.is_system;
  end if;

  update public.roles set position = p_position where id = p_role;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'role_moved', 'role', p_role,
          jsonb_build_object('name', v_role.name, 'from_position', v_role.position, 'to_position', p_position));
end;
$$;

-- ===== I3 / M2 / M3: home and rail reads =====
create or replace function public.home_open_bounties(p_limit int default 5, p_channel uuid default null)
returns table (message_id uuid, channel_id uuid, channel_name text, token text, amount_text text, status text,
               excerpt text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with vis as (select v.id, v.name from public.visible_channels() v where p_channel is null or v.id = p_channel)
  select b.message_id, b.channel_id, vis.name, b.token, b.amount::text, s.status, left(m.body_text, 140), b.created_at
  from public.bounties b
  join vis on vis.id = b.channel_id
  join public.messages m on m.id = b.message_id
  cross join lateral (select public.bounty_status(b) as status) s
  where public.is_active_member()
    and b.chain_id = public._active_chain()
    and b.paid_at is null and b.cancelled_at is null
    and m.deleted_at is null
    and s.status in ('open', 'solution_marked')
  order by b.created_at desc
  limit greatest(1, least(20, coalesce(p_limit, 5)))
$$;

create or replace function public.home_pinned(p_limit int default 5, p_channel uuid default null)
returns table (message_id uuid, channel_id uuid, channel_name text, author_label text, excerpt text, pinned_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with vis as (select v.id, v.name from public.visible_channels() v where p_channel is null or v.id = p_channel),
  pins as (
    select m.id, m.channel_id, vis.name, m.author_id, m.body_text, m.pinned_at
    from public.messages m
    join vis on vis.id = m.channel_id
    where public.is_active_member() and m.pinned_at is not null and m.deleted_at is null and m.thread_root_id is null
    order by m.pinned_at desc
    limit greatest(1, least(20, coalesce(p_limit, 5)))
  )
  select p.id, p.channel_id, p.name,
         case when p.author_id is null then null else public._member_label(p.author_id) end,
         left(p.body_text, 160), p.pinned_at
  from pins p
  order by p.pinned_at desc
$$;

create or replace function public.home_active_channels(p_limit int default 6)
returns table (channel_id uuid, channel_name text, last_at timestamptz, recent_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.name, last.created_at, recent.n
  from public.visible_channels() v
  cross join lateral (
    select m.created_at from public.messages m
    where m.channel_id = v.id and m.created_at > now() - interval '7 days' and m.deleted_at is null and m.kind <> 'system'
    order by m.created_at desc limit 1
  ) last
  cross join lateral (
    select count(*)::int as n from public.messages m
    where m.channel_id = v.id and m.created_at > now() - interval '7 days' and m.deleted_at is null and m.kind <> 'system'
  ) recent
  where public.is_active_member() and v.kind <> 'category'
  order by last.created_at desc
  limit greatest(1, least(20, coalesce(p_limit, 6)))
$$;

create or replace function public.club_activity(p_limit int default 15)
returns table (kind text, at timestamptz, actor_label text, target_label text, token text, amount_text text,
               channel_id uuid, message_id uuid, target_wallet text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.current_member_id() as id),
  lim as (select greatest(1, least(50, coalesce(p_limit, 15))) as n),
  vis as (select v.id from public.visible_channels() v),
  chain as (select public._active_chain() as id),
  -- each source is cut to the limit before any label is computed
  tips as (
    select t.created_at, t.from_member, t.to_member, t.anonymous, t.token, t.amount, m.channel_id, t.message_id
    from public.tips t
    left join public.messages m on m.id = t.message_id
    where t.chain_id = (select id from chain)
      and (t.target_type = 'profile' or (m.deleted_at is null and m.channel_id in (select id from vis)))
    order by t.created_at desc
    limit (select n from lim)
  ),
  donations as (
    select l.credited_at, l.member_id, l.amount_usdc
    from public.dao_ledger l
    where l.chain_id = (select id from chain) and l.status = 'credited'
    order by l.credited_at desc
    limit (select n from lim)
  ),
  new_bounties as (
    select b.created_at, b.author_id, b.token, b.amount, b.channel_id, b.message_id
    from public.bounties b
    join public.messages m on m.id = b.message_id
    where b.chain_id = (select id from chain) and m.deleted_at is null and b.channel_id in (select id from vis)
    order by b.created_at desc
    limit (select n from lim)
  ),
  merged as (
    select 'tip'::text as kind, t.created_at as at, t.from_member as actor, t.anonymous, t.to_member as target,
           t.token, t.amount, t.channel_id, t.message_id
    from tips t
    union all
    select 'donation', d.credited_at, d.member_id, false, null, 'USDC', d.amount_usdc, null, null from donations d
    union all
    select 'bounty', b.created_at, b.author_id, false, null, b.token, b.amount, b.channel_id, b.message_id from new_bounties b
    order by 2 desc
    limit (select n from lim)
  )
  select x.kind, x.at,
         case
           when x.kind = 'tip' and x.anonymous and x.actor <> (select id from me) then 'Anónimo'
           when x.kind = 'donation' and x.actor <> (select id from me)
                and not (select a.dao_ranking_visible from public.members a where a.id = x.actor) then 'Anónimo'
           else public._member_label(x.actor)
         end,
         case when x.target is null then null else public._member_label(x.target) end,
         x.token, x.amount::text, x.channel_id, x.message_id,
         case when x.target is null then null else (select w.wallet_address::text from public.members w where w.id = x.target) end
  from merged x
  where public.is_active_member()
  order by x.at desc
$$;
