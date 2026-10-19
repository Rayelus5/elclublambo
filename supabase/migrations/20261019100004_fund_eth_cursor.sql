-- F4a Task 4 fix (ruling F4a-R6): the operations scan turns the native-ETH change between consecutive NAV snapshots
-- into hashless ETH operations. It must diff EVERY consecutive pair, not just the newest one, so a failed scan run
-- never drops a pair. dao_scan_state.eth_block is the block of the last snapshot already diffed (the later snapshot of
-- the last processed pair). It is set after record_safe_operations stored that pair's op; if setting it fails, the
-- next run recomputes the same pairs and the (chain, block, asset) unique index keeps them from being stored twice.

alter table public.dao_scan_state add column eth_block bigint check (eth_block is null or eth_block >= 0);

-- ===== dao_eth_scan_from (service_role) =====
create function public.dao_eth_scan_from(p_chain int)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.eth_block from public.dao_scan_state s where s.chain_id = p_chain
$$;

-- ===== set_dao_eth_cursor (service_role): only forward; the chain must have been scanned once =====
create function public.set_dao_eth_cursor(p_chain int, p_block bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_chain is null or p_chain not in (59144, 59141) or p_block is null or p_block < 0 then
    raise exception 'invalid_input';
  end if;
  update public.dao_scan_state
     set eth_block = greatest(eth_block, p_block)
   where chain_id = p_chain;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke execute on function public.dao_eth_scan_from(int), public.set_dao_eth_cursor(int, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.dao_eth_scan_from(int), public.set_dao_eth_cursor(int, bigint) to service_role;
