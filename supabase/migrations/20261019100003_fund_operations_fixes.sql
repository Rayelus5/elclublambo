-- F4a Task 2, fix round 1 (ruling F4a-R5).
--  (a) the member feed lists only outflows and inflows a treasurer has noted; unnoted inflows are never shown
--  (b) inflows never expose their tx_hash (an explorer turns it into the sender); outflows keep it
--  (c) record_donation links a Transfer that the scan stored before the ledger row existed
-- Plus review minors: precise donation match (tx + log index), up-front input validation, notes only on public rows
-- and the previous note kept in the audit payload.

-- ===== record_donation: latest definition (20261018800010) + re-link of an already scanned inflow =====
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

  -- F4a-R5(c): the operations scan may have stored this very Transfer before the ledger row existed
  update public.dao_safe_operations o
     set ledger_id = v_id
   where o.chain_id = i.chain_id and o.tx_hash = v_h.main_hash and o.log_index = (p_main ->> 'logIndex')::int
     and o.asset = 'USDC' and o.direction = 'in' and o.ledger_id is null;

  update public.payment_intents set status = 'confirmed' where id = i.id;
  return v_id;
end;
$$;

-- ===== record_safe_operations: validation up front, match on tx + log index =====
create or replace function public.record_safe_operations(p_chain int, p_ops jsonb, p_to_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op jsonb;
  v_hash text;
  v_log int;
  v_asset text;
  v_dir text;
  v_amount numeric;
  v_block bigint;
  v_at timestamptz;
  v_cp text;
  v_id uuid;
  v_ledger uuid;
  v_n int;
  v_inserted int := 0;
  v_alerts int := 0;
begin
  if p_chain not in (59144, 59141) or p_to_block is null or p_to_block < 0
     or p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'invalid_input';
  end if;

  for v_op in select e from jsonb_array_elements(p_ops) e loop
    begin
      v_hash := lower(nullif(v_op ->> 'txHash', ''));
      v_log := (v_op ->> 'logIndex')::int;
      v_asset := v_op ->> 'asset';
      v_dir := v_op ->> 'direction';
      v_amount := (v_op ->> 'amount')::numeric;
      v_block := (v_op ->> 'blockNumber')::bigint;
      v_at := (v_op ->> 'occurredAt')::timestamptz;
    exception when others then
      raise exception 'invalid_input';
    end;
    v_cp := lower(nullif(v_op ->> 'counterparty', ''));
    if v_asset is null or v_asset not in ('USDC', 'WETH', 'ETH') or v_dir is null or v_dir not in ('in', 'out')
       or v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) or v_block is null or v_block < 0
       or v_at is null or (v_hash is null) <> (v_log is null) or v_log < 0
       or (v_hash is not null and v_hash !~ '^0x[0-9a-f]{64}$')
       or (v_cp is not null and v_cp !~ '^0x[0-9a-f]{40}$') then
      raise exception 'invalid_input';
    end if;

    v_ledger := null;
    if v_asset = 'USDC' and v_dir = 'in' and v_hash is not null then
      select l.id into v_ledger from public.dao_ledger l
      where l.chain_id = p_chain and l.tx_hash = v_hash and l.log_index = v_log limit 1;
    end if;

    v_id := null;
    insert into public.dao_safe_operations
      (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number, occurred_at, ledger_id)
    values (p_chain, v_hash, v_log, v_asset, v_dir, v_amount, v_cp, v_block, v_at, v_ledger)
    on conflict do nothing
    returning id into v_id;

    if v_id is not null then
      v_inserted := v_inserted + 1;
      if v_dir = 'out' then
        insert into public.notifications (recipient_id, kind, data)
        select m.id, 'treasury_outflow',
               jsonb_build_object('opId', v_id, 'asset', v_asset, 'amount', v_amount::text)
        from public.members m
        where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
        get diagnostics v_n = row_count;
        v_alerts := v_alerts + v_n;
        update public.dao_safe_operations set alerted_at = clock_timestamp() where id = v_id;
      end if;
    end if;
  end loop;

  insert into public.dao_scan_state (chain_id, last_block) values (p_chain, p_to_block)
  on conflict (chain_id) do update set last_block = greatest(public.dao_scan_state.last_block, excluded.last_block);

  return jsonb_build_object('inserted', v_inserted, 'alerts', v_alerts);
end;
$$;

-- ===== set_operation_note: only public rows of the active chain; audit keeps the previous note =====
create or replace function public.set_operation_note(p_op uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_note text := btrim(coalesce(p_note, ''));
  v_old text;
begin
  if v_me is null or not public.is_active_member() or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_note) < 1 or char_length(v_note) > 280 then
    raise exception 'invalid_input';
  end if;
  select o.note into v_old from public.dao_safe_operations o
  where o.id = p_op and o.ledger_id is null
    and o.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
  for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  update public.dao_safe_operations set note = v_note, noted_by = v_me, noted_at = now() where id = p_op;
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'operation_noted', 'dao_safe_operation', p_op, jsonb_build_object('previous', v_old, 'note', v_note));
end;
$$;

-- ===== dao_operations: outflows + noted inflows; no hash on inflows; never the counterparty =====
-- Amendment to F4a-R5: MANAGE_TREASURY holders also see un-noted inflows and their hash (to annotate swap proceeds);
-- donation-linked inflows stay hidden for everyone.
create or replace function public.dao_operations(p_limit int default 30)
returns table (id uuid, asset text, direction text, amount text, tx_hash text, occurred_at timestamptz, note text, explained boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_treasurer boolean;
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  v_treasurer := public.has_global_perm(256);
  return query
  select o.id, o.asset, o.direction, o.amount::text,
         case when o.direction = 'out' or v_treasurer then o.tx_hash end,
         o.occurred_at, o.note,
         (o.direction = 'in' or o.note is not null)
  from public.dao_safe_operations o
  where o.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
    and o.ledger_id is null
    and (o.direction = 'out' or o.note is not null or v_treasurer)
  order by o.occurred_at desc, o.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;
