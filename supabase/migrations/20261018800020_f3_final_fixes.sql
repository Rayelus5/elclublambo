-- F3 final fix wave (whole-branch review).
--   F3-R1 (I1): the 7-day unpaid clock only counts while the author can pay. bounty_status gains three derived statuses
--               that are never an unpaid mark:
--                 removed            the bounty message was soft-deleted by someone other than its author (moderation);
--                                    a bounty its author deleted keeps its normal status;
--                 other_chain        the bounty's chain is not the active chain (no intent can be created for it);
--                 solver_unavailable the marked solver is not active (banned / left): payment is impossible.
--               Precedence (first match wins):
--                 cancelled > paid > paid_late > removed > other_chain > solver_unavailable > unpaid > solution_marked
--                 > expired > open.
--               Derived at read time like the rest: when the solver is reinstated or the chain becomes active again, the
--               bounty goes back to its lifecycle status (unpaid if the 7 days are over). mark_bounty_solution and
--               cancel_bounty keep deciding on the lifecycle status (_bounty_lifecycle_status), so other_chain never
--               reopens an expired bounty.
--   F3-R2 (I2): member_bounty_record and member_unpaid_bounties count the active chain only; the unpaid list returns
--               chain_id so the profile can label the network.
--   M3: a tip on a deleted message stays on the recipient's profile, flagged message_deleted. A soft-deleted message
--       keeps its channel, so the usual visibility applies. A hard-deleted one has no channel left to check: its tip is
--       only listed (and totalled) for the two parties, the recipient and the donor, so nothing leaks to other viewers.
--   M5: the dead helper _channel_failing_gate (no caller since 20261018800013) is dropped.
--   M6: set_chain_addresses refuses safe = platform (safe_equals_platform): a donation fee would land in the Safe
--       outside the ledger and raise a permanent reconciliation alert.

-- ===== bounty statuses =====
-- The lifecycle alone (the body bounty_status had until now): what marking and cancelling decide on.
create function public._bounty_lifecycle_status(b public.bounties)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when b.cancelled_at is not null then 'cancelled'
    when b.paid_at is not null and b.paid_at <= b.solution_marked_at + interval '7 days' then 'paid'
    when b.paid_at is not null then 'paid_late'
    when b.solution_marked_at is not null and now() > b.solution_marked_at + interval '7 days' then 'unpaid'
    when b.solution_marked_at is not null then 'solution_marked'
    when now() > b.created_at + interval '30 days' then 'expired'
    else 'open'
  end
$$;

-- The status shown everywhere (cards, record, unpaid list). See the precedence above.
create or replace function public.bounty_status(b public.bounties)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when b.cancelled_at is not null then 'cancelled'
    when b.paid_at is not null and b.paid_at <= b.solution_marked_at + interval '7 days' then 'paid'
    when b.paid_at is not null then 'paid_late'
    when exists (select 1 from public.messages m
                 where m.id = b.message_id and m.deleted_at is not null
                   and m.deleted_by is distinct from b.author_id) then 'removed'
    when b.chain_id is distinct from (select (c.value #>> '{}')::int from public.app_config c
                                      where c.key = 'active_chain_id') then 'other_chain'
    when b.solver_id is not null
         and not exists (select 1 from public.members s where s.id = b.solver_id and s.status = 'active')
      then 'solver_unavailable'
    else public._bounty_lifecycle_status(b)
  end
$$;

-- mark_bounty_solution / cancel_bounty: identical to 20261018700002 except they decide on _bounty_lifecycle_status.
create or replace function public.mark_bounty_solution(p_bounty uuid, p_reply uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  b public.bounties;
  v_bounty_deleted boolean;
  v_reply public.messages;
begin
  if v_me is null or not public.is_active_member() or p_bounty is null then
    raise exception 'forbidden';
  end if;
  select * into b from public.bounties x where x.message_id = p_bounty for update;
  if not found then
    raise exception 'not_found';
  end if;
  if b.author_id <> v_me then
    raise exception 'forbidden';
  end if;
  if b.solution_marked_at is not null then
    raise exception 'already_marked';
  end if;
  select m.deleted_at is not null into v_bounty_deleted from public.messages m where m.id = b.message_id;
  if v_bounty_deleted or public._bounty_lifecycle_status(b) in ('cancelled', 'expired') then
    raise exception 'bounty_closed';
  end if;

  select * into v_reply from public.messages r where r.id = p_reply;
  if p_reply is null or not found
     or v_reply.thread_root_id is distinct from b.message_id
     or v_reply.channel_id <> b.channel_id
     or v_reply.deleted_at is not null
     or v_reply.kind = 'system'
     or v_reply.author_id is null
     or v_reply.author_id = v_me
     or not exists (select 1 from public.members s where s.id = v_reply.author_id and s.status = 'active') then
    raise exception 'invalid_solution';
  end if;

  update public.bounties
  set solution_message_id = v_reply.id, solver_id = v_reply.author_id, solution_marked_at = now()
  where message_id = b.message_id;

  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  values (v_reply.author_id, 'bounty_solution', v_me, b.channel_id, v_reply.id,
          jsonb_build_object('bountyId', b.message_id, 'threadRootId', b.message_id))
  on conflict (recipient_id, message_id) where message_id is not null do nothing;
end;
$$;

create or replace function public.cancel_bounty(p_bounty uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  b public.bounties;
  v_bounty_deleted boolean;
begin
  if v_me is null or not public.is_active_member() or p_bounty is null then
    raise exception 'forbidden';
  end if;
  select * into b from public.bounties x where x.message_id = p_bounty for update;
  if not found then
    raise exception 'not_found';
  end if;
  if b.author_id <> v_me then
    raise exception 'forbidden';
  end if;
  if b.solution_marked_at is not null then
    raise exception 'already_marked';
  end if;
  select m.deleted_at is not null into v_bounty_deleted from public.messages m where m.id = b.message_id;
  if v_bounty_deleted or public._bounty_lifecycle_status(b) in ('cancelled', 'expired') then
    raise exception 'bounty_closed';
  end if;
  update public.bounties set cancelled_at = now() where message_id = b.message_id;
end;
$$;

-- ===== F3-R2: the record counts the active chain only =====
-- Identical to 20261018700002 plus the active-chain filter.
create or replace function public.member_bounty_record(p_member uuid)
returns table (paid int, paid_late int, unpaid int, open int)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where x.s = 'paid')::int,
         count(*) filter (where x.s = 'paid_late')::int,
         count(*) filter (where x.s = 'unpaid')::int,
         count(*) filter (where x.s = 'open' and not x.deleted)::int
  from (
    select public.bounty_status(b) as s, m.deleted_at is not null as deleted
    from public.bounties b
    join public.messages m on m.id = b.message_id
    where public.is_active_member()
      and b.author_id = p_member
      and b.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
      and b.channel_id in (select v.id from public.visible_channels() v)
  ) x
$$;

-- The return type gains chain_id: drop and recreate.
drop function public.member_unpaid_bounties(uuid);
create function public.member_unpaid_bounties(p_member uuid)
returns table (message_id uuid, channel_id uuid, token text, amount_text text, solution_marked_at timestamptz, chain_id int)
language sql
stable
security definer
set search_path = ''
as $$
  select b.message_id, b.channel_id, b.token, b.amount::text, b.solution_marked_at, b.chain_id
  from public.bounties b
  where public.is_active_member()
    and b.author_id = p_member
    and b.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
    and public.bounty_status(b) = 'unpaid'
    and b.channel_id in (select v.id from public.visible_channels() v)
  order by b.solution_marked_at, b.message_id
$$;

-- ===== M3: tips on deleted messages =====
-- member_tips: identical to 20261018800010 (anonymity rules unchanged) plus message_deleted and the deleted-message
-- visibility described at the top. The return type changes: drop and recreate.
drop function public.member_tips(uuid, int);
create function public.member_tips(p_member uuid, p_limit int default 20)
returns table (tip_id uuid, donor_id uuid, is_me boolean, token text, amount numeric, chain_id int,
               main_tx_hash text, created_at timestamptz, amount_text text, anonymous boolean, message_deleted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         case when t.anonymous and t.from_member <> public.current_member_id() then null else t.from_member end,
         t.from_member = public.current_member_id(),
         t.token, t.amount, t.chain_id,
         case when t.anonymous and t.from_member <> public.current_member_id() then null else t.main_tx_hash end,
         t.created_at, t.amount::text, t.anonymous,
         t.target_type = 'message' and (m.id is null or m.deleted_at is not null)
  from public.tips t
  left join public.messages m on m.id = t.message_id
  where public.is_active_member()
    and t.to_member = p_member
    and (t.target_type = 'profile'
         or (m.id is not null and m.channel_id in (select v.id from public.visible_channels() v))
         or (m.id is null and public.current_member_id() in (t.to_member, t.from_member)))
  order by t.created_at desc, t.id
  limit greatest(1, least(100, coalesce(p_limit, 20)))
$$;

-- member_tips_totals: identical to 20261018600004 with the same visibility as member_tips.
create or replace function public.member_tips_totals(p_member uuid, p_chain int)
returns table (token text, total_text text, tip_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select t.token, sum(t.amount)::text, count(*)::int
  from public.tips t
  left join public.messages m on m.id = t.message_id
  where public.is_active_member()
    and t.to_member = p_member
    and t.chain_id = p_chain
    and (t.target_type = 'profile'
         or (m.id is not null and m.channel_id in (select v.id from public.visible_channels() v))
         or (m.id is null and public.current_member_id() in (t.to_member, t.from_member)))
  group by t.token
$$;

-- ===== M6: set_chain_addresses refuses safe = platform =====
-- Identical to 20261018500002 plus the safe_equals_platform check (after lowercasing).
create or replace function public.set_chain_addresses(p_chain int, p_safe text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_safe text := nullif(lower(btrim(coalesce(p_safe, ''))), '');
  v_platform text := nullif(lower(btrim(coalesce(p_platform, ''))), '');
  v_old_safe text;
  v_old_platform text;
  v_zero constant text := '0x0000000000000000000000000000000000000000';
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if (v_safe is not null and (v_safe !~ '^0x[0-9a-f]{40}$' or v_safe = v_zero))
     or (v_platform is not null and (v_platform !~ '^0x[0-9a-f]{40}$' or v_platform = v_zero)) then
    raise exception 'address_invalid';
  end if;
  if v_safe is not null and v_safe = v_platform then
    raise exception 'safe_equals_platform';
  end if;

  select c.safe_address, c.platform_wallet into v_old_safe, v_old_platform
  from public.chain_config c where c.chain_id = p_chain for update;

  update public.chain_config
  set safe_address = v_safe, platform_wallet = v_platform, updated_at = now(), updated_by = v_me
  where chain_id = p_chain;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.addresses', jsonb_build_object(
    'chain', p_chain,
    'old', jsonb_build_object('safe', v_old_safe, 'platform', v_old_platform),
    'new', jsonb_build_object('safe', v_safe, 'platform', v_platform)));
end;
$$;

-- ===== M5: dead helper =====
drop function public._channel_failing_gate(uuid, uuid, text);

-- ===== grants =====
revoke execute on function
  public._bounty_lifecycle_status(public.bounties),
  public.bounty_status(public.bounties),
  public.mark_bounty_solution(uuid, uuid),
  public.cancel_bounty(uuid),
  public.member_bounty_record(uuid),
  public.member_unpaid_bounties(uuid),
  public.member_tips(uuid, int),
  public.member_tips_totals(uuid, int)
from public, anon, authenticated, service_role;

grant execute on function
  public.mark_bounty_solution(uuid, uuid),
  public.cancel_bounty(uuid),
  public.member_bounty_record(uuid),
  public.member_unpaid_bounties(uuid),
  public.member_tips(uuid, int),
  public.member_tips_totals(uuid, int)
to authenticated;

revoke execute on function public.set_chain_addresses(int, text, text) from public, anon;
grant execute on function public.set_chain_addresses(int, text, text) to authenticated;
