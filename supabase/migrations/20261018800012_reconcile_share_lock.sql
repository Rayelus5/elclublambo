-- F3d Task 3 fix round 2 (N2): record_reconciliation reads dao_state with FOR SHARE so a concurrent credit_donation
-- (which updates dao_state under FOR UPDATE) cannot move value from pending to credited between the ledger read and the
-- pending sum. Identical to 20261018800011 otherwise.
create or replace function public.record_reconciliation(p_chain int, p_onchain numeric, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ledger numeric;
  v_pending numeric;
  v_raw numeric;
  v_eff numeric;
  v_prev numeric;
  v_has_prev boolean;
begin
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_onchain is null or p_onchain < 0 or p_onchain <> trunc(p_onchain) then
    raise exception 'invalid_input';
  end if;
  if p_actor is not null and not exists (select 1 from public.members m where m.id = p_actor) then
    raise exception 'not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('dao_reconcile'), p_chain);

  select s.value_usdc into v_ledger from public.dao_state s where s.chain_id = p_chain for share;
  if not found then
    raise exception 'chain_invalid';
  end if;
  select coalesce(sum(l.amount_usdc), 0) into v_pending
  from public.dao_ledger l where l.chain_id = p_chain and l.status = 'pending_finality';

  v_raw := p_onchain - v_ledger;
  v_eff := v_raw - v_pending;

  select r.effective_diff into v_prev
  from public.dao_reconciliations r where r.chain_id = p_chain
  order by r.ran_at desc, r.id desc limit 1;
  v_has_prev := found;

  insert into public.dao_reconciliations (chain_id, ledger_value, pending_value, onchain_balance, diff, effective_diff, ran_at, ran_by)
  values (p_chain, v_ledger, v_pending, p_onchain, v_raw, v_eff, clock_timestamp(), p_actor)
  returning id into v_id;

  if v_eff <> 0 and (not v_has_prev or v_prev <> v_eff) then
    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_mismatch',
           jsonb_build_object('chainId', p_chain, 'diff', v_eff::text, 'reconciliationId', v_id)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
  end if;

  return jsonb_build_object(
    'id', v_id, 'ledgerValue', v_ledger::text, 'pendingValue', v_pending::text,
    'rawDiff', v_raw::text, 'diff', v_eff::text);
end;
$$;

revoke execute on function public.record_reconciliation(int, numeric, uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_reconciliation(int, numeric, uuid) to service_role;
