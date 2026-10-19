-- F4c Task 2: withdrawal requests, the per-network switch, locked shares and gating on unlocked shares.
--
--   withdrawal_requests     one active request (pending | approved) per chain and member; RLS on, no client access.
--   dao_positions.locked_shares       the shares of the member's active request (pending or approved).
--   dao_state.approved_locked_shares  the shares of every approved request (until burned at finality).
--   S_eff = _dao_supply(chain) = total_shares - approved_locked_shares: approved shares leave the counted supply, so an
--           approval never moves the share price (their fixed USDC amount becomes a liability, Task 3).
--   chain_config.withdrawals_enabled  per network, default off, only SuperAdmin (512) flips it. Only requesting needs it
--           here; quote and approval (Task 3) need it too. app_config.withdrawals_enabled stays, unused.
--   Gating (_member_dao_standing): share_bps = floor((shares - locked) * 10000 / S_eff),
--           net = locked = 0 ? net : floor(net * (shares - locked) / shares).
-- Lock order: request row (for update) -> chain_config (for share) -> dao_state (for update) -> dao_positions.

-- ===== schema =====
alter table public.chain_config add column withdrawals_enabled boolean not null default false;

alter table public.dao_positions
  add column locked_shares numeric(78, 0) not null default 0,
  add constraint dao_positions_locked_within_shares check (locked_shares >= 0 and locked_shares <= shares);

alter table public.dao_state
  add column approved_locked_shares numeric(78, 0) not null default 0,
  add constraint dao_state_approved_locked_within check (approved_locked_shares >= 0
                                                         and approved_locked_shares <= total_shares - club_shares);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null check (chain_id in (59144, 59141)),
  member_id uuid not null references public.members (id),
  shares numeric(78, 0) not null check (shares > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected', 'cancelled')),
  amount_usdc_locked numeric(78, 0) check (amount_usdc_locked is null or amount_usdc_locked > 0),
  destination_address text check (destination_address is null or destination_address ~ '^0x[0-9a-f]{40}$'),
  approved_by uuid references public.members (id),
  approved_at timestamptz,
  self_approved boolean not null default false,
  approval_count int not null default 0 check (approval_count >= 0),
  last_expired_at timestamptz,
  rejected_by uuid references public.members (id),
  rejected_at timestamptz,
  reject_reason text check (reject_reason is null or char_length(reject_reason) between 1 and 280),
  cancelled_at timestamptz,
  payout_tx_hash text check (payout_tx_hash is null or payout_tx_hash ~ '^0x[0-9a-f]{64}$'),
  payout_log_index int check (payout_log_index is null or payout_log_index >= 0),
  payout_block bigint check (payout_block is null or payout_block >= 0),
  payout_amount numeric(78, 0) check (payout_amount is null or payout_amount > 0),
  payout_recorded_at timestamptz,
  payout_recorded_by uuid references public.members (id), -- null: detected by the cron
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint withdrawal_requests_approval_coherent check (
    (status in ('approved', 'paid'))
    = (amount_usdc_locked is not null and approved_at is not null and destination_address is not null)),
  constraint withdrawal_requests_paid_coherent check ((status = 'paid') = (paid_at is not null)),
  constraint withdrawal_requests_payout_coherent check (
    (payout_tx_hash is null and payout_log_index is null and payout_block is null and payout_amount is null
       and payout_recorded_at is null)
    or (payout_tx_hash is not null and payout_log_index is not null and payout_block is not null
        and payout_amount is not null and payout_recorded_at is not null and status in ('approved', 'paid'))),
  constraint withdrawal_requests_paid_has_payout check (status <> 'paid' or payout_tx_hash is not null)
);
create unique index withdrawal_requests_active_uidx on public.withdrawal_requests (chain_id, member_id)
  where status in ('pending', 'approved');
create unique index withdrawal_requests_payout_uidx on public.withdrawal_requests (chain_id, payout_tx_hash, payout_log_index)
  where payout_tx_hash is not null;
create index withdrawal_requests_status_idx on public.withdrawal_requests (chain_id, status, created_at);
create index withdrawal_requests_member_idx on public.withdrawal_requests (member_id, created_at desc);

alter table public.withdrawal_requests enable row level security;
revoke all on public.withdrawal_requests from public, anon, authenticated;

-- linked by the payout matching (Task 4)
alter table public.dao_safe_operations add column withdrawal_id uuid references public.withdrawal_requests (id);
create index dao_safe_operations_withdrawal_idx on public.dao_safe_operations (withdrawal_id) where withdrawal_id is not null;

-- ===== notification kinds: the list from 20261019100002 + the five F4c kinds =====
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid',
  'treasury_mismatch', 'treasury_outflow',
  'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired', 'treasury_notice'
));

-- ===== realtime: broadcast_dao_event (latest 20261019000001) + a withdrawal_requests branch =====
create or replace function public.broadcast_dao_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chain int;
begin
  if tg_table_name = 'dao_state' then
    if new.total_shares is not distinct from old.total_shares and new.value_usdc is not distinct from old.value_usdc then
      return null;
    end if;
    v_chain := new.chain_id;
  elsif tg_table_name = 'dao_ledger' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_chain := new.chain_id;
  elsif tg_table_name = 'withdrawal_requests' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_chain := new.chain_id;
  else -- members: only the ranking opt-in matters; the active chain is the one the page shows
    if new.dao_ranking_visible is not distinct from old.dao_ranking_visible then
      return null;
    end if;
    select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  end if;

  perform realtime.send(jsonb_build_object('chain_id', v_chain), 'dao_changed', 'dao', true);
  return null;
end;
$$;

revoke execute on function public.broadcast_dao_event() from public, anon, authenticated, service_role;

create trigger withdrawal_requests_broadcast after insert or update of status on public.withdrawal_requests
  for each row execute function public.broadcast_dao_event();

-- ===== _dao_supply (service_role): the counted supply S_eff =====
create function public._dao_supply(p_chain int)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.total_shares - s.approved_locked_shares from public.dao_state s where s.chain_id = p_chain), 0)
$$;

-- ===== economy_config (latest 20261018500002) + withdrawalsEnabled per chain =====
create or replace function public.economy_config()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'activeChainId', (select c.value from public.app_config c where c.key = 'active_chain_id'),
    'minFeeBps', (select c.value from public.app_config c where c.key = 'min_fee_bps'),
    'chains', (select coalesce(jsonb_object_agg(cc.chain_id::text,
                 jsonb_build_object('safe', cc.safe_address, 'platform', cc.platform_wallet,
                                    'withdrawalsEnabled', cc.withdrawals_enabled)), '{}'::jsonb)
               from public.chain_config cc)
  );
end;
$$;

-- ===== set_withdrawals_enabled (bit 512) =====
create function public.set_withdrawals_enabled(p_chain int, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_old boolean;
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_enabled is null then
    raise exception 'invalid_input';
  end if;

  select c.withdrawals_enabled into v_old from public.chain_config c where c.chain_id = p_chain for update;
  update public.chain_config
  set withdrawals_enabled = p_enabled, updated_at = now(), updated_by = v_me
  where chain_id = p_chain;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.withdrawals', jsonb_build_object('chain', p_chain, 'old', v_old, 'new', p_enabled));
end;
$$;

-- ===== request_withdrawal (member, active chain) =====
-- Minimum: the whole position, or at least 1 USDC at the cached value: floor(p_shares * value_usdc / S_eff) >= 1_000000.
-- The amount is fixed only at approval (Task 3); this is the request.
create function public.request_withdrawal(p_shares numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_enabled boolean;
  s public.dao_state;
  p public.dao_positions;
  v_supply numeric;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';

  -- held until commit: switching withdrawals off waits for a request in flight
  select cc.withdrawals_enabled into v_enabled from public.chain_config cc where cc.chain_id = v_chain for share;
  if not coalesce(v_enabled, false) then
    raise exception 'withdrawals_disabled';
  end if;
  if p_shares is null or p_shares <= 0 or p_shares <> trunc(p_shares) then
    raise exception 'invalid_input';
  end if;

  -- dao_state before the insert (lock order), then the position
  select * into s from public.dao_state x where x.chain_id = v_chain for update;
  if not found then
    raise exception 'chain_invalid';
  end if;
  select * into p from public.dao_positions x where x.chain_id = v_chain and x.member_id = v_me for update;
  if not found or p_shares > p.shares then
    raise exception 'insufficient_shares';
  end if;

  v_supply := s.total_shares - s.approved_locked_shares;
  if p_shares <> p.shares and (v_supply <= 0 or div(p_shares * s.value_usdc, v_supply) < 1000000) then
    raise exception 'amount_too_small';
  end if;

  if exists (select 1 from public.withdrawal_requests w
             where w.chain_id = v_chain and w.member_id = v_me and w.status in ('pending', 'approved')) then
    raise exception 'withdrawal_exists';
  end if;
  begin
    insert into public.withdrawal_requests (chain_id, member_id, shares)
    values (v_chain, v_me, p_shares)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'withdrawal_exists';
  end;

  update public.dao_positions
  set locked_shares = p_shares, updated_at = now()
  where chain_id = v_chain and member_id = v_me;

  -- treasurers only learn that a request exists (no name, no amount in the notice)
  insert into public.notifications (recipient_id, kind, data)
  select m.id, 'treasury_notice', jsonb_build_object('event', 'withdrawal_requested', 'requestId', v_id)
  from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;

  return v_id;
end;
$$;

-- ===== cancel_withdrawal (owner, while pending; the switch is not needed) =====
create function public.cancel_withdrawal(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  w public.withdrawal_requests;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found or w.member_id is distinct from v_me then
    raise exception 'not_found';
  end if;
  if w.status <> 'pending' then
    raise exception 'invalid_state';
  end if;

  update public.withdrawal_requests
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = w.id;

  update public.dao_positions
  set locked_shares = 0, updated_at = now()
  where chain_id = w.chain_id and member_id = v_me;
end;
$$;

-- ===== _member_dao_standing (latest 20261018800002): unlocked shares over S_eff =====
create or replace function public._member_dao_standing(p_member uuid)
returns table (chain_id int, share_bps int, net_usdc numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (c.value #>> '{}')::int as chain from public.app_config c where c.key = 'active_chain_id'
  )
  select cfg.chain,
         case when coalesce(s.total_shares - s.approved_locked_shares, 0) <= 0 then 0
              else div(coalesce(p.shares - p.locked_shares, 0) * 10000, s.total_shares - s.approved_locked_shares)::int end,
         case when coalesce(p.locked_shares, 0) = 0 then coalesce(p.net_contributed_usdc, 0)
              else div(p.net_contributed_usdc * (p.shares - p.locked_shares), p.shares) end
  from cfg
  left join public.dao_state s on s.chain_id = cfg.chain
  left join public.dao_positions p on p.chain_id = cfg.chain and p.member_id = p_member
$$;

-- ===== dao_overview (latest 20261019100001): S_eff, my approved shares out, switch, my withdrawal =====
create or replace function public.dao_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_total numeric := 0;
  v_value numeric := 0;
  v_club numeric := 0;
  v_approved_locked numeric := 0;
  v_supply numeric := 0;
  v_nav_at timestamptz;
  v_shares numeric := 0;
  v_locked numeric := 0;
  v_my_approved numeric := 0;
  v_counted numeric := 0;
  v_net numeric := 0;
  v_pending jsonb;
  v_comp jsonb;
  v_enabled boolean;
  v_w public.withdrawal_requests;
  v_withdrawal jsonb;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select s.total_shares, s.value_usdc, s.club_shares, s.approved_locked_shares, s.nav_at
    into v_total, v_value, v_club, v_approved_locked, v_nav_at
  from public.dao_state s where s.chain_id = v_chain;
  v_total := coalesce(v_total, 0);
  v_value := coalesce(v_value, 0);
  v_supply := v_total - coalesce(v_approved_locked, 0);
  select p.shares, p.net_contributed_usdc, p.locked_shares into v_shares, v_net, v_locked
  from public.dao_positions p where p.chain_id = v_chain and p.member_id = v_me;
  v_shares := coalesce(v_shares, 0);
  v_locked := coalesce(v_locked, 0);
  select coalesce(sum(w.shares), 0) into v_my_approved
  from public.withdrawal_requests w
  where w.chain_id = v_chain and w.member_id = v_me and w.status = 'approved';
  v_counted := greatest(v_shares - v_my_approved, 0);
  select cc.withdrawals_enabled into v_enabled from public.chain_config cc where cc.chain_id = v_chain;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ledgerId', l.id, 'amount', l.amount_usdc::text, 'txHash', l.tx_hash, 'createdAt', l.created_at)
         order by l.created_at desc, l.id), '[]'::jsonb)
    into v_pending
  from public.dao_ledger l
  where l.chain_id = v_chain and l.member_id = v_me and l.status = 'pending_finality';
  select jsonb_build_object(
           'usdcUnits', n.usdc_units::text, 'ethWei', n.eth_wei::text, 'wethWei', n.weth_wei::text,
           'ethPriceE8', n.eth_price_e8::text, 'priceSource', n.price_source, 'takenAt', n.taken_at)
    into v_comp
  from public.dao_nav_snapshots n
  where n.chain_id = v_chain
  order by n.taken_at desc
  limit 1;

  -- the active request, else the newest one closed in the last 14 days
  select * into v_w from public.withdrawal_requests w
  where w.chain_id = v_chain and w.member_id = v_me and w.status in ('pending', 'approved')
  limit 1;
  if not found then
    select * into v_w from public.withdrawal_requests w
    where w.chain_id = v_chain and w.member_id = v_me and w.status in ('paid', 'rejected', 'cancelled')
      and coalesce(w.paid_at, w.rejected_at, w.cancelled_at) >= now() - interval '14 days'
    order by coalesce(w.paid_at, w.rejected_at, w.cancelled_at) desc, w.created_at desc, w.id
    limit 1;
  end if;
  if v_w.id is not null then
    v_withdrawal := jsonb_build_object(
      'id', v_w.id,
      'status', v_w.status,
      'shares', v_w.shares::text,
      'amountUsdc', v_w.amount_usdc_locked::text,
      'approvedAt', v_w.approved_at,
      'expiresAt', v_w.approved_at + interval '14 days',
      'payoutRecorded', v_w.payout_tx_hash is not null,
      'payoutTxHash', v_w.payout_tx_hash,
      'rejectReason', v_w.reject_reason,
      'lastExpiredAt', v_w.last_expired_at,
      'createdAt', v_w.created_at);
  end if;

  return jsonb_build_object(
    'chainId', v_chain,
    'totalShares', v_total::text,
    'valueUsdc', v_value::text,
    'donors', (select count(*) from public.dao_positions p where p.chain_id = v_chain and p.shares > 0),
    'myShares', v_shares::text,
    'myShareBps', case when v_supply <= 0 then 0 else div(v_counted * 10000, v_supply) end,
    'myNet', coalesce(v_net, 0)::text,
    'myPending', v_pending,
    'navUsd6', v_value::text,
    'navAt', v_nav_at,
    'sharePriceUsd6', case when v_supply <= 0 then '0' else div(v_value * 1000000000000000000, v_supply)::text end,
    'myValueUsd6', case when v_supply <= 0 then '0' else div(v_counted * v_value, v_supply)::text end,
    'clubShares', coalesce(v_club, 0)::text,
    'composition', v_comp,
    'withdrawalsEnabled', coalesce(v_enabled, false),
    'supplyShares', greatest(v_supply, 0)::text,
    'myLockedShares', v_locked::text,
    'myWithdrawal', v_withdrawal);
end;
$$;

-- ===== dao_ranking (latest 20261019100001): each holder's shares minus their approved ones, over S_eff =====
-- A holder whose whole position is approved for withdrawal no longer appears (0 counted shares).
create or replace function public.dao_ranking(p_limit int default 50)
returns table (rank int, member_id uuid, label text, share_bps int, net_usdc numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (c.value #>> '{}')::int as chain from public.app_config c where c.key = 'active_chain_id'
  ), st as (
    select s.total_shares - s.approved_locked_shares as supply, s.club_shares
    from public.dao_state s join cfg on s.chain_id = cfg.chain
  ), appr as (
    select w.member_id as mid, sum(w.shares) as sh
    from public.withdrawal_requests w join cfg on w.chain_id = cfg.chain
    where w.status = 'approved'
    group by w.member_id
  ), holders as (
    select p.member_id as mid, p.shares - coalesce(a.sh, 0) as sh, p.net_contributed_usdc as net, false as club
    from public.dao_positions p join cfg on p.chain_id = cfg.chain
    left join appr a on a.mid = p.member_id
    where p.shares - coalesce(a.sh, 0) > 0
    union all
    select null::uuid, st.club_shares, 0::numeric, true
    from st
    where st.club_shares > 0
  ), r as (
    select row_number() over (order by h.sh desc, h.club desc, h.mid)::int as rk, h.mid, h.sh, h.net, h.club
    from holders h
  )
  select r.rk,
         case when r.club then null
              when m.dao_ranking_visible or r.mid = public.current_member_id() then r.mid end,
         case when r.club then 'Fondo del club'
              when m.dao_ranking_visible or r.mid = public.current_member_id() then public._member_label(r.mid)
              else 'Anónimo' end,
         div(r.sh * 10000, st.supply)::int,
         r.net
  from r
  left join public.members m on m.id = r.mid
  cross join st
  where public.is_active_member() and st.supply > 0
  order by r.rk
  limit greatest(1, least(100, coalesce(p_limit, 50)))
$$;

-- ===== grants =====
revoke execute on function
  public._dao_supply(int),
  public.set_withdrawals_enabled(int, boolean),
  public.request_withdrawal(numeric),
  public.cancel_withdrawal(uuid)
from public, anon, authenticated, service_role;

grant execute on function public._dao_supply(int) to service_role;

grant execute on function
  public.set_withdrawals_enabled(int, boolean),
  public.request_withdrawal(numeric),
  public.cancel_withdrawal(uuid)
to authenticated;
