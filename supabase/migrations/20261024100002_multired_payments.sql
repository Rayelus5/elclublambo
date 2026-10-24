-- P0 Task 4: tips and bounties per enabled network, no fee (spec D13/D22; rulings P0-R4, P0-R5, P0-R7).
--   - create_tip_intent / create_bounty / create_bounty_payment_intent take the chain: chain_invalid unless
--     private.chain_enabled, network_not_accepted unless the recipient (or the solver) receives on that network.
--     The fee is gone: fee_bps = min_fee_bps = fee_amount = 0 and no platform address (the columns stay, P0-R5); the
--     intent JSON keeps feeAmount "0" and platformAddress null for the local ledger.
--   - A bounty keeps its announced network but is paid with its own token on any enabled network the solver accepts
--     (P0-R4): no bounty_chain_inactive, no other_chain, and confirm_bounty_payment drops the chain equality.
--   - member_tips_totals sums the enabled networks; the bounty and tip reads filter on private.chain_enabled instead
--     of the legacy active chain. The DAO parts (donations in club_activity) keep _active_chain().
-- Each function starts from its latest definition (cited above it).

-- ===== create_tip_intent (latest 20261019700101_rate_limits.sql) =====
drop function public.create_tip_intent(text, uuid, text, numeric, int, boolean);
create function public.create_tip_intent(
  p_target_type text, p_target_id uuid, p_chain_id int, p_token text, p_amount numeric, p_anonymous boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_recipient uuid;
  v_addr text;
  v_networks text[];
  v_msg public.messages;
  v_id uuid;
  v_exp timestamptz;
  v_min numeric;
  v_max numeric;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 intents per 10 minutes (tips, bounty payments, donations)
  perform private.rate_limit(v_me::text, 'payment_intent', 30, interval '10 minutes');
  if p_target_type is null or p_target_type not in ('message', 'profile') or p_target_id is null
     or p_chain_id is null
     or p_token is null or p_token not in ('ETH', 'USDC')
     or p_amount is null or p_amount <> trunc(p_amount)
     or p_anonymous is null then
    raise exception 'invalid_input';
  end if;

  if p_token = 'USDC' then
    v_min := 10000;                       -- 0.01
    v_max := 100000::numeric * 1000000;   -- 100000
  else
    v_min := 10000000000000;              -- 0.00001
    v_max := 100::numeric * 1000000000000000000; -- 100
  end if;
  if p_amount < v_min or p_amount > v_max then
    raise exception 'amount_out_of_range';
  end if;

  if not private.chain_enabled(p_chain_id) then
    raise exception 'chain_invalid';
  end if;

  if p_target_type = 'message' then
    select * into v_msg from public.messages x where x.id = p_target_id;
    if not found or v_msg.deleted_at is not null or v_msg.kind = 'system' or v_msg.author_id is null
       or not public.can(v_msg.channel_id, 1) then
      raise exception 'not_found';
    end if;
    v_recipient := v_msg.author_id;
  else
    v_recipient := p_target_id;
  end if;
  select m.wallet_address, m.receive_networks into v_addr, v_networks
  from public.members m where m.id = v_recipient and m.status = 'active';
  if v_addr is null then
    raise exception 'not_found';
  end if;
  if v_recipient = v_me then
    raise exception 'self_payment';
  end if;
  -- Review Focus 2: the server refuses a network the recipient does not receive on, whatever the client sent
  if not ((select c.network from public.chains c where c.chain_id = p_chain_id) = any (v_networks)) then
    raise exception 'network_not_accepted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'tip', p_chain_id, p_token, p_amount, 0, 0, 0,
          v_recipient, v_addr, null,
          p_target_type, p_target_id, p_anonymous)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', p_chain_id, 'token', p_token,
    'amount', p_amount::text, 'feeAmount', '0',
    'recipientAddress', v_addr, 'platformAddress', null,
    'expiresAt', v_exp);
end;
$$;

-- ===== create_bounty (latest 20261018700002_bounties.sql) =====
drop function public.create_bounty(uuid, jsonb, text, numeric);
create function public.create_bounty(p_channel uuid, p_body jsonb, p_chain_id int, p_token text, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
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
  if p_chain_id is null or p_token is null or p_token not in ('ETH', 'USDC')
     or p_amount is null or p_amount <> trunc(p_amount) then
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
  if not private.chain_enabled(p_chain_id) then
    raise exception 'chain_invalid';
  end if;

  -- same validation, slowmode and insert path as any root message; no thread, quote, attachments or alpha address
  v_id := public._post_message_core(v_me, p_channel, p_body, null, false, null, null, null, null);
  update public.messages set kind = 'bounty' where id = v_id;
  insert into public.bounties (message_id, channel_id, author_id, chain_id, token, amount)
  values (v_id, p_channel, v_me, p_chain_id, p_token, p_amount);
  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

-- ===== create_bounty_payment_intent (latest 20261019700101_rate_limits.sql) =====
-- Paid with the bounty's token on any enabled network the solver accepts (P0-R4). The idempotent intent (a) only comes
-- back when it is on the requested network. One on another network is left pending (it may already be signed and
-- broadcast, its hash not yet attached) and expires on its own; a new intent on the requested network coexists.
drop function public.create_bounty_payment_intent(uuid, numeric, int);
create function public.create_bounty_payment_intent(p_bounty uuid, p_chain_id int, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  b public.bounties;
  v_addr text;
  v_id uuid;
  v_exp timestamptz;
  v_max numeric;
  v_open public.payment_intents;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_bounty is null or p_chain_id is null or p_amount is null or p_amount <> trunc(p_amount) then
    raise exception 'invalid_input';
  end if;

  select * into b from public.bounties x where x.message_id = p_bounty;
  if not found then
    raise exception 'not_found';
  end if;
  if b.author_id <> v_me then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 intents per 10 minutes (tips, bounty payments, donations)
  perform private.rate_limit(v_me::text, 'payment_intent', 30, interval '10 minutes');

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

  if not private.chain_enabled(p_chain_id) then
    raise exception 'chain_invalid';
  end if;
  -- the solver's networks, checked before (a) so a live intent on a network they dropped is never handed back
  if exists (select 1 from public.members s
             where s.id = b.solver_id
               and not ((select c.network from public.chains c where c.chain_id = p_chain_id) = any (s.receive_networks))) then
    raise exception 'network_not_accepted';
  end if;

  -- (b) a payment of this bounty may already be on its way (on any network)
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

  -- (a) idempotent: hand back the live, hashless intent on this network as it is. One on another network is never
  -- touched: the author may have signed it in another tab and not attached the hash yet, and expiring it would make
  -- that transfer unrecordable (attach_intent_tx refuses a non-pending intent). Confirmation settles the bounty once.
  select * into v_open from public.payment_intents i
  where i.purpose = 'bounty' and i.target_id = b.message_id and i.member_id = v_me and i.status = 'pending'
    and i.expires_at > now() and i.main_tx_hash is null and i.fee_tx_hash is null and i.chain_id = p_chain_id
  order by i.created_at desc, i.id
  limit 1;
  if found then
    return jsonb_build_object(
      'id', v_open.id, 'chainId', v_open.chain_id, 'token', v_open.token,
      'amount', v_open.amount::text, 'feeAmount', v_open.fee_amount::text,
      'recipientAddress', v_open.recipient_address, 'platformAddress', v_open.platform_address,
      'expiresAt', v_open.expires_at);
  end if;

  -- (c) a new intent, always in the bounty's token
  if p_amount < b.amount then
    raise exception 'amount_below_bounty';
  end if;
  v_max := case b.token when 'USDC' then 100000::numeric * 1000000 else 100::numeric * 1000000000000000000 end;
  if p_amount > v_max then
    raise exception 'amount_out_of_range';
  end if;

  select m.wallet_address into v_addr from public.members m where m.id = b.solver_id and m.status = 'active';
  if v_addr is null then
    raise exception 'not_found';
  end if;

  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'bounty', p_chain_id, b.token, p_amount, 0, 0, 0,
          b.solver_id, v_addr, null,
          'bounty', b.message_id, false)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', p_chain_id, 'token', b.token,
    'amount', p_amount::text, 'feeAmount', '0',
    'recipientAddress', v_addr, 'platformAddress', null,
    'expiresAt', v_exp);
end;
$$;

-- ===== confirm_bounty_payment (latest 20261018700004_bounty_clock_skew.sql) =====
-- Identical except the recheck: the intent's chain no longer has to be the bounty's announced one (P0-R4, ruling #4);
-- it has to be enabled (chain_invalid), and the token must still be the bounty's.
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
  -- rechecks: the intent must still describe this bounty's solver, token and a sufficient amount
  if b.cancelled_at is not null or b.solution_message_id is null
     or i.recipient_member_id is distinct from b.solver_id
     or i.token <> b.token or i.amount < b.amount or i.anonymous then
    raise exception 'invalid_input';
  end if;
  if not private.chain_enabled(i.chain_id) then
    raise exception 'chain_invalid';
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

-- ===== bounty_status (latest 20261018800020_f3_final_fixes.sql): no other_chain =====
create or replace function public.bounty_status(b public.bounties)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when b.cancelled_at is not null then 'cancelled'
    when b.paid_at is not null and b.paid_at <= b.solution_marked_at + interval '7 days' then 'paid'
    when b.paid_at is not null then 'paid_late'
    when exists (select 1 from public.messages m
                 where m.id = b.message_id and m.deleted_at is not null
                   and m.deleted_by is distinct from b.author_id) then 'removed'
    when b.solver_id is not null
         and not exists (select 1 from public.members s where s.id = b.solver_id and s.status = 'active')
      then 'solver_unavailable'
    else public._bounty_lifecycle_status(b)
  end
$$;

-- ===== member_bounty_record / member_unpaid_bounties (latest 20261018800020_f3_final_fixes.sql) =====
-- The active-chain filter becomes the enabled networks.
create or replace function public.member_bounty_record(p_member uuid)
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
      and private.chain_enabled(b.chain_id)
      and b.channel_id in (select v.id from public.visible_channels() v)
  ) x
$$;

create or replace function public.member_unpaid_bounties(p_member uuid)
returns table (message_id uuid, channel_id uuid, token text, amount_text text, solution_marked_at timestamptz, chain_id int)
language sql
stable
security definer
set search_path = ''
as $$
  select b.message_id, b.channel_id, b.token, b.amount::text, b.solution_marked_at, b.chain_id
  from public.bounties b
  where public.is_active_member()
    and b.author_id = p_member
    and private.chain_enabled(b.chain_id)
    and public.bounty_status(b) = 'unpaid'
    and b.channel_id in (select v.id from public.visible_channels() v)
  order by b.solution_marked_at, b.message_id
$$;

-- ===== member_tips_totals (latest 20261018800020_f3_final_fixes.sql): every enabled network, one row per token =====
drop function public.member_tips_totals(uuid, int);
create function public.member_tips_totals(p_member uuid)
returns table (token text, total_text text, tip_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select t.token, sum(t.amount)::text, count(*)::int
  from public.tips t
  left join public.messages m on m.id = t.message_id
  where public.is_active_member()
    and t.to_member = p_member
    and private.chain_enabled(t.chain_id)
    and (t.target_type = 'profile'
         or (m.id is not null and m.channel_id in (select v.id from public.visible_channels() v))
         or (m.id is null and public.current_member_id() in (t.to_member, t.from_member)))
  group by t.token
$$;

-- ===== home_open_bounties / club_activity (latest 20261019000004_polish_review_fixes.sql) =====
create or replace function public.home_open_bounties(p_limit int default 5, p_channel uuid default null)
returns table (message_id uuid, channel_id uuid, channel_name text, token text, amount_text text, status text,
               excerpt text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with vis as (select v.id, v.name from public.visible_channels() v where p_channel is null or v.id = p_channel)
  select b.message_id, b.channel_id, vis.name, b.token, b.amount::text, s.status, left(m.body_text, 140), b.created_at
  from public.bounties b
  join vis on vis.id = b.channel_id
  join public.messages m on m.id = b.message_id
  cross join lateral (select public.bounty_status(b) as status) s
  where public.is_active_member()
    and private.chain_enabled(b.chain_id)
    and b.paid_at is null and b.cancelled_at is null
    and m.deleted_at is null
    and s.status in ('open', 'solution_marked')
  order by b.created_at desc
  limit greatest(1, least(20, coalesce(p_limit, 5)))
$$;

-- Tips and bounties: the enabled networks. Donations (legacy DAO, P0-R2): still the active chain.
create or replace function public.club_activity(p_limit int default 15)
returns table (kind text, at timestamptz, actor_label text, target_label text, token text, amount_text text,
               channel_id uuid, message_id uuid, target_wallet text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.current_member_id() as id),
  lim as (select greatest(1, least(50, coalesce(p_limit, 15))) as n),
  vis as (select v.id from public.visible_channels() v),
  chain as (select public._active_chain() as id),
  -- each source is cut to the limit before any label is computed
  tips as (
    select t.created_at, t.from_member, t.to_member, t.anonymous, t.token, t.amount, m.channel_id, t.message_id
    from public.tips t
    left join public.messages m on m.id = t.message_id
    where private.chain_enabled(t.chain_id)
      and (t.target_type = 'profile' or (m.deleted_at is null and m.channel_id in (select id from vis)))
    order by t.created_at desc
    limit (select n from lim)
  ),
  donations as (
    select l.credited_at, l.member_id, l.amount_usdc
    from public.dao_ledger l
    where l.chain_id = (select id from chain) and l.status = 'credited'
    order by l.credited_at desc
    limit (select n from lim)
  ),
  new_bounties as (
    select b.created_at, b.author_id, b.token, b.amount, b.channel_id, b.message_id
    from public.bounties b
    join public.messages m on m.id = b.message_id
    where private.chain_enabled(b.chain_id) and m.deleted_at is null and b.channel_id in (select id from vis)
    order by b.created_at desc
    limit (select n from lim)
  ),
  merged as (
    select 'tip'::text as kind, t.created_at as at, t.from_member as actor, t.anonymous, t.to_member as target,
           t.token, t.amount, t.channel_id, t.message_id
    from tips t
    union all
    select 'donation', d.credited_at, d.member_id, false, null, 'USDC', d.amount_usdc, null, null from donations d
    union all
    select 'bounty', b.created_at, b.author_id, false, null, b.token, b.amount, b.channel_id, b.message_id from new_bounties b
    order by 2 desc
    limit (select n from lim)
  )
  select x.kind, x.at,
         case
           when x.kind = 'tip' and x.anonymous and x.actor <> (select id from me) then 'Anónimo'
           when x.kind = 'donation' and x.actor <> (select id from me)
                and not (select a.dao_ranking_visible from public.members a where a.id = x.actor) then 'Anónimo'
           else public._member_label(x.actor)
         end,
         case when x.target is null then null else public._member_label(x.target) end,
         x.token, x.amount::text, x.channel_id, x.message_id,
         case when x.target is null then null else (select w.wallet_address::text from public.members w where w.id = x.target) end
  from merged x
  where public.is_active_member()
  order by x.at desc
$$;

-- ===== grants (only the recreated functions; create or replace keeps the others') =====
revoke execute on function
  public.create_tip_intent(text, uuid, int, text, numeric, boolean),
  public.create_bounty(uuid, jsonb, int, text, numeric),
  public.create_bounty_payment_intent(uuid, int, numeric),
  public.member_tips_totals(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_tip_intent(text, uuid, int, text, numeric, boolean),
  public.create_bounty(uuid, jsonb, int, text, numeric),
  public.create_bounty_payment_intent(uuid, int, numeric),
  public.member_tips_totals(uuid)
to authenticated;
