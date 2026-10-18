-- F3d Task 1: the per-chain DAO ledger. Members donate USDC to the active chain's Safe through the F3b payment
-- intents (purpose 'donation', target 'dao'). Crediting is two-phase: record_donation claims the transfers and writes a
-- pending_finality ledger row once the payment is mined and verified; credit_donation turns the row into shares once the
-- server saw its block finalized and re-verified it; revert_donation frees a donation that no longer verifies.
-- Money never moves through the database. A direct transfer to the Safe never touches the ledger (no intent, no row).
--
-- Share math (per chain, integers, floor division): S = dao_state.total_shares, V = dao_state.value_usdc.
--   shares = S = 0 ? d * 10^12 : floor(d * S / V);  S += shares;  V += d.

-- ===== members: opt in to the public ranking by name =====
alter table public.members add column dao_ranking_visible boolean not null default false;

-- ===== tables (RLS on, no client access: reads go through definer RPCs) =====
create table public.dao_state (
  chain_id int primary key check (chain_id in (59144, 59141)),
  total_shares numeric(78, 0) not null default 0 check (total_shares >= 0),
  value_usdc numeric(78, 0) not null default 0 check (value_usdc >= 0),
  updated_at timestamptz not null default now()
);
insert into public.dao_state (chain_id) values (59144), (59141);

create table public.dao_positions (
  chain_id int not null check (chain_id in (59144, 59141)),
  member_id uuid not null references public.members (id),
  shares numeric(78, 0) not null default 0 check (shares >= 0),
  net_contributed_usdc numeric(78, 0) not null default 0 check (net_contributed_usdc >= 0),
  updated_at timestamptz not null default now(),
  primary key (chain_id, member_id)
);
create index dao_positions_rank_idx on public.dao_positions (chain_id, shares desc);

create table public.dao_ledger (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null check (chain_id in (59144, 59141)),
  kind text not null check (kind in ('donation')),
  member_id uuid not null references public.members (id),
  amount_usdc numeric(78, 0) not null check (amount_usdc > 0),
  shares_delta numeric(78, 0) check (shares_delta is null or shares_delta > 0),
  intent_id uuid not null unique references public.payment_intents (id),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index int not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  status text not null default 'pending_finality' check (status in ('pending_finality', 'credited', 'reverted')),
  created_at timestamptz not null default now(),
  credited_at timestamptz,
  constraint dao_ledger_credited_coherent check (
    (status = 'credited') = (shares_delta is not null) and (status = 'credited') = (credited_at is not null))
);
create index dao_ledger_history_idx on public.dao_ledger (chain_id, credited_at desc) where status = 'credited';
create index dao_ledger_pending_idx on public.dao_ledger (chain_id, created_at) where status = 'pending_finality';
create index dao_ledger_member_idx on public.dao_ledger (member_id, status);

alter table public.dao_state enable row level security;
alter table public.dao_positions enable row level security;
alter table public.dao_ledger enable row level security;
revoke all on public.dao_state, public.dao_positions, public.dao_ledger from anon, authenticated;

-- ===== create_donation_intent =====
create function public.create_donation_intent(p_amount numeric, p_fee_bps int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_min_fee int;
  v_fee numeric;
  v_safe text;
  v_platform text;
  v_id uuid;
  v_exp timestamptz;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_amount is null or p_amount <> trunc(p_amount) or p_fee_bps is null then
    raise exception 'invalid_input';
  end if;
  -- 1 USDC .. 1000000 USDC
  if p_amount < 1000000 or p_amount > 1000000::numeric * 1000000 then
    raise exception 'amount_out_of_range';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select (c.value #>> '{}')::int into v_min_fee from public.app_config c where c.key = 'min_fee_bps';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_fee_bps < 0 or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;
  if p_fee_bps < coalesce(v_min_fee, 0) then
    raise exception 'fee_below_minimum';
  end if;

  select cc.safe_address, cc.platform_wallet into v_safe, v_platform
  from public.chain_config cc where cc.chain_id = v_chain;
  if v_safe is null then
    raise exception 'safe_not_configured';
  end if;

  v_fee := div(p_amount * p_fee_bps + 9999, 10000);
  if v_fee > 0 and v_platform is null then
    raise exception 'platform_not_configured';
  end if;

  -- same lock key and cap as tip intents
  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'donation', v_chain, 'USDC', p_amount, p_fee_bps, coalesce(v_min_fee, 0), v_fee,
          null, v_safe, case when v_fee > 0 then v_platform end,
          'dao', null, false)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', v_chain, 'token', 'USDC',
    'amount', p_amount::text, 'feeAmount', v_fee::text,
    'recipientAddress', v_safe, 'platformAddress', case when v_fee > 0 then v_platform end,
    'expiresAt', v_exp);
end;
$$;

-- ===== set_dao_ranking_visible =====
create function public.set_dao_ranking_visible(p_visible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_visible is null then
    raise exception 'invalid_input';
  end if;
  update public.members set dao_ranking_visible = p_visible where id = v_me;
end;
$$;

-- ===== record_donation (service_role): phase 1 =====
create function public.record_donation(p_intent uuid, p_main jsonb, p_fee jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.payment_intents;
  v_h record;
  v_safe text;
  v_id uuid;
begin
  select * into i from public.payment_intents x where x.id = p_intent for update;
  if not found or i.purpose <> 'donation' or i.target_type <> 'dao' then
    raise exception 'not_found';
  end if;
  if i.status = 'confirmed' then
    select l.id into v_id from public.dao_ledger l where l.intent_id = i.id;
    return v_id;
  end if;

  -- rechecks (NULL-safe): the intent must still describe a USDC donation to the chain's configured Safe
  select cc.safe_address into v_safe from public.chain_config cc where cc.chain_id = i.chain_id;
  if i.token is distinct from 'USDC' or i.anonymous or i.recipient_member_id is not null
     or v_safe is null or i.recipient_address is distinct from v_safe then
    raise exception 'invalid_input';
  end if;

  select * into v_h from public._record_payment_transfers(i, p_main, p_fee);

  insert into public.dao_ledger (chain_id, kind, member_id, amount_usdc, intent_id, tx_hash, log_index, block_number)
  values (i.chain_id, 'donation', i.member_id, i.amount, i.id, v_h.main_hash, (p_main ->> 'logIndex')::int, v_h.block)
  returning id into v_id;

  update public.payment_intents set status = 'confirmed' where id = i.id;
  return v_id;
end;
$$;

-- ===== credit_donation (service_role): phase 2, idempotent =====
create function public.credit_donation(p_ledger uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.dao_ledger;
  s public.dao_state;
  v_shares numeric;
begin
  select * into l from public.dao_ledger x where x.id = p_ledger for update;
  if not found then
    raise exception 'not_found';
  end if;
  if l.status = 'credited' then
    return;
  end if;
  if l.status <> 'pending_finality' then
    raise exception 'invalid_state';
  end if;

  select * into s from public.dao_state x where x.chain_id = l.chain_id for update;
  if not found then
    raise exception 'chain_invalid';
  end if;
  if s.total_shares = 0 or s.value_usdc = 0 then
    v_shares := l.amount_usdc * 1000000000000;
  else
    v_shares := div(l.amount_usdc * s.total_shares, s.value_usdc);
  end if;
  if v_shares <= 0 then
    raise exception 'invalid_state';
  end if;

  update public.dao_state
  set total_shares = s.total_shares + v_shares, value_usdc = s.value_usdc + l.amount_usdc, updated_at = now()
  where chain_id = l.chain_id;

  insert into public.dao_positions as p (chain_id, member_id, shares, net_contributed_usdc)
  values (l.chain_id, l.member_id, v_shares, l.amount_usdc)
  on conflict (chain_id, member_id) do update
    set shares = p.shares + excluded.shares,
        net_contributed_usdc = p.net_contributed_usdc + excluded.net_contributed_usdc,
        updated_at = now();

  update public.dao_ledger
  set status = 'credited', shares_delta = v_shares, credited_at = clock_timestamp()
  where id = l.id;
end;
$$;

-- ===== revert_donation (service_role) =====
-- The payment no longer verifies at finality: free its transfers so a corrected claim is possible, and fail the intent.
create function public.revert_donation(p_ledger uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.dao_ledger;
begin
  select * into l from public.dao_ledger x where x.id = p_ledger for update;
  if not found then
    raise exception 'not_found';
  end if;
  if l.status = 'reverted' then
    return;
  end if;
  if l.status <> 'pending_finality' then
    raise exception 'invalid_state';
  end if;

  update public.dao_ledger set status = 'reverted' where id = l.id;
  delete from public.onchain_transfers where intent_id = l.intent_id;
  update public.payment_intents set status = 'failed', failure_code = 'reverted' where id = l.intent_id;
end;
$$;

-- ===== reads =====
create function public.dao_overview()
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
  v_shares numeric := 0;
  v_net numeric := 0;
  v_pending jsonb;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select s.total_shares, s.value_usdc into v_total, v_value from public.dao_state s where s.chain_id = v_chain;
  select p.shares, p.net_contributed_usdc into v_shares, v_net
  from public.dao_positions p where p.chain_id = v_chain and p.member_id = v_me;
  select coalesce(jsonb_agg(jsonb_build_object(
           'ledgerId', l.id, 'amount', l.amount_usdc::text, 'txHash', l.tx_hash, 'createdAt', l.created_at)
         order by l.created_at desc, l.id), '[]'::jsonb)
    into v_pending
  from public.dao_ledger l
  where l.chain_id = v_chain and l.member_id = v_me and l.status = 'pending_finality';

  return jsonb_build_object(
    'chainId', v_chain,
    'totalShares', coalesce(v_total, 0)::text,
    'valueUsdc', coalesce(v_value, 0)::text,
    'donors', (select count(*) from public.dao_positions p where p.chain_id = v_chain and p.shares > 0),
    'myShares', coalesce(v_shares, 0)::text,
    'myShareBps', case when coalesce(v_total, 0) = 0 then 0 else div(coalesce(v_shares, 0) * 10000, v_total) end,
    'myNet', coalesce(v_net, 0)::text,
    'myPending', v_pending);
end;
$$;

create function public.dao_ranking(p_limit int default 50)
returns table (rank int, member_id uuid, label text, share_bps int, net_usdc numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (c.value #>> '{}')::int as chain from public.app_config c where c.key = 'active_chain_id'
  ), st as (
    select s.total_shares from public.dao_state s join cfg on s.chain_id = cfg.chain
  ), r as (
    select row_number() over (order by p.shares desc, p.member_id)::int as rk,
           p.member_id as mid, p.shares as sh, p.net_contributed_usdc as net
    from public.dao_positions p join cfg on p.chain_id = cfg.chain
    where p.shares > 0
  )
  select r.rk,
         case when m.dao_ranking_visible or r.mid = public.current_member_id() then r.mid end,
         case when m.dao_ranking_visible or r.mid = public.current_member_id()
              then public._member_label(r.mid) else 'Anónimo' end,
         div(r.sh * 10000, st.total_shares)::int,
         r.net
  from r
  join public.members m on m.id = r.mid
  cross join st
  where public.is_active_member() and st.total_shares > 0
  order by r.rk
  limit greatest(1, least(100, coalesce(p_limit, 50)))
$$;

create function public.dao_history(p_limit int default 50)
returns table (ledger_id uuid, member_id uuid, label text, amount numeric, tx_hash text, credited_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (c.value #>> '{}')::int as chain from public.app_config c where c.key = 'active_chain_id'
  )
  select l.id,
         case when m.dao_ranking_visible or l.member_id = public.current_member_id() then l.member_id end,
         case when m.dao_ranking_visible or l.member_id = public.current_member_id()
              then public._member_label(l.member_id) else 'Anónimo' end,
         l.amount_usdc, l.tx_hash, l.credited_at
  from public.dao_ledger l
  join cfg on l.chain_id = cfg.chain
  join public.members m on m.id = l.member_id
  where public.is_active_member() and l.status = 'credited'
  order by l.credited_at desc, l.id
  limit greatest(1, least(100, coalesce(p_limit, 50)))
$$;

create function public.my_dao_position(p_chain int default null)
returns table (chain_id int, shares text, share_bps int, net_usdc numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  v_chain := coalesce(p_chain, (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id'));
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  return query
  select v_chain,
         coalesce(p.shares, 0)::text,
         case when coalesce(s.total_shares, 0) = 0 then 0 else div(coalesce(p.shares, 0) * 10000, s.total_shares)::int end,
         coalesce(p.net_contributed_usdc, 0)
  from (select 1) one
  left join public.dao_positions p on p.chain_id = v_chain and p.member_id = v_me
  left join public.dao_state s on s.chain_id = v_chain;
end;
$$;

-- ===== grants =====
revoke execute on function
  public.create_donation_intent(numeric, int),
  public.set_dao_ranking_visible(boolean),
  public.record_donation(uuid, jsonb, jsonb),
  public.credit_donation(uuid),
  public.revert_donation(uuid),
  public.dao_overview(),
  public.dao_ranking(int),
  public.dao_history(int),
  public.my_dao_position(int)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_donation_intent(numeric, int),
  public.set_dao_ranking_visible(boolean),
  public.dao_overview(),
  public.dao_ranking(int),
  public.dao_history(int),
  public.my_dao_position(int)
to authenticated;

grant execute on function
  public.record_donation(uuid, jsonb, jsonb),
  public.credit_donation(uuid),
  public.revert_donation(uuid)
to service_role;
