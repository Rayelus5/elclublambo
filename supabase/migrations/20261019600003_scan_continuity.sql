-- Ruling F4-R1 (whole-branch review I1): the Safe scan advances its cursor only when the logs it read are complete.
--
--   A lagging or load-balanced RPC can answer eth_getLogs with [] for blocks past its own head; the cursor used to move
--   anyway, and every valuation, payout detection and expiry trusts it. The scan (src/lib/treasury/scan.ts) now checks,
--   per scanned token, stored balance at the cursor + Σin − Σout (Transfer logs; WETH also Deposit / Withdrawal) ==
--   balanceOf(safe, toBlock), read from the same client after confirming that block exists. Only then it calls
--   record_safe_scan, which records the operations and advances the cursor (record_safe_operations, unchanged) and
--   stores the balances at that block in the same transaction. A mismatch records nothing and calls record_scan_gap.
--
--   dao_scan_state gains balances (jsonb {"USDC": "<units>", "WETH": "<wei>"}), balances_block (the block they were read
--   at: a concurrent run may have moved last_block further, and the scan only trusts balances read at its own cursor),
--   gap_runs (consecutive runs that did not advance) and gap_since. A Safe change deletes the row
--   (set_chain_addresses), so the balances start over with the next first scan.
--   Without stored balances at the cursor (first run after this migration, or after a concurrent run) the scan reads
--   balanceOf at start − 1; when that fails (a non-archive node), that one run falls back to the old behaviour and
--   stores the balances at toBlock, so the next run is checked.

alter table public.dao_scan_state
  add column balances jsonb,
  add column balances_block bigint check (balances_block is null or balances_block >= 0),
  add column gap_runs int not null default 0 check (gap_runs >= 0),
  add column gap_since timestamptz;

-- ===== record_safe_scan (service_role): record_safe_operations + the balances at p_to_block, gap cleared =====
create function public.record_safe_scan(p_chain int, p_safe text, p_ops jsonb, p_to_block bigint, p_balances jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_balances is not null
     and (jsonb_typeof(p_balances) <> 'object'
          or exists (select 1 from jsonb_each(p_balances) e
                     where e.key not in ('USDC', 'WETH') or jsonb_typeof(e.value) <> 'string'
                        or (e.value #>> '{}') !~ '^[0-9]{1,78}$')) then
    raise exception 'invalid_input';
  end if;
  -- validates the chain, the Safe and the ops, records them and moves last_block to greatest(last_block, p_to_block)
  v := public.record_safe_operations(p_chain, p_safe, p_ops, p_to_block);
  update public.dao_scan_state s
  set balances = case when p_balances is not null and p_to_block >= coalesce(s.balances_block, -1)
                      then coalesce(s.balances, '{}'::jsonb) || p_balances else s.balances end,
      balances_block = case when p_balances is not null and p_to_block >= coalesce(s.balances_block, -1)
                            then p_to_block else s.balances_block end,
      gap_runs = 0,
      gap_since = null
  where s.chain_id = p_chain;
  return v;
end;
$$;

-- ===== record_scan_gap (service_role): one more run that could not prove its logs complete =====
create function public.record_scan_gap(p_chain int)
returns int
language sql
security definer
set search_path = ''
as $$
  update public.dao_scan_state s
  set gap_runs = s.gap_runs + 1, gap_since = coalesce(s.gap_since, now())
  where s.chain_id = p_chain
  returning s.gap_runs
$$;

-- ===== dao_scan_balances (service_role): the balances the scan stored and the block they were read at =====
create function public.dao_scan_balances(p_chain int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.balances_block is null then null
              else jsonb_build_object('block', s.balances_block::text, 'balances', s.balances) end
  from public.dao_scan_state s
  where s.chain_id = p_chain
$$;

-- ===== treasury_scan_gap (treasurers): the active chain's consecutive gap runs, null while the scan advances =====
create function public.treasury_scan_gap()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_chain int;
  v jsonb;
begin
  if public.current_member_id() is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select jsonb_build_object('runs', s.gap_runs, 'since', s.gap_since) into v
  from public.dao_scan_state s
  where s.chain_id = v_chain and s.gap_runs > 0;
  return v;
end;
$$;

revoke execute on function
  public.record_safe_scan(int, text, jsonb, bigint, jsonb),
  public.record_scan_gap(int),
  public.dao_scan_balances(int),
  public.treasury_scan_gap()
from public, anon, authenticated, service_role;

grant execute on function
  public.record_safe_scan(int, text, jsonb, bigint, jsonb),
  public.record_scan_gap(int),
  public.dao_scan_balances(int)
to service_role;
grant execute on function public.treasury_scan_gap() to authenticated;
