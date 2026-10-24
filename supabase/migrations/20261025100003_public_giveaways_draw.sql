-- P2 Task 5: close, drand draw, payouts and deliveries of public giveaways (tables in 20261025100002).
--
-- The draw is P1's exactly (20261024200006, P1-R10; src/lib/giveaways/draw.ts mirrors it, tests/fixtures/giveaway-draw.json
-- pins it), but P1's draw_giveaway is not touched (P2-R17): private.giveaway_pick is the same algorithm as a pure helper,
-- and supabase/tests/p2_03 checks it gives the fixture's winners.
--
--   private.giveaway_pick (nobody)          winners as 1-based positions from (seed, randomness, n, k).
--   close_due_public_giveaways (service)    positions 1..n by (entered_at, user_id) over every entry; 0 -> void.
--   public_giveaways_awaiting_draw (service)
--   draw_public_giveaway (service)          after TS fetched round target_round and verified its BLS signature;
--                                           randomness = sha256(signature) computed here. 'drawn' | 'already'.
--   record_public_giveaway_payout (service) after TS verified the USDC Transfer from the host to winner_address.
--                                           ElClub. holds no funds: the host pays, the app only checks.
--   mark_public_prize_delivered (host)      a custom prize handed over.
-- No audit_log or notifications rows: both are club tables keyed by members (D15); the public record is the giveaway
-- row itself (seed reveal, round, signature, randomness, winners, payout hashes).
-- Lock order (as 20261025100002): giveaway row -> entries / prizes.

-- ===== private.giveaway_pick: the P1 draw as a pure function =====
--   L = [1 .. p_n]; r_1 = keccak256(seed || randomness)
--   for each of p_k prizes: stop when L is empty; i = uint256_be(r) mod len(L); take L[i] (0-based), remove it;
--   r = keccak256(r) after every prize.
-- Returns fewer than p_k positions when p_n < p_k (the rest are not_enough_entries).
create function private.giveaway_pick(p_seed bytea, p_randomness bytea, p_n int, p_k int)
returns int[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_list int[];
  v_out int[] := '{}';
  v_r bytea;
  v_len int;
  v_i int;
begin
  if p_seed is null or octet_length(p_seed) <> 32 or p_randomness is null or octet_length(p_randomness) <> 32
     or p_n is null or p_n < 0 or p_k is null or p_k < 0 then
    raise exception 'invalid_input';
  end if;
  v_list := array(select generate_series(1, p_n));
  v_r := public._keccak256(p_seed || p_randomness);
  for k in 1 .. p_k loop
    v_len := coalesce(cardinality(v_list), 0);
    exit when v_len = 0;
    v_i := mod(public._uint256_be(v_r), v_len)::int;
    v_out := v_out || v_list[v_i + 1];
    v_list := v_list[1:v_i] || v_list[v_i + 2:v_len];
    v_r := public._keccak256(v_r);
  end loop;
  return v_out;
end;
$$;

-- ===== close_due_public_giveaways (service role, cron) =====
-- Each due giveaway, in id order and FOR UPDATE (an entry in flight holds FOR NO KEY UPDATE: it commits first, or waits
-- and then sees giveaway_closed): positions 1..n by (entered_at, user_id) over every entry, entry_count = n.
-- n = 0 -> void: the seed is revealed (copied, then deleted) and every prize is unawarded ('not_enough_entries').
create function public.close_due_public_giveaways()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.public_giveaways;
  v_count int;
  v_seed text;
  v_closed int := 0;
  v_voided int := 0;
begin
  for g in
    select * from public.public_giveaways x
    where x.status = 'open' and x.closes_at <= now()
    order by x.id
    for update
  loop
    update public.public_giveaway_entries e set position = null where e.giveaway_id = g.id;
    update public.public_giveaway_entries e
    set position = o.pos
    from (select e2.user_id, row_number() over (order by e2.entered_at, e2.user_id)::int as pos
          from public.public_giveaway_entries e2
          where e2.giveaway_id = g.id) o
    where e.giveaway_id = g.id and e.user_id = o.user_id;
    select count(*)::int into v_count
    from public.public_giveaway_entries e where e.giveaway_id = g.id and e.position is not null;

    if v_count > 0 then
      update public.public_giveaways set status = 'closed', entry_count = v_count where id = g.id;
      v_closed := v_closed + 1;
    else
      select '0x' || encode(s.seed, 'hex') into v_seed from private.public_giveaway_seeds s where s.giveaway_id = g.id;
      if v_seed is null then
        raise exception 'invalid_state';
      end if;
      update public.public_giveaways set status = 'void', entry_count = 0, seed_reveal = v_seed where id = g.id;
      delete from private.public_giveaway_seeds s where s.giveaway_id = g.id;
      update public.public_giveaway_prizes p
      set status = 'unawarded', unawarded_reason = 'not_enough_entries'
      where p.giveaway_id = g.id;
      v_voided := v_voided + 1;
    end if;
  end loop;

  return jsonb_build_object('closed', v_closed, 'voided', v_voided);
end;
$$;

-- ===== public_giveaways_awaiting_draw (service role): closed giveaways, earliest round first =====
create function public.public_giveaways_awaiting_draw()
returns table (id uuid, target_round bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.target_round from public.public_giveaways g
  where g.status = 'closed'
  order by g.target_round, g.id
$$;

-- ===== draw_public_giveaway (service role, after TS fetched the round and verified its BLS signature) =====
-- p_signature: 48 bytes as 96 hex (no 0x). Same round checks as P1's draw_giveaway. Idempotent: a drawn giveaway called
-- again with the same round and signature -> 'already'. Every winner is 'awarded' (crypto: the host pays it; custom:
-- the host hands it over); prizes beyond the entries are 'unawarded' ('not_enough_entries').
create function public.draw_public_giveaway(p_id uuid, p_round bigint, p_signature text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sig text := lower(coalesce(p_signature, ''));
  g public.public_giveaways;
  p public.public_giveaway_prizes;
  v_seed bytea;
  v_randomness bytea;
  v_users uuid[];
  v_wallets text[];
  v_positions int[];
  v_n int;
  v_k int;
  v_winners int[];
  v_pos int;
  v_rank int := 0;
begin
  if p_id is null or p_round is null or p_round < 1 or v_sig !~ '^[0-9a-f]{96}$' then
    raise exception 'invalid_input';
  end if;
  select * into g from public.public_giveaways x where x.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status = 'drawn' then
    if g.target_round = p_round and g.drand_signature = v_sig then
      return 'already';
    end if;
    raise exception 'invalid_state';
  end if;
  if p_round <> g.target_round then
    raise exception 'invalid_input';
  end if;
  if g.status <> 'closed' then
    raise exception 'invalid_state';
  end if;
  -- the round must already exist: genesis + (round - 1) * 3 s
  if now() < to_timestamp(1692803367 + (p_round - 1) * 3) then
    raise exception 'round_not_ready';
  end if;

  select s.seed into v_seed from private.public_giveaway_seeds s where s.giveaway_id = g.id;
  if v_seed is null then
    raise exception 'invalid_state';
  end if;
  select array_agg(e.user_id order by e.position), array_agg(e.wallet_address order by e.position),
         array_agg(e.position order by e.position)
    into v_users, v_wallets, v_positions
  from public.public_giveaway_entries e
  where e.giveaway_id = g.id and e.position is not null;
  v_n := coalesce(cardinality(v_users), 0);
  -- an account deleted after the close would shorten the list and break parity with the public verifier
  if v_n = 0 or v_n <> g.entry_count or v_positions <> array(select generate_series(1, v_n)) then
    raise exception 'invalid_state';
  end if;

  v_randomness := extensions.digest(decode(v_sig, 'hex'), 'sha256');
  select count(*)::int into v_k from public.public_giveaway_prizes x where x.giveaway_id = g.id;
  v_winners := private.giveaway_pick(v_seed, v_randomness, v_n, v_k);

  for p in
    select * from public.public_giveaway_prizes x where x.giveaway_id = g.id order by x.rank for update
  loop
    v_rank := v_rank + 1;
    if v_rank > cardinality(v_winners) then
      update public.public_giveaway_prizes set status = 'unawarded', unawarded_reason = 'not_enough_entries'
      where id = p.id;
    else
      v_pos := v_winners[v_rank];
      update public.public_giveaway_prizes
      set status = 'awarded', winner_user_id = v_users[v_pos], winner_address = v_wallets[v_pos], winner_position = v_pos
      where id = p.id;
    end if;
  end loop;

  update public.public_giveaways
  set status = 'drawn',
      seed_reveal = '0x' || encode(v_seed, 'hex'),
      drand_signature = v_sig,
      drand_randomness = encode(v_randomness, 'hex'),
      drawn_at = now()
  where id = g.id;
  delete from private.public_giveaway_seeds s where s.giveaway_id = g.id;

  return 'drawn';
end;
$$;

-- ===== record_public_giveaway_payout (service role, after TS verified the USDC Transfer host -> winner) =====
-- p_payout {txHash, logIndex, blockNumber}; p_actor: the session's auth user, who must be the host. The
-- (chain, hash, log) may not back an intent (onchain_transfers), a club prize nor another public prize
-- (tx_already_used). The same payout again on a paid prize -> 'already'.
create function public.record_public_giveaway_payout(p_prize uuid, p_payout jsonb, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_giveaway uuid;
  g public.public_giveaways;
  p public.public_giveaway_prizes;
  v_hash text;
  v_log int;
begin
  if p_actor is null then
    raise exception 'forbidden';
  end if;
  if p_prize is null or p_payout is null or jsonb_typeof(p_payout) <> 'object'
     or coalesce(p_payout ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(p_payout ->> 'logIndex', '') !~ '^[0-9]{1,9}$'
     or coalesce(p_payout ->> 'blockNumber', '') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid_input';
  end if;
  v_hash := lower(p_payout ->> 'txHash');
  v_log := (p_payout ->> 'logIndex')::int;

  select x.giveaway_id into v_giveaway from public.public_giveaway_prizes x where x.id = p_prize;
  if not found then
    raise exception 'not_found';
  end if;
  select * into g from public.public_giveaways x where x.id = v_giveaway for share;
  if g.host_user_id <> p_actor then
    raise exception 'forbidden';
  end if;
  select * into p from public.public_giveaway_prizes x where x.id = p_prize for update;
  if not found then
    raise exception 'not_found';
  end if;

  if p.status = 'paid' and p.payout_tx_hash = v_hash and p.payout_log_index = v_log then
    return 'already';
  end if;
  if p.kind <> 'crypto' or p.status <> 'awarded' then
    raise exception 'invalid_state';
  end if;
  if exists (select 1 from public.onchain_transfers t
             where t.chain_id = p.chain_id and t.tx_hash = v_hash and t.log_index = v_log)
     or exists (select 1 from public.giveaway_prizes o
                where o.chain_id = p.chain_id and o.payout_tx_hash = v_hash and o.payout_log_index = v_log)
     or exists (select 1 from public.public_giveaway_prizes o
                where o.id <> p.id and o.chain_id = p.chain_id and o.payout_tx_hash = v_hash and o.payout_log_index = v_log) then
    raise exception 'tx_already_used';
  end if;

  begin
    update public.public_giveaway_prizes
    set status = 'paid', payout_tx_hash = v_hash, payout_log_index = v_log, paid_at = now()
    where id = p.id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;
  return 'paid';
end;
$$;

-- ===== mark_public_prize_delivered (authenticated, the host): a custom prize handed over =====
create function public.mark_public_prize_delivered(p_prize uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_giveaway uuid;
  g public.public_giveaways;
  p public.public_giveaway_prizes;
begin
  if v_me is null then
    raise exception 'forbidden';
  end if;
  select x.giveaway_id into v_giveaway from public.public_giveaway_prizes x where x.id = p_prize;
  if not found then
    raise exception 'not_found';
  end if;
  select * into g from public.public_giveaways x where x.id = v_giveaway for share;
  if g.host_user_id <> v_me then
    raise exception 'forbidden';
  end if;
  select * into p from public.public_giveaway_prizes x where x.id = p_prize for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p.kind <> 'custom' or p.status <> 'awarded' then
    raise exception 'invalid_state';
  end if;
  update public.public_giveaway_prizes set status = 'delivered', delivered_at = now() where id = p.id;
end;
$$;

-- ===== grants =====
revoke execute on function private.giveaway_pick(bytea, bytea, int, int) from public, anon, authenticated, service_role;

revoke execute on function
  public.close_due_public_giveaways(),
  public.public_giveaways_awaiting_draw(),
  public.draw_public_giveaway(uuid, bigint, text),
  public.record_public_giveaway_payout(uuid, jsonb, uuid),
  public.mark_public_prize_delivered(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.close_due_public_giveaways(),
  public.public_giveaways_awaiting_draw(),
  public.draw_public_giveaway(uuid, bigint, text),
  public.record_public_giveaway_payout(uuid, jsonb, uuid)
to service_role;

grant execute on function public.mark_public_prize_delivered(uuid) to authenticated;
