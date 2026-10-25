-- P2 final review (fix wave): two `create or replace` (same signatures, so grants and owners stay as they were).
--   - record_giveaway_payout (P1): the (chain, hash, log) of a paid public giveaway prize is tx_already_used too, so a
--     payout cannot back a club prize and a public prize (record_public_giveaway_payout already checked the other way).
--     draw_giveaway is not touched (P2-R17).
--   - create_public_giveaway: the raw allowlist is rejected above 4000 entries before it is trimmed, lower-cased and
--     deduped (invalid_input), so a huge array cannot make the normalising pass expensive.

-- ===== record_giveaway_payout (service role, after TS verified the USDC Transfer from the Safe) =====
-- p_payout {txHash, logIndex, blockNumber}. The (chain, hash, log) may not back a tip / bounty / donation intent
-- (onchain_transfers), another club prize nor a public giveaway prize (tx_already_used). The same payout again on a
-- paid prize -> 'already'.
create or replace function public.record_giveaway_payout(p_prize uuid, p_payout jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.giveaway_prizes;
  v_hash text;
  v_log int;
  v_block bigint;
begin
  if p_actor is null
     or not exists (select 1 from public.members m where m.id = p_actor and m.status = 'active')
     or (public.member_global_permissions(p_actor) & 256) = 0 then
    raise exception 'forbidden';
  end if;
  if p_payout is null or jsonb_typeof(p_payout) <> 'object'
     or coalesce(p_payout ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(p_payout ->> 'logIndex', '') !~ '^[0-9]{1,9}$'
     or coalesce(p_payout ->> 'blockNumber', '') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid_input';
  end if;
  v_hash := lower(p_payout ->> 'txHash');
  v_log := (p_payout ->> 'logIndex')::int;
  v_block := (p_payout ->> 'blockNumber')::bigint;

  select * into p from public.giveaway_prizes x where x.id = p_prize for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p.status = 'paid' and p.payout_tx_hash = v_hash and p.payout_log_index = v_log then
    return jsonb_build_object('status', 'already');
  end if;
  if p.kind <> 'crypto' or p.status <> 'awarded' then
    raise exception 'invalid_state';
  end if;
  if exists (select 1 from public.onchain_transfers t
             where t.chain_id = p.chain_id and t.tx_hash = v_hash and t.log_index = v_log)
     or exists (select 1 from public.giveaway_prizes o
                where o.chain_id = p.chain_id and o.payout_tx_hash = v_hash and o.payout_log_index = v_log)
     or exists (select 1 from public.public_giveaway_prizes o
                where o.chain_id = p.chain_id and o.payout_tx_hash = v_hash and o.payout_log_index = v_log) then
    raise exception 'tx_already_used';
  end if;

  begin
    update public.giveaway_prizes
    set status = 'paid', payout_tx_hash = v_hash, payout_log_index = v_log, paid_at = now()
    where id = p.id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'giveaway_prize_paid', 'giveaway', p.giveaway_id, jsonb_build_object(
    'giveaway', p.giveaway_id, 'prize', p.id, 'rank', p.rank, 'chainId', p.chain_id, 'amount', p.amount::text,
    'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block));

  return jsonb_build_object('status', 'paid');
end;
$$;

-- ===== create_public_giveaway (public account) =====
-- As in 20261025100002, plus the raw allowlist bound (> 4000 entries -> invalid_input) before normalising.
create or replace function public.create_public_giveaway(
  p_title text, p_description text, p_closes_at timestamptz, p_host_name text, p_min_tx_count int,
  p_allowlist text[], p_prizes jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_address text := public.auth_wallet_address();
  v_title text := btrim(coalesce(p_title, ''), E' \t\n\r\f\v');
  v_description text := nullif(btrim(coalesce(p_description, ''), E' \t\n\r\f\v'), '');
  v_host_name text := nullif(btrim(coalesce(p_host_name, ''), E' \t\n\r\f\v'), '');
  v_min_tx int := coalesce(p_min_tx_count, 0);
  v_allow text[];
  v_count int;
  v_prize jsonb;
  v_rank int;
  v_kind text;
  v_label text;
  v_chain int;
  v_amount numeric;
  v_seed bytea;
  v_commit text;
  v_id uuid;
begin
  if v_me is null or v_address is null or not public.is_public_account() then
    raise exception 'forbidden';
  end if;
  perform private.rate_limit('u:' || v_me::text, 'public_giveaway_create', 5, interval '1 day');

  if char_length(v_title) not between 1 and 80
     or (v_description is not null and char_length(v_description) > 500)
     or (v_host_name is not null and char_length(v_host_name) > 60)
     or v_min_tx not between 0 and 1000 then
    raise exception 'invalid_input';
  end if;
  if p_closes_at is null or not isfinite(p_closes_at)
     or p_closes_at < now() + interval '10 minutes' or p_closes_at > now() + interval '90 days' then
    raise exception 'invalid_input';
  end if;
  if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' then
    raise exception 'invalid_input';
  end if;
  v_count := jsonb_array_length(p_prizes);
  if v_count not between 1 and 10 then
    raise exception 'invalid_input';
  end if;

  -- The raw list is bounded before any normalising work (2000 distinct addresses, room for duplicates).
  if cardinality(coalesce(p_allowlist, '{}'::text[])) > 4000 then
    raise exception 'invalid_input';
  end if;
  if exists (select 1 from unnest(coalesce(p_allowlist, '{}'::text[])) a(x)
             where a.x is null or lower(btrim(a.x)) !~ '^0x[0-9a-f]{40}$') then
    raise exception 'invalid_input';
  end if;
  select coalesce(array_agg(distinct lower(btrim(a.x))), '{}'::text[]) into v_allow
  from unnest(coalesce(p_allowlist, '{}'::text[])) a(x);
  if cardinality(v_allow) > 2000 then
    raise exception 'invalid_input';
  end if;

  if (select count(*) from public.public_giveaways g where g.host_user_id = v_me and g.status = 'open') >= 10 then
    raise exception 'too_many_open';
  end if;

  v_seed := extensions.gen_random_bytes(32);
  v_commit := '0x' || encode(public._keccak256(v_seed), 'hex');

  insert into public.public_giveaways (host_user_id, host_address, host_name, title, description, closes_at,
                                       min_tx_count, has_allowlist, seed_commit, target_round)
  values (v_me, v_address, v_host_name, v_title, v_description, p_closes_at,
          v_min_tx, cardinality(v_allow) > 0, v_commit, public._giveaway_target_round(p_closes_at))
  returning id into v_id;
  insert into private.public_giveaway_seeds (giveaway_id, seed) values (v_id, v_seed);
  insert into public.public_giveaway_allowlist (giveaway_id, address) select v_id, a.x from unnest(v_allow) a(x);

  for v_prize, v_rank in
    select e.value, e.ordinality::int from jsonb_array_elements(p_prizes) with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_prize) is distinct from 'object' or jsonb_typeof(v_prize -> 'kind') is distinct from 'string' then
      raise exception 'invalid_input';
    end if;
    v_kind := v_prize ->> 'kind';
    if v_prize ? 'label' and jsonb_typeof(v_prize -> 'label') not in ('string', 'null') then
      raise exception 'invalid_input';
    end if;
    v_label := nullif(btrim(coalesce(v_prize ->> 'label', ''), E' \t\n\r\f\v'), '');
    if v_label is not null and char_length(v_label) > 120 then
      raise exception 'invalid_input';
    end if;

    if v_kind = 'crypto' then
      if jsonb_typeof(v_prize -> 'chainId') is distinct from 'number'
         or (v_prize ->> 'chainId') !~ '^[0-9]{1,9}$'
         or jsonb_typeof(v_prize -> 'amount') not in ('string', 'number')
         or coalesce(v_prize ->> 'amount', '') !~ '^[0-9]{1,78}$'
         or (v_prize ? 'token' and (v_prize ->> 'token') is distinct from 'USDC') then
        raise exception 'invalid_input';
      end if;
      v_chain := (v_prize ->> 'chainId')::int;
      v_amount := (v_prize ->> 'amount')::numeric;
      if v_amount <= 0 then
        raise exception 'invalid_input';
      end if;
      if not private.chain_enabled(v_chain) then
        raise exception 'chain_invalid';
      end if;
      v_label := coalesce(v_label, public._format_token_amount(v_amount, 'USDC') || ' USDC');
      insert into public.public_giveaway_prizes (giveaway_id, rank, kind, chain_id, token, amount, label)
      values (v_id, v_rank, 'crypto', v_chain, 'USDC', v_amount, v_label);
    elsif v_kind = 'custom' then
      if v_prize ? 'chainId' or v_prize ? 'amount' or v_prize ? 'token' or v_label is null then
        raise exception 'invalid_input';
      end if;
      insert into public.public_giveaway_prizes (giveaway_id, rank, kind, label)
      values (v_id, v_rank, 'custom', v_label);
    else
      raise exception 'invalid_input';
    end if;
  end loop;

  return v_id;
end;
$$;
