-- F3d Task 3 fix round 1.
--   F3d-R4 (I1): reconciliation alerts are deduplicated per chain: a run notifies only when its effective diff is nonzero
--                AND differs from the previous run's effective diff (no previous run, or a previous zero, counts as
--                differing). Every run is still recorded. Serialised per chain with an advisory lock.
--   F3d-R5 (I2): pending_finality donations are already in the Safe but not yet in dao_state, so they are not a mismatch.
--                effective_diff = onchain - (dao_state.value_usdc + sum(pending_finality amounts)); alerts use it.
--                The ledger and pending values are now read inside the RPC (one snapshot), only the on-chain balance
--                comes from the caller.
--   M4: dao_ledger.missing_since + donation_missing(): a not-found transfer reverts only after it has been missing for
--       30 minutes (one lagging RPC node must not cause an irreversible revert).

-- ===== dao_reconciliations: pending value and effective diff =====
alter table public.dao_reconciliations
  add column pending_value numeric(78, 0) not null default 0 check (pending_value >= 0),
  add column effective_diff numeric(78, 0);
update public.dao_reconciliations set effective_diff = diff;
alter table public.dao_reconciliations alter column effective_diff set not null;
alter table public.dao_reconciliations
  add constraint dao_reconciliations_effective_coherent check (effective_diff = diff - pending_value);

-- ===== record_reconciliation (service_role) =====
drop function public.record_reconciliation(int, numeric, numeric, uuid);
create function public.record_reconciliation(p_chain int, p_onchain numeric, p_actor uuid)
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

  select s.value_usdc into v_ledger from public.dao_state s where s.chain_id = p_chain;
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

revoke execute on function public.record_reconciliation(int, numeric, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_reconciliation(int, numeric, uuid) to service_role;

-- ===== M4: donation_missing (service_role) =====
alter table public.dao_ledger add column missing_since timestamptz;

-- p_missing = true: the transfer was not found on-chain. Marks the first sighting and returns true only once it has been
-- missing for 30 minutes (the caller may then revert). p_missing = false: the transfer is back, clears the mark.
create function public.donation_missing(p_ledger uuid, p_missing boolean)
returns boolean
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
  if l.status <> 'pending_finality' then
    raise exception 'invalid_state';
  end if;
  if p_missing is null then
    raise exception 'invalid_input';
  end if;
  if not p_missing then
    update public.dao_ledger set missing_since = null where id = l.id and missing_since is not null;
    return false;
  end if;
  if l.missing_since is null then
    update public.dao_ledger set missing_since = now() where id = l.id;
    return false;
  end if;
  return l.missing_since < now() - interval '30 minutes';
end;
$$;

revoke execute on function public.donation_missing(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.donation_missing(uuid, boolean) to service_role;
