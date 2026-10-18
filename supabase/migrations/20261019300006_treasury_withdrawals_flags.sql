-- F4c Task 7 fix round 1 (ruling F4c-R6): treasury_withdrawals() (latest 20261019300003) gains
--   payout_linked  - a Safe outflow is linked to the request inside its payout window and the payout is not recorded yet
--                    (a real payment awaiting verification: the panel disables Rechazar, as reject_withdrawal refuses, R3);
--   rejected_at / cancelled_at - when the closed request closed (the "Recientes" list shows it).
-- The return type changes, so the function is dropped and re-created with the same grants.
drop function public.treasury_withdrawals();

create function public.treasury_withdrawals()
returns table (id uuid, member_id uuid, member_label text, wallet text, shares text, position_shares text, status text,
               created_at timestamptz, approved_at timestamptz, expires_at timestamptz, approved_by_label text,
               self_approved boolean, amount_usdc text, estimate_usd6 text, last_expired_at timestamptz,
               reject_reason text, payout_tx_hash text, payout_amount text, payout_recorded_at timestamptz,
               paid_at timestamptz, payout_linked boolean, rejected_at timestamptz, cancelled_at timestamptz)
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
         m.wallet_address,
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
         w.rejected_at, w.cancelled_at
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

-- ===== treasury_unexplained_outflows (bit 256): every unexplained outflow of the active chain, not just the latest =====
-- Same rule as dao_operations' `explained` flag (a note, or a link that explains it as a payout of an approved or paid
-- request), without its row limit: the panel's safety net must not lose an old unexplained outflow. Capped at 500 rows.
create function public.treasury_unexplained_outflows()
returns table (id uuid, asset text, direction text, amount text, tx_hash text, occurred_at timestamptz, note text, explained boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_member_id() is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  return query
  select o.id, o.asset, o.direction, o.amount::text, o.tx_hash, o.occurred_at, o.note, false
  from public.dao_safe_operations o
  left join public.withdrawal_requests w on w.id = o.withdrawal_id
  where o.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
    and o.ledger_id is null
    and o.direction = 'out'
    and o.note is null
    and not coalesce((w.status = 'approved' and (w.payout_tx_hash is null
                                                or (w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)))
                     or (w.status = 'paid' and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index),
                     false)
  order by o.occurred_at desc, o.id desc
  limit 500;
end;
$$;

revoke execute on function public.treasury_unexplained_outflows() from public, anon, authenticated, service_role;
grant execute on function public.treasury_unexplained_outflows() to authenticated;
