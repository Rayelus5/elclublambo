-- F3c Task 2 fix round 1.
--   F3c-R3: create_bounty_payment_intent no longer lets one bounty be paid twice.
--   F3c-R4: bounties.paid_at is the payment's block timestamp, not the confirm time.

-- create_bounty_payment_intent: identical to 20261018700002 plus, under the per-member advisory lock:
--   (b) payment_in_progress when another intent of this bounty is creditable: pending, with at least one hash attached
--       and still confirmable under F3b-R2 (not expired, or both required hashes attached before expiry and within
--       7 days of creation);
--   (a) idempotent: a pending, unexpired intent with no hash attached is returned unchanged. The new p_amount and
--       p_fee_bps are IGNORED in that case (the member keeps the amounts of the intent they already hold).
-- (b) is evaluated before (a) so a creditable intent is never hidden behind a hashless one.
create or replace function public.create_bounty_payment_intent(p_bounty uuid, p_amount numeric, p_fee_bps int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  b public.bounties;
  v_chain int;
  v_min_fee int;
  v_fee numeric;
  v_addr text;
  v_platform text;
  v_id uuid;
  v_exp timestamptz;
  v_max numeric;
  v_open public.payment_intents;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_bounty is null or p_amount is null or p_amount <> trunc(p_amount) or p_fee_bps is null then
    raise exception 'invalid_input';
  end if;

  select * into b from public.bounties x where x.message_id = p_bounty;
  if not found then
    raise exception 'not_found';
  end if;
  if b.author_id <> v_me then
    raise exception 'forbidden';
  end if;

  -- same lock key and cap as tip intents; serializes this author's intents for the checks below
  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  select * into b from public.bounties x where x.message_id = p_bounty;

  if b.cancelled_at is not null then
    raise exception 'bounty_closed';
  end if;
  if b.paid_at is not null then
    raise exception 'already_paid';
  end if;
  if b.solution_marked_at is null then
    raise exception 'no_solution';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select (c.value #>> '{}')::int into v_min_fee from public.app_config c where c.key = 'min_fee_bps';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if v_chain <> b.chain_id then
    raise exception 'bounty_chain_inactive';
  end if;

  -- (b) a payment of this bounty may already be on its way
  if exists (
    select 1 from public.payment_intents i
    where i.purpose = 'bounty' and i.target_id = b.message_id and i.status = 'pending'
      and (i.main_tx_hash is not null or i.fee_tx_hash is not null)
      and (i.expires_at > now()
           or (i.hashes_attached_at is not null and i.hashes_attached_at <= i.expires_at
               and now() <= i.created_at + interval '7 days'))
  ) then
    raise exception 'payment_in_progress';
  end if;

  -- (a) idempotent: hand back the live, hashless intent as it is
  select * into v_open from public.payment_intents i
  where i.purpose = 'bounty' and i.target_id = b.message_id and i.member_id = v_me and i.status = 'pending'
    and i.expires_at > now() and i.main_tx_hash is null and i.fee_tx_hash is null
  order by i.created_at desc, i.id
  limit 1;
  if found then
    return jsonb_build_object(
      'id', v_open.id, 'chainId', v_open.chain_id, 'token', v_open.token,
      'amount', v_open.amount::text, 'feeAmount', v_open.fee_amount::text,
      'recipientAddress', v_open.recipient_address, 'platformAddress', v_open.platform_address,
      'expiresAt', v_open.expires_at);
  end if;

  -- (c) a new intent
  if p_amount < b.amount then
    raise exception 'amount_below_bounty';
  end if;
  v_max := case b.token when 'USDC' then 100000::numeric * 1000000 else 100::numeric * 1000000000000000000 end;
  if p_amount > v_max then
    raise exception 'amount_out_of_range';
  end if;
  if p_fee_bps < 0 or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;
  if p_fee_bps < coalesce(v_min_fee, 0) then
    raise exception 'fee_below_minimum';
  end if;

  select m.wallet_address into v_addr from public.members m where m.id = b.solver_id and m.status = 'active';
  if v_addr is null then
    raise exception 'not_found';
  end if;

  v_fee := div(p_amount * p_fee_bps + 9999, 10000);
  if v_fee > 0 then
    select cc.platform_wallet into v_platform from public.chain_config cc where cc.chain_id = v_chain;
    if v_platform is null then
      raise exception 'platform_not_configured';
    end if;
  end if;

  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'bounty', v_chain, b.token, p_amount, p_fee_bps, coalesce(v_min_fee, 0), v_fee,
          b.solver_id, v_addr, case when v_fee > 0 then v_platform end,
          'bounty', b.message_id, false)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', v_chain, 'token', b.token,
    'amount', p_amount::text, 'feeAmount', v_fee::text,
    'recipientAddress', v_addr, 'platformAddress', case when v_fee > 0 then v_platform end,
    'expiresAt', v_exp);
end;
$$;

-- confirm_bounty_payment: identical to 20261018700002 except paid_at is the payment's block time.
-- p_main must carry "blockTimestamp": an ISO 8601 string with offset (e.g. "2026-10-18T12:05:00.000Z") or integer epoch
-- seconds. It must lie within [intent.created_at - 120 s, now() + 60 s], otherwise tx_mismatch; missing or malformed
-- is invalid_input.
create or replace function public.confirm_bounty_payment(p_intent uuid, p_main jsonb, p_fee jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.payment_intents;
  b public.bounties;
  v_h record;
  v_tip uuid;
  v_msg public.messages;
  v_notice uuid;
  v_text text;
  v_skip boolean;
  v_raw text;
  v_paid_at timestamptz;
begin
  select * into i from public.payment_intents x where x.id = p_intent for update;
  if not found or i.purpose <> 'bounty' or i.target_type <> 'bounty' then
    raise exception 'not_found';
  end if;
  if i.status = 'confirmed' then
    select t.id into v_tip from public.tips t where t.intent_id = i.id;
    return v_tip;
  end if;

  select * into b from public.bounties x where x.message_id = i.target_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if b.paid_at is not null then
    raise exception 'already_paid';
  end if;
  -- rechecks: the intent must still describe this bounty's solver, token, chain and a sufficient amount
  if b.cancelled_at is not null or b.solution_message_id is null
     or i.recipient_member_id is distinct from b.solver_id
     or i.token <> b.token or i.chain_id <> b.chain_id or i.amount < b.amount or i.anonymous then
    raise exception 'invalid_input';
  end if;

  -- ruling F3c-R4: paid_at is when the payment was mined
  v_raw := case when p_main is not null and jsonb_typeof(p_main) = 'object' then p_main ->> 'blockTimestamp' end;
  if v_raw ~ '^[0-9]{1,12}$' then
    v_paid_at := to_timestamp(v_raw::bigint);
  elsif v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then
    begin
      v_paid_at := v_raw::timestamptz;
    exception when others then
      raise exception 'invalid_input';
    end;
  else
    raise exception 'invalid_input';
  end if;
  if v_paid_at < i.created_at - interval '120 seconds' or v_paid_at > now() + interval '60 seconds' then
    raise exception 'tx_mismatch';
  end if;

  select * into v_h from public._record_payment_transfers(i, p_main, p_fee);

  insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount,
                           fee_amount, anonymous, main_tx_hash, fee_tx_hash, block_number)
  values (i.id, i.chain_id, i.member_id, i.recipient_member_id, 'message', b.solution_message_id,
          i.token, i.amount, i.fee_amount, false, v_h.main_hash, v_h.fee_hash, v_h.block)
  returning id into v_tip;

  update public.payment_intents set status = 'confirmed' where id = i.id;
  update public.bounties set paid_at = v_paid_at, paid_tip_id = v_tip where message_id = b.message_id;

  select * into v_msg from public.messages x where x.id = b.message_id for update;
  v_skip := not found or v_msg.deleted_at is not null;
  if not v_skip then
    v_text := public._member_label(i.member_id) || ' ha pagado el bounty: '
              || public._format_token_amount(i.amount, i.token) || ' ' || i.token
              || ' a ' || public._member_label(i.recipient_member_id);
    insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, expanded, allow_links,
                                 kind, tip_id)
    values (b.channel_id, b.message_id, null,
            jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
              'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))))),
            v_text, false, false, 'system', v_tip)
    returning id into v_notice;
    update public.messages set reply_count = reply_count + 1, last_reply_at = now() where id = b.message_id;
  end if;

  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  select i.recipient_member_id, 'bounty_paid', i.member_id, b.channel_id, v_notice,
         jsonb_strip_nulls(jsonb_build_object('bountyId', b.message_id, 'tipId', v_tip,
                                              'messageId', b.solution_message_id, 'threadRootId', b.message_id))
  from public.members r
  where r.id = i.recipient_member_id and r.status = 'active';

  return v_tip;
end;
$$;

revoke execute on function
  public.create_bounty_payment_intent(uuid, numeric, int),
  public.confirm_bounty_payment(uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.create_bounty_payment_intent(uuid, numeric, int) to authenticated;
grant execute on function public.confirm_bounty_payment(uuid, jsonb, jsonb) to service_role;
