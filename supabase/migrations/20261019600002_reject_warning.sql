-- F4 polish item 8 (P1, F4c final-review concern 3): the reject dialog of an APPROVED withdrawal warns when the Safe
-- sent USDC to that withdrawal's destination after the approval and the outflow is still unexplained: it may be a
-- payout the forum could not link (split or short), and rejecting would leave the member with both the shares and
-- the USDC.
--
--   treasury_withdrawals (latest 20261019300007) gains unexplained_outflow: true for an approved request without a
--   recorded payout when an outflow of the active chain is USDC, to the snapshotted destination, at or after
--   approved_at - 120 s (the payout window's tolerance), and unexplained by the rule of treasury_unexplained_outflows
--   (latest 20261019400004). New column: drop and create, grants restated. Everything else is unchanged.

drop function public.treasury_withdrawals();
create or replace function public.treasury_withdrawals()
returns table (id uuid, member_id uuid, member_label text, wallet text, shares text, position_shares text, status text,
               created_at timestamptz, approved_at timestamptz, expires_at timestamptz, approved_by_label text,
               self_approved boolean, amount_usdc text, estimate_usd6 text, last_expired_at timestamptz,
               reject_reason text, payout_tx_hash text, payout_amount text, payout_recorded_at timestamptz,
               paid_at timestamptz, payout_linked boolean, rejected_at timestamptz, cancelled_at timestamptz,
               unexplained_outflow boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_chain int;
  v_value numeric := 0;
  v_supply numeric := 0;
begin
  if public.current_member_id() is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select s.value_usdc, s.total_shares - s.approved_locked_shares into v_value, v_supply
  from public.dao_state s where s.chain_id = v_chain;

  return query
  select w.id, w.member_id,
         public._member_label(w.member_id), -- the real label, even for a donor hidden from the ranking
         case when w.status in ('approved', 'paid') then coalesce(w.destination_address, m.wallet_address)
              else m.wallet_address end,
         w.shares::text,
         coalesce(p.shares, 0)::text,
         w.status, w.created_at, w.approved_at, w.approved_at + interval '14 days',
         public._member_label(w.approved_by),
         w.self_approved,
         w.amount_usdc_locked::text,
         case when coalesce(v_supply, 0) > 0 then div(w.shares * coalesce(v_value, 0), v_supply)::text end,
         w.last_expired_at, w.reject_reason, w.payout_tx_hash, w.payout_amount::text, w.payout_recorded_at, w.paid_at,
         (w.status = 'approved' and w.payout_tx_hash is null and exists (
            select 1 from public.dao_safe_operations o
            where o.withdrawal_id = w.id
              and o.occurred_at between w.approved_at - interval '120 seconds' and w.approved_at + interval '14 days')),
         w.rejected_at, w.cancelled_at,
         -- item 8: an unexplained USDC outflow to the destination since the approval (rule of treasury_unexplained_outflows)
         (w.status = 'approved' and w.payout_tx_hash is null and exists (
            select 1 from public.dao_safe_operations o
            left join public.withdrawal_requests ow on ow.id = o.withdrawal_id
            left join public.raffles r on r.id = o.raffle_id
            where o.chain_id = w.chain_id
              and o.direction = 'out' and o.asset = 'USDC' and o.ledger_id is null and o.note is null
              and o.counterparty = w.destination_address
              and o.occurred_at >= w.approved_at - interval '120 seconds'
              and not coalesce((ow.status = 'approved' and (ow.payout_tx_hash is null
                                                           or (ow.payout_tx_hash = o.tx_hash and ow.payout_log_index = o.log_index)))
                               or (ow.status = 'paid' and ow.payout_tx_hash = o.tx_hash and ow.payout_log_index = o.log_index),
                               false)
              and not coalesce((r.status = 'drawn' and (r.payout_tx_hash is null
                                                       or (r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index)))
                               or (r.status = 'paid' and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index),
                               false)))
  from public.withdrawal_requests w
  join public.members m on m.id = w.member_id
  left join public.dao_positions p on p.chain_id = w.chain_id and p.member_id = w.member_id
  where w.chain_id = v_chain
    and (w.status in ('pending', 'approved')
         or coalesce(w.paid_at, w.rejected_at, w.cancelled_at) >= now() - interval '30 days')
  order by (w.status in ('pending', 'approved')) desc, w.created_at desc, w.id;
end;
$$;

revoke execute on function public.treasury_withdrawals() from public, anon, authenticated, service_role;
grant execute on function public.treasury_withdrawals() to authenticated;
