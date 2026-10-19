-- F4d Task 3: join / leave, the weight snapshot at close, the draw with the revealed seed and the first block after the
-- close, the member and treasurer reads, and the raffle notices.
--
--   enter_raffle / leave_raffle   active member, open raffle of the active chain, refused from closes_at on even before
--                                 the cron closes it (raffle_closed). Entries keep clock_timestamp() order.
--   close_due_raffles (service)   per due raffle, in id order FOR UPDATE: positions (entered_at, member_id), weights
--                                 (equal: 1, weighted: unlocked shares; inactive/banned 0; the club fund never enters),
--                                 total_weight, status closed. Total 0 -> void: seed revealed, prize back into the
--                                 cached value_usdc, no notice.
--   draw_raffle (service)         after viem read the first block past closes_at and it is finalized: the seed is
--                                 revealed and deleted, random = uint256(keccak256(seed || hash)), the weighted walk
--                                 picks the winner (the same as raffle_draw_preview on the public values). Idempotent:
--                                 the same block again -> 'already'. raffle_won to the winner, treasury_notice
--                                 raffle_drawn to every active bit-256 holder.
--   dao_raffles / raffle_detail   members; seedReveal is null until drawn or void; hidden members are 'Anónimo #n',
--                                 a hidden winner 'Anónimo'; the payout hash only for treasurers and the winner.
--   treasury_raffles (bit 256)    real labels and the winner's wallet (the treasurer pays it); no seed column.
--   _push_build                   raffle_won, and treasury_notice raffle_drawn / raffle_unpaid (url #sorteos).
--
-- Carried from the Task 2 review:
--   - 20261019400002's three per-schema ALTER DEFAULT PRIVILEGES ... REVOKE lines on schema private are no-ops (a
--     per-schema default can only add to the global ones, and none grants anything there). They are harmless and stay;
--     what keeps the seed out of reach is that no API role has USAGE on schema private (pinned in 961), plus the
--     explicit revoke on private.raffle_seeds.
--   - credit_donation, quote_withdrawal and approve_withdrawal refuse an explicit p_eth_price_e8 <= 0 (invalid_input);
--     the internal coalesce(..., 0) fallback in the liabilities stays.
--   - Titles are trimmed of the full whitespace set E' \t\n\r\f\v' (create_raffle and the table check), like cancel.
--   - raffles_cancel_coherent also requires cancelled_by and cancel_reason on a cancelled raffle.
-- Lock order: raffle row (for update / for share) -> chain_config (for share) -> dao_state (for update) -> dao_positions.

-- ===== carry: titles trimmed of every whitespace; a cancelled raffle names who and why =====
alter table public.raffles drop constraint raffles_title_check;
alter table public.raffles add constraint raffles_title_check
  check (title = btrim(title, E' \t\n\r\f\v') and char_length(title) between 1 and 80);
alter table public.raffles drop constraint raffles_cancel_coherent;
alter table public.raffles add constraint raffles_cancel_coherent check (
  (status = 'cancelled') = (cancelled_at is not null)
  and (status <> 'cancelled' or (cancelled_by is not null and cancel_reason is not null)));

-- ===== credit_donation (latest 20261019400002): a given ETH price must be positive =====
create or replace function public.credit_donation(p_ledger uuid, p_assets_usd6 numeric, p_assets_block bigint,
                                       p_eth_price_e8 numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.dao_ledger;
  s public.dao_state;
  v_nav numeric;
  v_total numeric;
  v_club numeric := 0;
  v_shares numeric;
begin
  if p_assets_usd6 is null or p_assets_usd6 < 0 or p_assets_usd6 <> trunc(p_assets_usd6)
     or p_assets_block is null or p_assets_block < 0
     or (p_eth_price_e8 is not null and (p_eth_price_e8 <= 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;

  select * into l from public.dao_ledger x where x.id = p_ledger for update;
  if not found then
    raise exception 'not_found';
  end if;
  if l.status = 'credited' then
    return jsonb_build_object('shares', l.shares_delta::text, 'clubMinted', '0');
  end if;
  if l.status <> 'pending_finality' then
    raise exception 'invalid_state';
  end if;
  if l.block_number > p_assets_block then
    raise exception 'assets_stale';
  end if;

  select * into s from public.dao_state x where x.chain_id = l.chain_id for update;
  if not found then
    raise exception 'chain_invalid';
  end if;

  -- a credited donation is no longer a liability: a read that predates its money would understate NAV
  if exists (select 1 from public.dao_ledger c
             where c.chain_id = l.chain_id and c.status = 'credited' and c.block_number > p_assets_block) then
    raise exception 'assets_stale';
  end if;
  -- F4c-R7 (a): a read past the scan cursor may miss a payout that already left the Safe
  if not public._dao_assets_covered(l.chain_id, p_assets_block) then
    raise exception 'assets_stale';
  end if;

  -- this donation is still pending, so it is one of the liabilities: NAV_previo excludes it (open prizes at the price)
  v_nav := greatest(p_assets_usd6 - public._dao_liabilities_usd6(l.chain_id, p_assets_block, p_eth_price_e8), 0);
  -- F4c: the counted supply; approved shares are out of it (their fixed amount is a liability)
  v_total := s.total_shares - s.approved_locked_shares;

  if v_total = 0 then
    -- whatever the Safe held before the first (counted) donor belongs to the club fund
    if v_nav > 0 then
      v_club := v_nav * 1000000000000;
    end if;
    v_shares := l.amount_usdc * 1000000000000;
  else
    if v_nav = 0 then
      raise exception 'invalid_state';
    end if;
    -- first valuation of an F3 ledger: the excess over the ledger value goes to the club at the ledger price
    if not s.nav_initialized and s.value_usdc > 0 and v_nav > s.value_usdc then
      v_club := div((v_nav - s.value_usdc) * v_total, s.value_usdc);
      v_total := v_total + v_club;
    end if;
    v_shares := div(l.amount_usdc * v_total, v_nav);
  end if;
  if v_shares <= 0 then
    raise exception 'shares_zero';
  end if;

  update public.dao_state
  set total_shares = s.total_shares + v_club + v_shares,
      club_shares = s.club_shares + v_club,
      value_usdc = v_nav + l.amount_usdc,
      nav_initialized = true,
      nav_at = now(),
      updated_at = now()
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

  return jsonb_build_object('shares', v_shares::text, 'clubMinted', v_club::text);
end;
$$;

-- ===== quote_withdrawal (latest 20261019400002): a given ETH price must be positive =====
create or replace function public.quote_withdrawal(p_request uuid, p_safe text, p_assets_usd6 numeric, p_assets_block bigint,
                                        p_eth_price_e8 numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  v record;
begin
  if p_assets_usd6 is null or p_assets_usd6 < 0 or p_assets_usd6 <> trunc(p_assets_usd6)
     or p_assets_block is null or p_assets_block < 0
     or (p_eth_price_e8 is not null and (p_eth_price_e8 <= 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;
  select * into w from public.withdrawal_requests x where x.id = p_request;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status <> 'pending' then
    raise exception 'invalid_state';
  end if;

  select * into v from public._withdrawal_valuation(w, p_safe, p_assets_usd6, p_assets_block, false, p_eth_price_e8);

  return jsonb_build_object(
    'amountUsdc', v.amount::text,
    'navUsd6', v.nav::text,
    'supplyShares', v.supply::text,
    'reservedUsdc', (select coalesce(sum(x.amount_usdc_locked), 0)::text from public.withdrawal_requests x
                     where x.chain_id = w.chain_id and x.status = 'approved' and x.payout_tx_hash is null));
end;
$$;

-- ===== approve_withdrawal (latest 20261019400002): a given ETH price must be positive =====
create or replace function public.approve_withdrawal(p_request uuid, p_actor uuid, p_safe text, p_assets_usd6 numeric,
                                          p_assets_block bigint, p_eth_price_e8 numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  v record;
  v_wallet text;
  v_self boolean;
begin
  if p_actor is null or not exists (select 1 from public.members m where m.id = p_actor and m.status = 'active')
     or (public.member_global_permissions(p_actor) & 256) = 0 then
    raise exception 'forbidden';
  end if;
  if p_assets_usd6 is null or p_assets_usd6 < 0 or p_assets_usd6 <> trunc(p_assets_usd6)
     or p_assets_block is null or p_assets_block < 0
     or (p_eth_price_e8 is not null and (p_eth_price_e8 <= 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;

  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status <> 'pending' then
    raise exception 'invalid_state';
  end if;

  -- chain_config (share) -> dao_state (update), then the amount at the fresh NAV over S_eff
  select * into v from public._withdrawal_valuation(w, p_safe, p_assets_usd6, p_assets_block, true, p_eth_price_e8);

  select lower(m.wallet_address) into v_wallet from public.members m where m.id = w.member_id;
  v_self := p_actor = w.member_id;

  update public.withdrawal_requests
  set status = 'approved',
      amount_usdc_locked = v.amount,
      destination_address = v_wallet,
      approved_by = p_actor,
      approved_at = now(),
      self_approved = v_self,
      approval_count = approval_count + 1,
      updated_at = now()
  where id = w.id;

  -- the shares leave S_eff and the fixed amount becomes a liability: the cached NAV follows (carry i)
  update public.dao_state
  set approved_locked_shares = approved_locked_shares + w.shares,
      value_usdc = greatest(v.nav - v.amount, 0),
      nav_at = now(),
      updated_at = now()
  where chain_id = w.chain_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'withdrawal_approved', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'amount', v.amount::text, 'selfApproved', v_self, 'navUsd6', v.nav::text,
    'supplyShares', v.supply::text, 'assetsBlock', p_assets_block));

  insert into public.notifications (recipient_id, kind, data)
  values (w.member_id, 'withdrawal_approved', jsonb_build_object('requestId', w.id, 'amount', v.amount::text));

  return jsonb_build_object('amountUsdc', v.amount::text, 'selfApproved', v_self);
end;
$$;

-- ===== create_raffle (latest 20261019400002): the title is trimmed of every whitespace =====
create or replace function public.create_raffle(p_title text, p_prize_token text, p_prize_amount numeric, p_closes_at timestamptz,
                                     p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_title text := btrim(coalesce(p_title, ''), E' \t\n\r\f\v');
  v_chain int;
  v_weighted boolean;
  s public.dao_state;
  v_price numeric;
  v_value numeric;
  v_seed bytea;
  v_commit text;
  v_id uuid;
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'title_required';
  end if;
  if p_prize_token is null or p_prize_token not in ('USDC', 'WETH')
     or p_mode is null or p_mode not in ('equal', 'weighted')
     or p_prize_amount is null or p_prize_amount <> trunc(p_prize_amount) then
    raise exception 'invalid_input';
  end if;
  if (p_prize_token = 'USDC' and p_prize_amount < 1000000)
     or (p_prize_token = 'WETH' and p_prize_amount < 1000000000000000) then
    raise exception 'prize_too_small';
  end if;
  if p_closes_at is null or p_closes_at < now() + interval '1 hour' or p_closes_at > now() + interval '30 days' then
    raise exception 'closes_at_invalid';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  -- held until commit: the switch and a Safe change wait for this raffle
  select cc.weighted_raffles_enabled into v_weighted from public.chain_config cc where cc.chain_id = v_chain for share;
  if not found then
    raise exception 'chain_invalid';
  end if;
  if p_mode = 'weighted' and not v_weighted then
    raise exception 'weighted_raffles_disabled';
  end if;

  select * into s from public.dao_state x where x.chain_id = v_chain for update;
  if not found or not s.nav_initialized then
    raise exception 'nav_not_ready';
  end if;
  if p_prize_token = 'USDC' then
    v_value := p_prize_amount;
  else
    select n.eth_price_e8 into v_price from public.dao_nav_snapshots n
    where n.chain_id = v_chain order by n.taken_at desc limit 1;
    if v_price is null then
      raise exception 'nav_not_ready';
    end if;
    v_value := div(p_prize_amount * v_price, 100000000000000000000);
  end if;
  if v_value > s.value_usdc then
    raise exception 'prize_too_large';
  end if;

  v_seed := extensions.gen_random_bytes(32);
  v_commit := '0x' || encode(public._keccak256(v_seed), 'hex');

  insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at,
                              seed_commit, created_by)
  values (v_chain, v_title, p_prize_token, p_prize_amount, v_value, p_mode, p_closes_at, v_commit, v_me)
  returning id into v_id;
  insert into private.raffle_seeds (raffle_id, seed) values (v_id, v_seed);

  -- the prize is a liability from now on: the cached NAV follows in the same transaction
  update public.dao_state
  set value_usdc = greatest(s.value_usdc - v_value, 0), updated_at = now()
  where chain_id = v_chain;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'raffle_created', 'raffle', v_id, jsonb_build_object(
    'raffle', v_id, 'token', p_prize_token, 'amount', p_prize_amount::text, 'valueUsd6', v_value::text,
    'mode', p_mode, 'closesAt', p_closes_at, 'commit', v_commit));

  return jsonb_build_object('id', v_id, 'commit', v_commit);
end;
$$;

-- ===== enter_raffle / leave_raffle (active member; open raffle of the active chain, before closes_at) =====
-- The raffle row is read FOR SHARE: close_due_raffles takes it FOR UPDATE, so a join in flight either commits before the
-- weight snapshot (and is in it) or waits for the close and then sees raffle_closed. From closes_at on, joining and
-- leaving are refused even while the cron has not closed the raffle yet (Review Focus 2).
create function public.enter_raffle(p_raffle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  r public.raffles;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select * into r from public.raffles x where x.id = p_raffle and x.chain_id = v_chain for share;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status <> 'open' or now() >= r.closes_at then
    raise exception 'raffle_closed';
  end if;

  -- clock_timestamp: entries made in one transaction still get their own order (position = (entered_at, member_id))
  insert into public.raffle_entries (raffle_id, member_id, entered_at)
  values (r.id, v_me, clock_timestamp())
  on conflict (raffle_id, member_id) do nothing;
end;
$$;

create function public.leave_raffle(p_raffle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  r public.raffles;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select * into r from public.raffles x where x.id = p_raffle and x.chain_id = v_chain for share;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status <> 'open' or now() >= r.closes_at then
    raise exception 'raffle_closed';
  end if;

  delete from public.raffle_entries e where e.raffle_id = r.id and e.member_id = v_me;
end;
$$;

-- ===== close_due_raffles (service role, cron): the weight snapshot, or void when nobody can win =====
-- Each due raffle, in id order and FOR UPDATE: positions in (entered_at, member_id) order; weights equal = 1 for an
-- active member, weighted = greatest(shares - locked_shares, 0) on the raffle's chain for an active member, else 0. The
-- club fund has no member row, so it never enters. The weights are never written again.
-- Total 0 -> void: the seed is revealed (copied, then deleted) and the prize goes back into the cached value.
-- Lock order: raffle row (for update) -> dao_state (for update, void only).
create function public.close_due_raffles(p_chain int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  v_entries int;
  v_total numeric;
  v_seed text;
  v_closed int := 0;
  v_voided int := 0;
begin
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;

  for r in
    select * from public.raffles x
    where x.chain_id = p_chain and x.status = 'open' and x.closes_at <= now()
    order by x.id
    for update
  loop
    update public.raffle_entries e
    set position = o.pos,
        weight = o.w
    from (select e2.member_id,
                 row_number() over (order by e2.entered_at, e2.member_id)::int as pos,
                 case when m.status <> 'active' then 0
                      when r.mode = 'equal' then 1
                      else greatest(coalesce(p.shares, 0) - coalesce(p.locked_shares, 0), 0) end as w
          from public.raffle_entries e2
          join public.members m on m.id = e2.member_id
          left join public.dao_positions p on p.chain_id = r.chain_id and p.member_id = e2.member_id
          where e2.raffle_id = r.id) o
    where e.raffle_id = r.id and e.member_id = o.member_id;

    select count(*)::int, coalesce(sum(e.weight), 0) into v_entries, v_total
    from public.raffle_entries e where e.raffle_id = r.id;

    if v_total > 0 then
      update public.raffles
      set status = 'closed', closed_at = now(), total_weight = v_total, updated_at = now()
      where id = r.id;
      insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
      values (null, 'raffle_closed', 'raffle', r.id, jsonb_build_object(
        'raffle', r.id, 'entries', v_entries, 'totalWeight', v_total::text));
      v_closed := v_closed + 1;
    else
      select '0x' || encode(s.seed, 'hex') into v_seed from private.raffle_seeds s where s.raffle_id = r.id;
      if v_seed is null then
        raise exception 'invalid_state';
      end if;
      update public.raffles
      set status = 'void', closed_at = now(), total_weight = 0, seed_reveal = v_seed, updated_at = now()
      where id = r.id;
      delete from private.raffle_seeds s where s.raffle_id = r.id;

      -- nobody can win: the prize is no longer owed and the cached NAV gets it back (raffle row -> dao_state)
      update public.dao_state
      set value_usdc = value_usdc + r.prize_value_usd6, updated_at = now()
      where chain_id = r.chain_id;

      insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
      values (null, 'raffle_voided', 'raffle', r.id, jsonb_build_object(
        'raffle', r.id, 'entries', v_entries, 'totalWeight', '0', 'valueUsd6', r.prize_value_usd6::text));
      v_voided := v_voided + 1;
    end if;
  end loop;

  return jsonb_build_object('closed', v_closed, 'voided', v_voided);
end;
$$;

-- ===== raffles_awaiting_draw (service role): closed raffles, oldest close first =====
create function public.raffles_awaiting_draw(p_chain int)
returns table (raffle_id uuid, closes_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.closes_at from public.raffles r
  where r.chain_id = p_chain and r.status = 'closed'
  order by r.closes_at, r.id
$$;

-- ===== draw_raffle (service role, after viem read the first block after closes_at and it is finalized) =====
-- random = uint256(keccak256(seed || blockHash)); winner = the first position whose running weight sum is > random mod
-- total (raffle_draw_preview gives the same answer from the public values). The seed is revealed here and deleted.
-- The raffle row FOR UPDATE makes the draw idempotent under concurrency: a second caller waits, then sees 'drawn' and
-- gets 'already' for the same block.
create function public.draw_raffle(p_raffle uuid, p_block jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  v_number bigint;
  v_hash text;
  v_time timestamptz;
  v_parent timestamptz;
  v_seed bytea;
  v_weights numeric[];
  v_random numeric;
  v_pos int;
  v_winner uuid;
  v_wallet text;
begin
  if p_block is null or jsonb_typeof(p_block) <> 'object'
     or coalesce(p_block ->> 'number', '') !~ '^[0-9]{1,18}$'
     or coalesce(p_block ->> 'hash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or jsonb_typeof(p_block -> 'timestamp') is distinct from 'string'
     or jsonb_typeof(p_block -> 'parentTimestamp') is distinct from 'string' then
    raise exception 'invalid_input';
  end if;
  v_number := (p_block ->> 'number')::bigint;
  v_hash := lower(p_block ->> 'hash');
  begin
    v_time := (p_block ->> 'timestamp')::timestamptz;
    v_parent := (p_block ->> 'parentTimestamp')::timestamptz;
  exception when others then
    raise exception 'invalid_input';
  end;
  if v_time is null or v_parent is null or not isfinite(v_time) or not isfinite(v_parent) then
    raise exception 'invalid_input';
  end if;

  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status in ('drawn', 'paid') then
    if r.draw_block_number = v_number and r.draw_block_hash = v_hash then
      return jsonb_build_object('status', 'already', 'winnerPosition', r.winner_position);
    end if;
    raise exception 'invalid_state';
  end if;
  if r.status <> 'closed' or coalesce(r.total_weight, 0) <= 0 then
    raise exception 'invalid_state';
  end if;
  -- the first block after the close: its own time is past closes_at, its parent's is not
  if not (v_time > r.closes_at and r.closes_at >= v_parent) then
    raise exception 'draw_block_invalid';
  end if;

  select s.seed into v_seed from private.raffle_seeds s where s.raffle_id = r.id;
  if v_seed is null then
    raise exception 'invalid_state';
  end if;
  select array_agg(e.weight order by e.position) into v_weights
  from public.raffle_entries e where e.raffle_id = r.id;

  v_random := public._uint256_be(public._keccak256(v_seed || decode(substr(v_hash, 3), 'hex')));
  v_pos := public._raffle_pick(v_random, v_weights);
  select e.member_id into v_winner from public.raffle_entries e where e.raffle_id = r.id and e.position = v_pos;
  select lower(m.wallet_address) into v_wallet from public.members m where m.id = v_winner;
  if v_pos is null or v_winner is null or v_wallet is null then
    raise exception 'invalid_state';
  end if;

  update public.raffles
  set status = 'drawn',
      seed_reveal = '0x' || encode(v_seed, 'hex'),
      draw_block_number = v_number,
      draw_block_hash = v_hash,
      draw_block_time = v_time,
      draw_random = v_random::text,
      winner_position = v_pos,
      winner_member_id = v_winner,
      winner_address = v_wallet,
      drawn_at = now(),
      updated_at = now()
  where id = r.id;
  delete from private.raffle_seeds s where s.raffle_id = r.id;

  insert into public.notifications (recipient_id, kind, data)
  values (v_winner, 'raffle_won', jsonb_build_object(
    'raffleId', r.id, 'title', r.title, 'token', r.prize_token, 'amount', r.prize_amount::text));

  -- treasurers learn that a prize is owed (the winner's name is on the treasury page)
  insert into public.notifications (recipient_id, kind, data)
  select m.id, 'treasury_notice', jsonb_build_object('event', 'raffle_drawn', 'raffleId', r.id)
  from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_drawn', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'block', v_number, 'hash', v_hash, 'random', v_random::text, 'winnerPosition', v_pos));

  return jsonb_build_object('status', 'drawn', 'winnerPosition', v_pos);
end;
$$;

-- ===== _raffle_card (internal): the member-facing card of raffle r for viewer p_me =====
-- Privacy (my decision 10): the winner's label is the viewer's own, the real one if visible in the ranking, else
-- 'Anónimo'. The seed is whatever seed_reveal holds: null until drawn or void (raffles_reveal_coherent).
create function public._raffle_card(r public.raffles, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'prizeToken', r.prize_token,
    'prizeAmount', r.prize_amount::text,
    'mode', r.mode,
    'closesAt', r.closes_at,
    'status', r.status,
    'entries', (select count(*)::int from public.raffle_entries e where e.raffle_id = r.id),
    'iEntered', exists (select 1 from public.raffle_entries e where e.raffle_id = r.id and e.member_id = p_me),
    'myWeight', (select e.weight::text from public.raffle_entries e where e.raffle_id = r.id and e.member_id = p_me),
    'totalWeight', r.total_weight::text,
    'commit', r.seed_commit,
    'seedReveal', r.seed_reveal,
    'drawBlockNumber', r.draw_block_number::text,
    'winnerLabel', case when r.winner_member_id is null then null
                        when r.winner_member_id = p_me
                             or (select m.dao_ranking_visible from public.members m where m.id = r.winner_member_id)
                          then public._member_label(r.winner_member_id)
                        else 'Anónimo' end,
    'iWon', coalesce(r.winner_member_id = p_me, false),
    'unpaid', coalesce(r.status = 'drawn' and r.payout_tx_hash is null and r.drawn_at < now() - interval '14 days', false),
    'paidLate', coalesce(r.status = 'paid' and r.payout_block_time > r.drawn_at + interval '14 days', false),
    'payoutRecorded', r.payout_tx_hash is not null,
    'cancelReason', r.cancel_reason,
    'createdAt', r.created_at)
$$;

-- ===== dao_raffles (members): active raffles by closes_at, then up to p_limit past ones, most recent end first =====
create function public.dao_raffles(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_limit int := greatest(1, least(100, coalesce(p_limit, 20)));
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';

  return (
    select coalesce(jsonb_agg(public._raffle_card(x.r, v_me) order by x.grp, x.ord), '[]'::jsonb)
    from (
      (select a as r, 0 as grp, row_number() over (order by a.closes_at, a.id) as ord
       from public.raffles a
       where a.chain_id = v_chain and a.status in ('open', 'closed'))
      union all
      (select p as r, 1 as grp,
              row_number() over (order by coalesce(p.drawn_at, p.cancelled_at, p.closed_at, p.created_at) desc, p.id) as ord
       from public.raffles p
       where p.chain_id = v_chain and p.status not in ('open', 'closed')
       order by coalesce(p.drawn_at, p.cancelled_at, p.closed_at, p.created_at) desc, p.id
       limit v_limit)
    ) x);
end;
$$;

-- ===== raffle_detail (members): the card plus the draw inputs and the entry list =====
-- entryList: by position once closed, by (entered_at, member_id) before; the viewer sees their own label (isMe);
-- a member hidden from the ranking is 'Anónimo #n', n = their 1-based rank among the hidden entries in list order
-- (the viewer counts too when hidden, so every viewer numbers the same person the same way). The payout hash goes
-- only to treasurers (bit 256) and the winner.
create function public.raffle_detail(p_raffle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  r public.raffles;
  v_treasurer boolean;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select * into r from public.raffles x where x.id = p_raffle and x.chain_id = v_chain;
  if not found then
    raise exception 'not_found';
  end if;
  v_treasurer := public.has_global_perm(256);

  return public._raffle_card(r, v_me) || jsonb_build_object(
    'chainId', r.chain_id,
    'drawBlockHash', r.draw_block_hash,
    'drawBlockTime', r.draw_block_time,
    'drawRandom', r.draw_random,
    'winnerPosition', r.winner_position,
    'payoutTxHash', case when v_treasurer or r.winner_member_id = v_me then r.payout_tx_hash end,
    'entryList', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', l.position,
               'label', case when l.is_me or l.visible then public._member_label(l.member_id)
                             else 'Anónimo #' || l.hidden_rank end,
               'weight', l.weight::text,
               'isMe', l.is_me) order by l.ord), '[]'::jsonb)
      from (select e.member_id, e.position, e.weight, e.member_id = v_me as is_me, m.dao_ranking_visible as visible,
                   row_number() over w as ord,
                   count(*) filter (where not m.dao_ranking_visible) over w as hidden_rank
            from public.raffle_entries e
            join public.members m on m.id = e.member_id
            where e.raffle_id = r.id
            window w as (order by e.position nulls last, e.entered_at, e.member_id
                         rows between unbounded preceding and current row)) l));
end;
$$;

-- ===== treasury_raffles (bit 256): live raffles plus those ended in the last 30 days, with real labels =====
create function public.treasury_raffles()
returns table (id uuid, title text, status text, prize_token text, prize_amount text, prize_value_usd6 text, mode text,
               closes_at timestamptz, entries int, total_weight text, winner_member_id uuid, winner_label text,
               winner_address text, drawn_at timestamptz, unpaid boolean, payout_tx_hash text,
               payout_recorded_at timestamptz, paid_at timestamptz, cancel_reason text, created_by_label text,
               created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_chain int;
begin
  if public.current_member_id() is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';

  return query
  select r.id, r.title, r.status, r.prize_token, r.prize_amount::text, r.prize_value_usd6::text, r.mode, r.closes_at,
         (select count(*)::int from public.raffle_entries e where e.raffle_id = r.id),
         r.total_weight::text,
         r.winner_member_id,
         public._member_label(r.winner_member_id), -- the real label: the treasurer pays this member
         r.winner_address,
         r.drawn_at,
         coalesce(r.status = 'drawn' and r.payout_tx_hash is null and r.drawn_at < now() - interval '14 days', false),
         r.payout_tx_hash, r.payout_recorded_at, r.paid_at, r.cancel_reason,
         public._member_label(r.created_by),
         r.created_at
  from public.raffles r
  where r.chain_id = v_chain
    and (r.status in ('open', 'closed', 'drawn')
         or coalesce(r.paid_at, r.cancelled_at, r.closed_at) >= now() - interval '30 days')
  order by (r.status in ('open', 'closed', 'drawn')) desc, r.created_at desc, r.id;
end;
$$;

-- ===== _push_build (latest 20261019300003) + raffle_won and the raffle treasury notices =====
create or replace function public._push_build(p_id bigint)
returns table (title text, body text, url text, tag text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  n public.notifications;
  v_perms bigint := 0;
  v_actor text;
  v_wallet text;
  v_channel text;
  v_subject text;
  v_phrase text;
  v_title text;
  v_url text;
  v_excerpt text;
  v_root text;
  v_asset text;
  v_raffle_title text;
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.kind in ('mention', 'reply', 'channel_message') and n.channel_id is null then
    return;
  end if;
  if n.channel_id is not null then
    v_perms := public.channel_permissions(n.recipient_id, n.channel_id);
    if (v_perms & 1) = 0 then
      return;
    end if;
  end if;
  if n.ticket_id is not null and not public._member_can_access_ticket(n.recipient_id, n.ticket_id) then
    return;
  end if;
  if n.kind = 'report_new' and (v_perms & 8) = 0 then
    return;
  end if;
  if n.kind = 'member_review' and (public.member_global_permissions(n.recipient_id) & (32 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_mismatch' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_outflow' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_notice' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;

  select coalesce('@' || a.handle::text,
                  '@' || nullif(btrim(regexp_replace(a.display_name, '[[:cntrl:]]+', ' ', 'g')), ''),
                  '@' || left(a.wallet_address, 6) || '…' || right(a.wallet_address, 4)),
         a.wallet_address
    into v_actor, v_wallet
  from public.members a where a.id = n.actor_id;
  v_actor := coalesce(v_actor, case when n.kind = 'tip_received' then 'Anónimo' else 'Alguien' end);

  if n.channel_id is not null then
    select btrim(regexp_replace(c.name, '[[:cntrl:]]+', ' ', 'g')) into v_channel
    from public.channels c where c.id = n.channel_id;
  end if;
  if n.ticket_id is not null then
    select btrim(regexp_replace(t.subject, '[[:cntrl:]]+', ' ', 'g')) into v_subject
    from public.tickets t where t.id = n.ticket_id;
  end if;

  v_url := '/notifications';
  if n.kind in ('mention', 'reply', 'channel_message') then
    v_url := '/c/' || n.channel_id::text;
    v_root := n.data ->> 'thread_root_id';
    if n.message_id is not null then
      -- jump to (and highlight) the exact message, like the in-app link (src/lib/notifications/queries.ts)
      v_url := v_url || '?m=' || n.message_id::text;
      if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_url := v_url || '&thread=' || v_root;
      end if;
      v_url := v_url || '&h=n' || n.id::text;
    elsif v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_url := v_url || '?thread=' || v_root;
    end if;
    select btrim(left(btrim(regexp_replace(m.body_text, '[[:space:][:cntrl:]]+', ' ', 'g')), 80)) into v_excerpt
    from public.messages m
    where m.id = n.message_id and m.channel_id = n.channel_id and m.deleted_at is null;
    v_excerpt := nullif(v_excerpt, '');
  elsif n.kind in ('tip_received', 'bounty_solution', 'bounty_paid') then
    if n.channel_id is not null then
      v_url := '/c/' || n.channel_id::text;
      v_root := n.data ->> 'threadRootId';
      if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_url := v_url || '?thread=' || v_root;
      end if;
    end if;
  elsif n.kind in ('invite_redeemed', 'godchild_banned', 'sponsor_penalized') then
    if v_wallet is not null then
      v_url := '/u/' || v_wallet;
    end if;
  elsif n.kind = 'report_new' then
    v_url := '/moderation/reports';
  elsif n.kind = 'member_review' then
    v_url := '/admin/members';
  elsif n.kind = 'treasury_mismatch' then
    v_url := '/dao';
  elsif n.kind = 'treasury_notice' and n.data ->> 'event' in ('raffle_drawn', 'raffle_unpaid') then
    v_url := '/dao/tesoreria#sorteos';
  elsif n.kind in ('treasury_outflow', 'treasury_notice') then
    v_url := '/dao/tesoreria'; -- ruling F4a-R1
  elsif n.kind in ('withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired') then
    v_url := '/dao#retirada';
  elsif n.ticket_id is not null then
    v_url := '/tickets/' || n.ticket_id::text;
  end if;

  case n.kind
    when 'mention' then
      v_title := 'Nueva mención';
      v_phrase := v_actor || ' te mencionó en #' || coalesce(v_channel, '');
    when 'reply' then
      v_title := 'Nueva respuesta';
      v_phrase := v_actor || ' respondió en #' || coalesce(v_channel, '');
    when 'channel_message' then
      v_title := 'Nuevo mensaje';
      v_phrase := v_actor || ' publicó en #' || coalesce(v_channel, '');
    when 'tip_received' then
      v_title := 'Nueva propina';
      v_phrase := 'Has recibido una propina de ' || v_actor;
    when 'bounty_solution' then
      v_title := 'Solución elegida';
      v_phrase := v_actor || ' ha elegido tu respuesta como solución del bounty';
    when 'bounty_paid' then
      v_title := 'Bounty pagado';
      v_phrase := v_actor || ' te ha pagado el bounty';
    when 'invite_redeemed' then
      v_title := 'Invitación canjeada';
      v_phrase := v_actor || ' se unió con tu invitación';
    when 'godchild_banned' then
      v_title := 'Ahijado baneado';
      v_phrase := 'Tu ahijado ' || v_actor || ' ha sido baneado';
    when 'sponsor_penalized' then
      v_title := 'Penalización de padrino';
      v_phrase := 'Te han penalizado porque ' || v_actor || ' fue baneado';
    when 'report_new' then
      v_title := 'Nuevo reporte';
      v_phrase := v_actor || ' reportó un mensaje en #' || coalesce(v_channel, '');
    when 'member_review' then
      v_title := 'Miembro por revisar';
      v_phrase := v_actor || ' necesita revisión';
    when 'treasury_mismatch' then
      v_title := 'Descuadre en la tesorería';
      v_phrase := 'El saldo de la Safe no coincide con el registro de la DAO';
    when 'treasury_outflow' then
      v_asset := case when n.data ->> 'asset' in ('USDC', 'WETH', 'ETH') then n.data ->> 'asset' else null end;
      if v_asset is null or coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Salida de la tesorería';
      -- WETH has 18 decimals like ETH: _format_token_amount knows only ETH (18) and USDC (6)
      v_phrase := public._format_token_amount((n.data ->> 'amount')::numeric, case when v_asset = 'USDC' then 'USDC' else 'ETH' end)
                  || ' ' || v_asset || ' salió de la Safe sin explicar';
    when 'withdrawal_approved' then
      if coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Retirada aprobada';
      v_phrase := 'Tu retirada de ' || public._format_token_amount((n.data ->> 'amount')::numeric, 'USDC')
                  || ' USDC está aprobada. El tesorero la pagará desde la Safe.';
    when 'withdrawal_rejected' then
      v_title := 'Retirada rechazada';
      v_phrase := 'El tesorero rechazó tu retirada';
      v_excerpt := nullif(btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'reason', ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 80)), '');
    when 'withdrawal_paid' then
      if coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Retirada pagada';
      v_phrase := 'Has recibido ' || public._format_token_amount((n.data ->> 'amount')::numeric, 'USDC') || ' USDC de la tesorería.';
    when 'withdrawal_expired' then
      v_title := 'Aprobación caducada';
      v_phrase := 'Tu retirada no se pagó en 14 días y vuelve a estar pendiente de aprobación.';
    when 'treasury_notice' then
      v_title := 'Aviso de tesorería';
      v_phrase := case n.data ->> 'event'
                    when 'withdrawal_requested' then 'Hay una nueva solicitud de retirada.'
                    when 'approval_expired' then 'Una retirada aprobada caducó sin pagarse.'
                    when 'raffle_drawn' then 'Un sorteo tiene ganador: hay un premio que pagar.'
                    when 'raffle_unpaid' then 'Un premio de sorteo lleva 14 días sin pagarse.'
                  end;
      if v_phrase is null then
        return;
      end if;
    when 'raffle_won' then
      if coalesce(n.data ->> 'raffleId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,78}$'
         or coalesce(n.data ->> 'token', '') not in ('USDC', 'WETH') then
        return;
      end if;
      v_url := '/dao/sorteos/' || (n.data ->> 'raffleId');
      v_raffle_title := btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'title', ''), '[[:cntrl:]]+', ' ', 'g')), 60));
      v_title := 'Has ganado un sorteo';
      -- WETH has 18 decimals like ETH: _format_token_amount knows only ETH (18) and USDC (6)
      v_phrase := 'Premio: '
                  || public._format_token_amount((n.data ->> 'amount')::numeric,
                                                  case when n.data ->> 'token' = 'USDC' then 'USDC' else 'ETH' end)
                  || ' ' || (n.data ->> 'token') || ' en «' || v_raffle_title
                  || '». El tesorero te lo enviará desde la Safe.';
    when 'ticket_new' then
      v_title := 'Nuevo ticket';
      v_phrase := v_actor || ' abrió un ticket: ' || coalesce(v_subject, '');
    when 'ticket_reply' then
      v_title := 'Respuesta en un ticket';
      v_phrase := v_actor || ' escribió en el ticket: ' || coalesce(v_subject, '');
    when 'ticket_status' then
      if n.data ->> 'status' = 'closed' then
        v_title := 'Ticket cerrado';
        v_phrase := v_actor || ' cerró el ticket: ' || coalesce(v_subject, '');
      else
        v_title := 'Ticket reabierto';
        v_phrase := v_actor || ' reabrió el ticket: ' || coalesce(v_subject, '');
      end if;
    else
      return;
  end case;

  title := v_title;
  body := case when v_excerpt is not null then v_phrase || ': «' || v_excerpt || '»' else v_phrase end;
  url := v_url;
  tag := n.kind || ':' || coalesce(n.message_id::text, n.ticket_id::text, n.id::text);
  return next;
end;
$$;

-- ===== grants =====
revoke execute on function
  public.enter_raffle(uuid),
  public.leave_raffle(uuid),
  public.close_due_raffles(int),
  public.raffles_awaiting_draw(int),
  public.draw_raffle(uuid, jsonb),
  public._raffle_card(public.raffles, uuid),
  public.dao_raffles(int),
  public.raffle_detail(uuid),
  public.treasury_raffles()
from public, anon, authenticated, service_role;

grant execute on function
  public.enter_raffle(uuid),
  public.leave_raffle(uuid),
  public.dao_raffles(int),
  public.raffle_detail(uuid),
  public.treasury_raffles()
to authenticated;

grant execute on function
  public.close_due_raffles(int),
  public.raffles_awaiting_draw(int),
  public.draw_raffle(uuid, jsonb)
to service_role;
