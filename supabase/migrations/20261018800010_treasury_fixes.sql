-- F3d Task 1 fix round 1.
--   F3d-R2 (I1): the intent snapshot is the authority. record_donation no longer compares the intent's Safe with the
--               currently configured one; a payment made to the Safe the member was shown is recorded and credited
--               (reconciliation flags it when the funds sit in a Safe that is no longer configured).
--   F3d-R3 (I2): any tx hash that would link a masked donor to their payment is null for everyone but the donor:
--               dao_history (hidden donors) and the anonymous tips in message_tips, member_tips and tips_by_ids.
--   M1: credit_donation refuses a half-empty state (exactly one of S and V is 0).
--   M2: dao_ledger.block_number is the finality gate: greatest(main block, fee block).
--   M5: null-safe anonymous check.

-- ===== record_donation =====
-- dao_ledger.block_number stores greatest(main transfer block, fee transfer block): the donation is final only once
-- every transfer of the payment is final. The tx_hash/log_index columns stay those of the main transfer.
create or replace function public.record_donation(p_intent uuid, p_main jsonb, p_fee jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.payment_intents;
  v_h record;
  v_id uuid;
  v_block bigint;
begin
  select * into i from public.payment_intents x where x.id = p_intent for update;
  if not found or i.purpose <> 'donation' or i.target_type <> 'dao' then
    raise exception 'not_found';
  end if;
  if i.status = 'confirmed' then
    select l.id into v_id from public.dao_ledger l where l.intent_id = i.id;
    return v_id;
  end if;

  -- rechecks (NULL-safe): a USDC donation to the snapshotted recipient (the intent snapshot is the authority)
  if i.token is distinct from 'USDC' or i.anonymous is distinct from false or i.recipient_member_id is not null
     or i.recipient_address is null then
    raise exception 'invalid_input';
  end if;

  select * into v_h from public._record_payment_transfers(i, p_main, p_fee);

  v_block := v_h.block;
  if i.fee_amount > 0 then
    if coalesce(p_fee ->> 'blockNumber', '') !~ '^[0-9]{1,18}$' then
      raise exception 'invalid_input';
    end if;
    v_block := greatest(v_block, (p_fee ->> 'blockNumber')::bigint);
  end if;

  insert into public.dao_ledger (chain_id, kind, member_id, amount_usdc, intent_id, tx_hash, log_index, block_number)
  values (i.chain_id, 'donation', i.member_id, i.amount, i.id, v_h.main_hash, (p_main ->> 'logIndex')::int, v_block)
  returning id into v_id;

  update public.payment_intents set status = 'confirmed' where id = i.id;
  return v_id;
end;
$$;

-- ===== credit_donation =====
-- Identical to 20261018800001 except a half-empty state (exactly one of S and V is 0) raises invalid_state instead of
-- being treated as an empty DAO. Unreachable in F3 (no withdrawals, V and S only ever grow together); F4 decides what a
-- fully drained or dust state means.
create or replace function public.credit_donation(p_ledger uuid)
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
  if (s.total_shares = 0) <> (s.value_usdc = 0) then
    raise exception 'invalid_state';
  end if;
  if s.total_shares = 0 then
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

-- ===== dao_history: no tx hash for masked donors =====
create or replace function public.dao_history(p_limit int default 50)
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
         l.amount_usdc,
         case when m.dao_ranking_visible or l.member_id = public.current_member_id() then l.tx_hash end,
         l.credited_at
  from public.dao_ledger l
  join cfg on l.chain_id = cfg.chain
  join public.members m on m.id = l.member_id
  where public.is_active_member() and l.status = 'credited'
  order by l.credited_at desc, l.id
  limit greatest(1, least(100, coalesce(p_limit, 50)))
$$;

-- ===== tip reads: no tx hash for anonymous tips unless the caller is the donor =====
create or replace function public.message_tips(p_message_id uuid)
returns table (tip_id uuid, donor_id uuid, is_me boolean, token text, amount numeric, chain_id int,
               main_tx_hash text, created_at timestamptz, amount_text text, anonymous boolean)
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
         t.created_at, t.amount::text, t.anonymous
  from public.tips t
  join public.messages m on m.id = t.message_id and m.deleted_at is null
  where public.is_active_member()
    and t.message_id = p_message_id
    and m.channel_id in (select v.id from public.visible_channels() v)
  order by t.created_at desc, t.id
$$;

create or replace function public.member_tips(p_member uuid, p_limit int default 20)
returns table (tip_id uuid, donor_id uuid, is_me boolean, token text, amount numeric, chain_id int,
               main_tx_hash text, created_at timestamptz, amount_text text, anonymous boolean)
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
         t.created_at, t.amount::text, t.anonymous
  from public.tips t
  left join public.messages m on m.id = t.message_id
  where public.is_active_member()
    and t.to_member = p_member
    and (t.target_type = 'profile'
         or (m.id is not null and m.deleted_at is null
             and m.channel_id in (select v.id from public.visible_channels() v)))
  order by t.created_at desc, t.id
  limit greatest(1, least(100, coalesce(p_limit, 20)))
$$;

create or replace function public.tips_by_ids(p_tip_ids uuid[])
returns table (tip_id uuid, chain_id int, main_tx_hash text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.chain_id,
         case when t.anonymous and t.from_member <> public.current_member_id() then null else t.main_tx_hash end
  from public.tips t
  join public.messages n on n.tip_id = t.id and n.kind = 'system' and n.deleted_at is null
  where public.is_active_member()
    and t.id = any (p_tip_ids)
    and n.channel_id in (select v.id from public.visible_channels() v)
$$;

-- ===== grants (create or replace keeps them; restated for clarity) =====
revoke execute on function
  public.record_donation(uuid, jsonb, jsonb),
  public.credit_donation(uuid),
  public.dao_history(int),
  public.message_tips(uuid),
  public.member_tips(uuid, int),
  public.tips_by_ids(uuid[])
from public, anon, authenticated, service_role;

grant execute on function
  public.record_donation(uuid, jsonb, jsonb),
  public.credit_donation(uuid)
to service_role;

grant execute on function
  public.dao_history(int),
  public.message_tips(uuid),
  public.member_tips(uuid, int),
  public.tips_by_ids(uuid[])
to authenticated;
