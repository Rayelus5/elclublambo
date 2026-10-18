-- F3c Task 3 folded fix: confirm_bounty_payment clamps a block timestamp later than now() to now() (clock skew between
-- the RPC node and the database) instead of refusing the payment. A timestamp earlier than created_at - 120 s is still
-- tx_mismatch. Identical to the body in 20261018700003 otherwise.
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
  if v_paid_at < i.created_at - interval '120 seconds' then
    raise exception 'tx_mismatch';
  end if;
  -- clock skew: a block time ahead of the database clock cannot be later than the confirmation itself
  if v_paid_at > now() then
    v_paid_at := now();
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

revoke execute on function public.confirm_bounty_payment(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.confirm_bounty_payment(uuid, jsonb, jsonb) to service_role;
