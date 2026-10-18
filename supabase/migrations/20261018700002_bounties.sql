-- F3c Task 2: bounties. A bounty is a messages row (kind 'bounty') plus a bounties row with the amount, token, chain and
-- lifecycle timestamps. The status is derived at read time (bounty_status), no cron. Payment reuses the F3b intent,
-- verification and ledger machinery with purpose 'bounty'; confirm_bounty_payment (service_role) records the transfers
-- and a tips row on the solution message.
--
-- Ruling F3c-R1: no code path may hard-delete a bounty message (bounties.message_id is ON DELETE RESTRICT). delete_message
-- soft-deletes bounty messages and marked solutions, never reaps a bounty tombstone, and delete_channel refuses a
-- channel that holds bounties. Consequence: a channel with bounties can only be emptied by cancelling/leaving them, it
-- cannot be deleted.

-- ===== messages / notifications kinds =====
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'alpha', 'system', 'bounty'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid'
));

-- ===== bounties =====
create table public.bounties (
  message_id uuid primary key references public.messages (id) on delete restrict,
  channel_id uuid not null references public.channels (id) on delete restrict,
  author_id uuid not null references public.members (id),
  chain_id int not null check (chain_id in (59144, 59141)),
  token text not null check (token in ('ETH', 'USDC')),
  amount numeric(78, 0) not null check (amount > 0),
  solution_message_id uuid references public.messages (id) on delete restrict,
  solver_id uuid references public.members (id),
  solution_marked_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  paid_tip_id uuid references public.tips (id),
  created_at timestamptz not null default now(),
  constraint bounties_solution_all_or_none check (
    (solution_message_id is null) = (solver_id is null) and (solver_id is null) = (solution_marked_at is null)),
  constraint bounties_paid_needs_solution check (paid_at is null or solution_marked_at is not null),
  constraint bounties_cancel_excludes_solution check (cancelled_at is null or solution_marked_at is null)
);
create index bounties_author_idx on public.bounties (author_id);
create index bounties_channel_idx on public.bounties (channel_id);
create index bounties_solver_idx on public.bounties (solver_id) where solver_id is not null;
create index bounties_solution_idx on public.bounties (solution_message_id) where solution_message_id is not null;

alter table public.bounties enable row level security;
revoke all on public.bounties from anon, authenticated;

-- ===== derived status =====
create function public.bounty_status(b public.bounties)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when b.cancelled_at is not null then 'cancelled'
    when b.paid_at is not null and b.paid_at <= b.solution_marked_at + interval '7 days' then 'paid'
    when b.paid_at is not null then 'paid_late'
    when b.solution_marked_at is not null and now() > b.solution_marked_at + interval '7 days' then 'unpaid'
    when b.solution_marked_at is not null then 'solution_marked'
    when now() > b.created_at + interval '30 days' then 'expired'
    else 'open'
  end
$$;

-- ===== shared payment recording (confirm_tip and confirm_bounty_payment) =====
-- Expiry (ruling F3b-R2), input validation and the onchain_transfers uniqueness; the caller holds the intent lock.
create function public._record_payment_transfers(i public.payment_intents, p_main jsonb, p_fee jsonb)
returns table (main_hash text, fee_hash text, block bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_main_log int;
  v_fee_log int;
begin
  -- ruling F3b-R2: an expired intent still confirms when both required hashes were attached before it expired,
  -- within 7 days of creation
  if i.status <> 'pending'
     or (i.expires_at <= now()
         and not (i.hashes_attached_at is not null and i.hashes_attached_at <= i.expires_at
                  and now() <= i.created_at + interval '7 days')) then
    raise exception 'intent_expired';
  end if;

  if p_main is null or jsonb_typeof(p_main) <> 'object'
     or coalesce(p_main ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(p_main ->> 'logIndex', '') !~ '^-?[0-9]{1,9}$'
     or coalesce(p_main ->> 'blockNumber', '') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid_input';
  end if;
  main_hash := lower(p_main ->> 'txHash');
  v_main_log := (p_main ->> 'logIndex')::int;
  block := (p_main ->> 'blockNumber')::bigint;
  if (i.token = 'ETH' and v_main_log <> -1) or (i.token = 'USDC' and v_main_log < 0) then
    raise exception 'invalid_input';
  end if;
  if i.main_tx_hash is null or i.main_tx_hash is distinct from main_hash then
    raise exception 'tx_mismatch';
  end if;

  if i.fee_amount > 0 then
    if p_fee is null or jsonb_typeof(p_fee) <> 'object' then
      raise exception 'tx_mismatch';
    end if;
    if i.fee_tx_hash is null then
      raise exception 'tx_mismatch';
    end if;
    if coalesce(p_fee ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$' or coalesce(p_fee ->> 'logIndex', '') !~ '^-?[0-9]{1,9}$' then
      raise exception 'tx_mismatch';
    end if;
    fee_hash := lower(p_fee ->> 'txHash');
    v_fee_log := (p_fee ->> 'logIndex')::int;
    if (i.token = 'ETH' and v_fee_log <> -1) or (i.token = 'USDC' and v_fee_log < 0) then
      raise exception 'invalid_input';
    end if;
    if i.fee_tx_hash is distinct from fee_hash then
      raise exception 'tx_mismatch';
    end if;
  elsif p_fee is not null and jsonb_typeof(p_fee) <> 'null' then
    raise exception 'tx_mismatch';
  end if;

  begin
    insert into public.onchain_transfers (chain_id, tx_hash, log_index, intent_id, role)
    values (i.chain_id, main_hash, v_main_log, i.id, 'main');
    if fee_hash is not null then
      insert into public.onchain_transfers (chain_id, tx_hash, log_index, intent_id, role)
      values (i.chain_id, fee_hash, v_fee_log, i.id, 'fee');
    end if;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;
  return next;
end;
$$;

-- confirm_tip: identical to 20261018600002 except the validation/recording now lives in _record_payment_transfers.
create or replace function public.confirm_tip(p_intent uuid, p_main jsonb, p_fee jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.payment_intents;
  v_tip uuid;
  v_h record;
  v_msg public.messages;
  v_root uuid;
  v_notice uuid;
  v_text text;
  v_actor text;
  v_skip boolean := true;
begin
  select * into i from public.payment_intents x where x.id = p_intent for update;
  if not found or i.purpose <> 'tip' then
    raise exception 'not_found';
  end if;
  if i.status = 'confirmed' then
    select t.id into v_tip from public.tips t where t.intent_id = i.id;
    return v_tip;
  end if;
  select * into v_h from public._record_payment_transfers(i, p_main, p_fee);

  insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount,
                           fee_amount, anonymous, main_tx_hash, fee_tx_hash, block_number)
  values (i.id, i.chain_id, i.member_id, i.recipient_member_id, i.target_type,
          (select m.id from public.messages m where m.id = i.target_id and i.target_type = 'message'),
          i.token, i.amount, i.fee_amount, i.anonymous, v_h.main_hash, v_h.fee_hash, v_h.block)
  returning id into v_tip;

  update public.payment_intents set status = 'confirmed' where id = i.id;

  if i.target_type = 'message' then
    select * into v_msg from public.messages x where x.id = i.target_id;
    if found then
      v_root := coalesce(v_msg.thread_root_id, v_msg.id);
      -- serialize with normal replies on the same root; skip the notice when the target or its root is deleted (m2)
      select r.deleted_at is not null into v_skip from public.messages r where r.id = v_root for update;
      v_skip := coalesce(v_skip, true) or v_msg.deleted_at is not null;
    end if;
    if not v_skip then
      v_actor := case when i.anonymous then 'Anónimo' else public._member_label(i.member_id) end;
      v_text := v_actor || ' ha enviado ' || public._format_token_amount(i.amount, i.token) || ' ' || i.token
                || ' a ' || public._member_label(i.recipient_member_id) || ' por este mensaje';
      insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, expanded, allow_links,
                                   kind, tip_id)
      values (v_msg.channel_id, v_root, null,
              jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
                'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))))),
              v_text, false, false, 'system', v_tip)
      returning id into v_notice;
      update public.messages set reply_count = reply_count + 1, last_reply_at = now() where id = v_root;
    end if;
  end if;

  -- message_id is the system notice (one per tip), so the per-(recipient, message) unique index never swallows a
  -- second tip on the same message; the tipped message and its thread root travel in data.
  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  select i.recipient_member_id, 'tip_received',
         case when i.anonymous then null else i.member_id end,
         v_msg.channel_id,
         v_notice,
         jsonb_strip_nulls(jsonb_build_object('tipId', v_tip, 'messageId', v_msg.id, 'threadRootId', v_root))
  from public.members r
  where r.id = i.recipient_member_id and r.status = 'active';

  return v_tip;
end;
$$;

-- ===== create_bounty =====
create function public.create_bounty(p_channel uuid, p_body jsonb, p_token text, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_min numeric;
  v_max numeric;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() or p_channel is null then
    raise exception 'forbidden';
  end if;
  -- CREATE_BOUNTIES 65536 and SEND_MESSAGES 2 (the core also checks VIEW and the channel kind)
  if (public.channel_permissions(v_me, p_channel) & 65538) <> 65538 then
    raise exception 'forbidden';
  end if;
  if p_token is null or p_token not in ('ETH', 'USDC') or p_amount is null or p_amount <> trunc(p_amount) then
    raise exception 'invalid_input';
  end if;
  if p_token = 'USDC' then
    v_min := 1000000;                      -- 1
    v_max := 100000::numeric * 1000000;    -- 100000
  else
    v_min := 100000000000000;              -- 0.0001
    v_max := 100::numeric * 1000000000000000000; -- 100
  end if;
  if p_amount < v_min or p_amount > v_max then
    raise exception 'amount_out_of_range';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;

  -- same validation, slowmode and insert path as any root message; no thread, quote, attachments or alpha address
  v_id := public._post_message_core(v_me, p_channel, p_body, null, false, null, null, null, null);
  update public.messages set kind = 'bounty' where id = v_id;
  insert into public.bounties (message_id, channel_id, author_id, chain_id, token, amount)
  values (v_id, p_channel, v_me, v_chain, p_token, p_amount);
  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

-- ===== mark_bounty_solution =====
create function public.mark_bounty_solution(p_bounty uuid, p_reply uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  b public.bounties;
  v_bounty_deleted boolean;
  v_reply public.messages;
begin
  if v_me is null or not public.is_active_member() or p_bounty is null then
    raise exception 'forbidden';
  end if;
  select * into b from public.bounties x where x.message_id = p_bounty for update;
  if not found then
    raise exception 'not_found';
  end if;
  if b.author_id <> v_me then
    raise exception 'forbidden';
  end if;
  if b.solution_marked_at is not null then
    raise exception 'already_marked';
  end if;
  select m.deleted_at is not null into v_bounty_deleted from public.messages m where m.id = b.message_id;
  if v_bounty_deleted or public.bounty_status(b) in ('cancelled', 'expired') then
    raise exception 'bounty_closed';
  end if;

  select * into v_reply from public.messages r where r.id = p_reply;
  if p_reply is null or not found
     or v_reply.thread_root_id is distinct from b.message_id
     or v_reply.channel_id <> b.channel_id
     or v_reply.deleted_at is not null
     or v_reply.kind = 'system'
     or v_reply.author_id is null
     or v_reply.author_id = v_me
     or not exists (select 1 from public.members s where s.id = v_reply.author_id and s.status = 'active') then
    raise exception 'invalid_solution';
  end if;

  update public.bounties
  set solution_message_id = v_reply.id, solver_id = v_reply.author_id, solution_marked_at = now()
  where message_id = b.message_id;

  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  values (v_reply.author_id, 'bounty_solution', v_me, b.channel_id, v_reply.id,
          jsonb_build_object('bountyId', b.message_id, 'threadRootId', b.message_id))
  on conflict (recipient_id, message_id) where message_id is not null do nothing;
end;
$$;

-- ===== cancel_bounty =====
create function public.cancel_bounty(p_bounty uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  b public.bounties;
  v_bounty_deleted boolean;
begin
  if v_me is null or not public.is_active_member() or p_bounty is null then
    raise exception 'forbidden';
  end if;
  select * into b from public.bounties x where x.message_id = p_bounty for update;
  if not found then
    raise exception 'not_found';
  end if;
  if b.author_id <> v_me then
    raise exception 'forbidden';
  end if;
  if b.solution_marked_at is not null then
    raise exception 'already_marked';
  end if;
  select m.deleted_at is not null into v_bounty_deleted from public.messages m where m.id = b.message_id;
  if v_bounty_deleted or public.bounty_status(b) in ('cancelled', 'expired') then
    raise exception 'bounty_closed';
  end if;
  update public.bounties set cancelled_at = now() where message_id = b.message_id;
end;
$$;

-- ===== create_bounty_payment_intent =====
create function public.create_bounty_payment_intent(p_bounty uuid, p_amount numeric, p_fee_bps int)
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

  -- same lock key and cap as tip intents
  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
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

-- ===== confirm_bounty_payment (service_role) =====
create function public.confirm_bounty_payment(p_intent uuid, p_main jsonb, p_fee jsonb)
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

  select * into v_h from public._record_payment_transfers(i, p_main, p_fee);

  insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount,
                           fee_amount, anonymous, main_tx_hash, fee_tx_hash, block_number)
  values (i.id, i.chain_id, i.member_id, i.recipient_member_id, 'message', b.solution_message_id,
          i.token, i.amount, i.fee_amount, false, v_h.main_hash, v_h.fee_hash, v_h.block)
  returning id into v_tip;

  update public.payment_intents set status = 'confirmed' where id = i.id;
  update public.bounties set paid_at = now(), paid_tip_id = v_tip where message_id = b.message_id;

  -- notice in the bounty thread; serialize with normal replies, skip when the bounty message is deleted (as tips do)
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

-- ===== reads =====
create function public.bounty_details(p_message_ids uuid[])
returns table (message_id uuid, token text, amount_text text, chain_id int, status text, solution_message_id uuid,
               solver_id uuid, solution_marked_at timestamptz, pay_deadline timestamptz, paid_tip_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.message_id, b.token, b.amount::text, b.chain_id, public.bounty_status(b), b.solution_message_id,
         b.solver_id, b.solution_marked_at,
         case when b.solution_marked_at is not null then b.solution_marked_at + interval '7 days' end,
         b.paid_tip_id
  from public.bounties b
  join public.messages m on m.id = b.message_id and m.deleted_at is null
  where public.is_active_member()
    and b.message_id = any (p_message_ids)
    and b.channel_id in (select v.id from public.visible_channels() v)
$$;

-- Only bounties in channels the caller can view are counted; an open bounty whose message was deleted is dead and
-- not counted, while deleted paid/unpaid ones still are (the money record must survive the message).
create function public.member_bounty_record(p_member uuid)
returns table (paid int, paid_late int, unpaid int, open int)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where x.s = 'paid')::int,
         count(*) filter (where x.s = 'paid_late')::int,
         count(*) filter (where x.s = 'unpaid')::int,
         count(*) filter (where x.s = 'open' and not x.deleted)::int
  from (
    select public.bounty_status(b) as s, m.deleted_at is not null as deleted
    from public.bounties b
    join public.messages m on m.id = b.message_id
    where public.is_active_member()
      and b.author_id = p_member
      and b.channel_id in (select v.id from public.visible_channels() v)
  ) x
$$;

create function public.member_unpaid_bounties(p_member uuid)
returns table (message_id uuid, channel_id uuid, token text, amount_text text, solution_marked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.message_id, b.channel_id, b.token, b.amount::text, b.solution_marked_at
  from public.bounties b
  where public.is_active_member()
    and b.author_id = p_member
    and public.bounty_status(b) = 'unpaid'
    and b.channel_id in (select v.id from public.visible_channels() v)
  order by b.solution_marked_at, b.message_id
$$;

-- ===== F3c-R1: delete paths =====
-- delete_message: identical to 20261018600002 plus bounty messages and solutions are always soft-deleted, and a bounty
-- tombstone is never reaped.
create or replace function public.delete_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_root uuid;
  v_root_row public.messages;
  v_perms bigint;
  v_paths text[];
  v_soft boolean;
  v_bounty boolean;
begin
  select * into v_msg from public.messages m where m.id = p_id;
  if v_actor is null or not found then
    raise exception 'forbidden';
  end if;
  -- lock order: thread root first, then the message (post/delete of replies serialize on the root)
  v_root := coalesce(v_msg.thread_root_id, v_msg.id);
  select * into v_root_row from public.messages r where r.id = v_root for update;
  select * into v_msg from public.messages m where m.id = p_id for update;
  if not found then
    raise exception 'forbidden';
  end if;

  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  -- a system notice (null author) can only be removed by a moderator (MANAGE_MESSAGES)
  if (v_perms & 1) = 0 or not (v_msg.author_id is not distinct from v_actor or (v_perms & 8) = 8) then
    raise exception 'forbidden';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'invalid_input';
  end if;

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_paths
  from public.message_attachments a where a.message_id = p_id;

  if v_msg.author_id is distinct from v_actor then
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (v_actor, 'message_deleted', 'message', p_id,
            jsonb_build_object('channel_id', v_msg.channel_id, 'author_id', v_msg.author_id));
  end if;

  -- ruling F3c-R1: a bounty message and its marked solution are only ever soft-deleted, so the bounties row
  -- (FK on delete restrict) and its unpaid status survive
  v_bounty := exists (select 1 from public.bounties b where b.message_id = p_id or b.solution_message_id = p_id);
  v_soft := v_bounty
            or (v_msg.thread_root_id is null
                and exists (select 1 from public.messages r where r.thread_root_id = p_id));

  if v_soft then
    delete from public.message_attachments where message_id = p_id;
    delete from public.message_reactions where message_id = p_id;
    delete from public.message_mentions where message_id = p_id;
    delete from public.alpha_details where message_id = p_id;
    update public.messages
    set body = '{"type":"doc","content":[]}'::jsonb, body_text = '',
        kind = case when kind = 'bounty' then kind else 'text' end, pinned_at = null,
        pinned_by = null, deleted_at = now(), deleted_by = v_actor
    where id = p_id;
    return jsonb_build_object('hard', false, 'paths', to_jsonb(v_paths));
  end if;

  delete from public.messages where id = p_id;

  if v_msg.thread_root_id is not null then
    update public.messages
    set reply_count = greatest(reply_count - 1, 0),
        last_reply_at = (select max(r.created_at) from public.messages r where r.thread_root_id = v_root)
    where id = v_root;
    -- a tombstone whose last reply is gone has nothing left to hold
    if v_root_row.deleted_at is not null
       and not exists (select 1 from public.bounties b where b.message_id = v_root)
       and not exists (select 1 from public.messages r where r.thread_root_id = v_root) then
      delete from public.messages where id = v_root;
    end if;
  end if;
  return jsonb_build_object('hard', true, 'paths', to_jsonb(v_paths));
end;
$$;

-- delete_channel: identical to 20261016200002 plus the bounty guard.
create or replace function public.delete_channel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_node public.channels;
  v_paths text[];
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext('public.channels_tree'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(128) then
    raise exception 'forbidden';
  end if;
  if p_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_node from public.channels c where c.id = p_id for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if (public.channel_permissions(v_actor, p_id) & 1) = 0 then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from public.channels c where c.parent_id = p_id) then
    -- do not reveal children the actor cannot see
    if exists (select 1 from public.channels c
               where c.parent_id = p_id and (public.channel_permissions(v_actor, c.id) & 1) <> 0) then
      raise exception 'not_empty';
    end if;
    raise exception 'forbidden';
  end if;

  -- ruling F3c-R1: bounty messages are never hard-deleted, so a channel that holds bounties cannot be deleted
  if exists (select 1 from public.bounties b where b.channel_id = p_id) then
    raise exception 'channel_has_bounties';
  end if;

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_paths
  from public.message_attachments a join public.messages m on m.id = a.message_id
  where m.channel_id = p_id;
  select count(*)::int into v_count from public.messages m where m.channel_id = p_id;

  delete from public.channels where id = p_id;

  -- keep the remaining siblings contiguous
  update public.channels c set position = o.ord - 1
  from (
    select s.id, row_number() over (order by s.position, s.created_at, s.id) as ord
    from public.channels s where s.parent_id is not distinct from v_node.parent_id
  ) o
  where c.id = o.id and c.position is distinct from o.ord - 1;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'channel_deleted', 'channel', p_id,
          jsonb_build_object('name', v_node.name, 'kind', v_node.kind, 'parent_id', v_node.parent_id,
                             'message_count', v_count));

  return jsonb_build_object('paths', to_jsonb(v_paths));
end;
$$;

-- _push_build: identical to 20261018600002 plus bounty_solution and bounty_paid.
create or replace function public._push_build(p_id bigint)
returns table (title text, body text, url text, tag text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  n public.notifications;
  v_perms bigint := 0;
  v_actor text;
  v_wallet text;
  v_channel text;
  v_subject text;
  v_phrase text;
  v_title text;
  v_url text;
  v_excerpt text;
  v_root text;
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.kind in ('mention', 'reply', 'channel_message') and n.channel_id is null then
    return;
  end if;
  if n.channel_id is not null then
    v_perms := public.channel_permissions(n.recipient_id, n.channel_id);
    if (v_perms & 1) = 0 then
      return;
    end if;
  end if;
  if n.ticket_id is not null and not public._member_can_access_ticket(n.recipient_id, n.ticket_id) then
    return;
  end if;
  if n.kind = 'report_new' and (v_perms & 8) = 0 then
    return;
  end if;
  if n.kind = 'member_review' and (public.member_global_permissions(n.recipient_id) & (32 | 512)) = 0 then
    return;
  end if;

  select coalesce('@' || a.handle::text,
                  '@' || nullif(btrim(regexp_replace(a.display_name, '[[:cntrl:]]+', ' ', 'g')), ''),
                  '@' || left(a.wallet_address, 6) || '…' || right(a.wallet_address, 4)),
         a.wallet_address
    into v_actor, v_wallet
  from public.members a where a.id = n.actor_id;
  v_actor := coalesce(v_actor, case when n.kind = 'tip_received' then 'Anónimo' else 'Alguien' end);

  if n.channel_id is not null then
    select btrim(regexp_replace(c.name, '[[:cntrl:]]+', ' ', 'g')) into v_channel
    from public.channels c where c.id = n.channel_id;
  end if;
  if n.ticket_id is not null then
    select btrim(regexp_replace(t.subject, '[[:cntrl:]]+', ' ', 'g')) into v_subject
    from public.tickets t where t.id = n.ticket_id;
  end if;

  v_url := '/notifications';
  if n.kind in ('mention', 'reply', 'channel_message') then
    v_url := '/c/' || n.channel_id::text;
    v_root := n.data ->> 'thread_root_id';
    if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_url := v_url || '?thread=' || v_root;
    end if;
    select btrim(left(btrim(regexp_replace(m.body_text, '[[:space:][:cntrl:]]+', ' ', 'g')), 80)) into v_excerpt
    from public.messages m
    where m.id = n.message_id and m.channel_id = n.channel_id and m.deleted_at is null;
    v_excerpt := nullif(v_excerpt, '');
  elsif n.kind in ('tip_received', 'bounty_solution', 'bounty_paid') then
    if n.channel_id is not null then
      v_url := '/c/' || n.channel_id::text;
      v_root := n.data ->> 'threadRootId';
      if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_url := v_url || '?thread=' || v_root;
      end if;
    end if;
  elsif n.kind in ('invite_redeemed', 'godchild_banned', 'sponsor_penalized') then
    if v_wallet is not null then
      v_url := '/u/' || v_wallet;
    end if;
  elsif n.kind = 'report_new' then
    v_url := '/moderation/reports';
  elsif n.kind = 'member_review' then
    v_url := '/admin/members';
  elsif n.ticket_id is not null then
    v_url := '/tickets/' || n.ticket_id::text;
  end if;

  case n.kind
    when 'mention' then
      v_title := 'Nueva mención';
      v_phrase := v_actor || ' te mencionó en #' || coalesce(v_channel, '');
    when 'reply' then
      v_title := 'Nueva respuesta';
      v_phrase := v_actor || ' respondió en #' || coalesce(v_channel, '');
    when 'channel_message' then
      v_title := 'Nuevo mensaje';
      v_phrase := v_actor || ' publicó en #' || coalesce(v_channel, '');
    when 'tip_received' then
      v_title := 'Nueva propina';
      v_phrase := 'Has recibido una propina de ' || v_actor;
    when 'bounty_solution' then
      v_title := 'Solución elegida';
      v_phrase := v_actor || ' ha elegido tu respuesta como solución del bounty';
    when 'bounty_paid' then
      v_title := 'Bounty pagado';
      v_phrase := v_actor || ' te ha pagado el bounty';
    when 'invite_redeemed' then
      v_title := 'Invitación canjeada';
      v_phrase := v_actor || ' se unió con tu invitación';
    when 'godchild_banned' then
      v_title := 'Ahijado baneado';
      v_phrase := 'Tu ahijado ' || v_actor || ' ha sido baneado';
    when 'sponsor_penalized' then
      v_title := 'Penalización de padrino';
      v_phrase := 'Te han penalizado porque ' || v_actor || ' fue baneado';
    when 'report_new' then
      v_title := 'Nuevo reporte';
      v_phrase := v_actor || ' reportó un mensaje en #' || coalesce(v_channel, '');
    when 'member_review' then
      v_title := 'Miembro por revisar';
      v_phrase := v_actor || ' necesita revisión';
    when 'ticket_new' then
      v_title := 'Nuevo ticket';
      v_phrase := v_actor || ' abrió un ticket: ' || coalesce(v_subject, '');
    when 'ticket_reply' then
      v_title := 'Respuesta en un ticket';
      v_phrase := v_actor || ' escribió en el ticket: ' || coalesce(v_subject, '');
    when 'ticket_status' then
      if n.data ->> 'status' = 'closed' then
        v_title := 'Ticket cerrado';
        v_phrase := v_actor || ' cerró el ticket: ' || coalesce(v_subject, '');
      else
        v_title := 'Ticket reabierto';
        v_phrase := v_actor || ' reabrió el ticket: ' || coalesce(v_subject, '');
      end if;
    else
      return;
  end case;

  title := v_title;
  body := case when v_excerpt is not null then v_phrase || ': «' || v_excerpt || '»' else v_phrase end;
  url := v_url;
  tag := n.kind || ':' || coalesce(n.message_id::text, n.ticket_id::text, n.id::text);
  return next;
end;
$$;

-- ===== grants =====
revoke execute on function
  public.bounty_status(public.bounties),
  public._record_payment_transfers(public.payment_intents, jsonb, jsonb),
  public.create_bounty(uuid, jsonb, text, numeric),
  public.mark_bounty_solution(uuid, uuid),
  public.cancel_bounty(uuid),
  public.create_bounty_payment_intent(uuid, numeric, int),
  public.confirm_bounty_payment(uuid, jsonb, jsonb),
  public.bounty_details(uuid[]),
  public.member_bounty_record(uuid),
  public.member_unpaid_bounties(uuid),
  public.confirm_tip(uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_bounty(uuid, jsonb, text, numeric),
  public.mark_bounty_solution(uuid, uuid),
  public.cancel_bounty(uuid),
  public.create_bounty_payment_intent(uuid, numeric, int),
  public.bounty_details(uuid[]),
  public.member_bounty_record(uuid),
  public.member_unpaid_bounties(uuid)
to authenticated;

grant execute on function
  public.confirm_bounty_payment(uuid, jsonb, jsonb),
  public.confirm_tip(uuid, jsonb, jsonb)
to service_role;
