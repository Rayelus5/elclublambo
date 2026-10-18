-- F3b Task 1 fixes: delete_message null-author hardening (C1), NULL-safe confirm_tip (I2), late credit of intents
-- signed before expiry (ruling F3b-R2), notice skipped on deleted targets (m2), fee_below_minimum (m4),
-- camelCase notification data keys (m5).
--
-- m3 (accepted): notifications.message_id holds the system notice and is ON DELETE CASCADE, so a moderator deleting a
-- notice also removes the recipient's tip_received notification. The tip itself is unaffected.

alter table public.payment_intents add column hashes_attached_at timestamptz;

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

  v_soft := v_msg.thread_root_id is null
            and exists (select 1 from public.messages r where r.thread_root_id = p_id);

  if v_soft then
    delete from public.message_attachments where message_id = p_id;
    delete from public.message_reactions where message_id = p_id;
    delete from public.message_mentions where message_id = p_id;
    delete from public.alpha_details where message_id = p_id;
    update public.messages
    set body = '{"type":"doc","content":[]}'::jsonb, body_text = '', kind = 'text', pinned_at = null,
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
       and not exists (select 1 from public.messages r where r.thread_root_id = v_root) then
      delete from public.messages where id = v_root;
    end if;
  end if;
  return jsonb_build_object('hard', true, 'paths', to_jsonb(v_paths));
end;
$$;

create or replace function public.create_tip_intent(
  p_target_type text, p_target_id uuid, p_token text, p_amount numeric, p_fee_bps int, p_anonymous boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_min_fee int;
  v_fee numeric;
  v_recipient uuid;
  v_addr text;
  v_platform text;
  v_msg public.messages;
  v_id uuid;
  v_exp timestamptz;
  v_min numeric;
  v_max numeric;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_target_type is null or p_target_type not in ('message', 'profile') or p_target_id is null
     or p_token is null or p_token not in ('ETH', 'USDC')
     or p_amount is null or p_amount <> trunc(p_amount)
     or p_fee_bps is null or p_anonymous is null then
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

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select (c.value #>> '{}')::int into v_min_fee from public.app_config c where c.key = 'min_fee_bps';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_fee_bps < 0 or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;
  if p_fee_bps < coalesce(v_min_fee, 0) then
    raise exception 'fee_below_minimum';
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
  select m.wallet_address into v_addr from public.members m where m.id = v_recipient and m.status = 'active';
  if v_addr is null then
    raise exception 'not_found';
  end if;
  if v_recipient = v_me then
    raise exception 'self_payment';
  end if;

  v_fee := div(p_amount * p_fee_bps + 9999, 10000);
  if v_fee > 0 then
    select cc.platform_wallet into v_platform from public.chain_config cc where cc.chain_id = v_chain;
    if v_platform is null then
      raise exception 'platform_not_configured';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'tip', v_chain, p_token, p_amount, p_fee_bps, coalesce(v_min_fee, 0), v_fee,
          v_recipient, v_addr, case when v_fee > 0 then v_platform end,
          p_target_type, p_target_id, p_anonymous)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', v_chain, 'token', p_token,
    'amount', p_amount::text, 'feeAmount', v_fee::text,
    'recipientAddress', v_addr, 'platformAddress', case when v_fee > 0 then v_platform end,
    'expiresAt', v_exp);
end;
$$;

create or replace function public.attach_intent_tx(p_intent uuid, p_role text, p_tx_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_hash text := lower(p_tx_hash);
  i public.payment_intents;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_intent is null or p_role is null or p_role not in ('main', 'fee')
     or v_hash is null or v_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'invalid_input';
  end if;
  select * into i from public.payment_intents x where x.id = p_intent and x.member_id = v_me for update;
  if not found then
    raise exception 'not_found';
  end if;
  if i.status <> 'pending' or i.expires_at <= now() then
    raise exception 'intent_expired';
  end if;
  if p_role = 'fee' and i.fee_amount = 0 then
    raise exception 'invalid_input';
  end if;
  if v_hash is not distinct from (case p_role when 'main' then i.fee_tx_hash else i.main_tx_hash end) then
    raise exception 'invalid_input';
  end if;
  if p_role = 'main' then
    if i.main_tx_hash is not null and i.main_tx_hash <> v_hash then
      raise exception 'tx_already_attached';
    end if;
    update public.payment_intents set main_tx_hash = v_hash where id = i.id;
  else
    if i.fee_tx_hash is not null and i.fee_tx_hash <> v_hash then
      raise exception 'tx_already_attached';
    end if;
    update public.payment_intents set fee_tx_hash = v_hash where id = i.id;
  end if;
  -- ruling F3b-R2: remember when the last required hash arrived (proof the payer signed before expiry)
  update public.payment_intents
  set hashes_attached_at = now()
  where id = i.id and hashes_attached_at is null
    and main_tx_hash is not null and (fee_amount = 0 or fee_tx_hash is not null);
end;
$$;

create or replace function public.confirm_tip(p_intent uuid, p_main jsonb, p_fee jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.payment_intents;
  v_tip uuid;
  v_main_hash text;
  v_main_log int;
  v_main_block bigint;
  v_fee_hash text;
  v_fee_log int;
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
  v_main_hash := lower(p_main ->> 'txHash');
  v_main_log := (p_main ->> 'logIndex')::int;
  v_main_block := (p_main ->> 'blockNumber')::bigint;
  if (i.token = 'ETH' and v_main_log <> -1) or (i.token = 'USDC' and v_main_log < 0) then
    raise exception 'invalid_input';
  end if;
  if i.main_tx_hash is null or i.main_tx_hash is distinct from v_main_hash then
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
    v_fee_hash := lower(p_fee ->> 'txHash');
    v_fee_log := (p_fee ->> 'logIndex')::int;
    if (i.token = 'ETH' and v_fee_log <> -1) or (i.token = 'USDC' and v_fee_log < 0) then
      raise exception 'invalid_input';
    end if;
    if i.fee_tx_hash is distinct from v_fee_hash then
      raise exception 'tx_mismatch';
    end if;
  elsif p_fee is not null and jsonb_typeof(p_fee) <> 'null' then
    raise exception 'tx_mismatch';
  end if;

  begin
    insert into public.onchain_transfers (chain_id, tx_hash, log_index, intent_id, role)
    values (i.chain_id, v_main_hash, v_main_log, i.id, 'main');
    if v_fee_hash is not null then
      insert into public.onchain_transfers (chain_id, tx_hash, log_index, intent_id, role)
      values (i.chain_id, v_fee_hash, v_fee_log, i.id, 'fee');
    end if;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;

  insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount,
                           fee_amount, anonymous, main_tx_hash, fee_tx_hash, block_number)
  values (i.id, i.chain_id, i.member_id, i.recipient_member_id, i.target_type,
          (select m.id from public.messages m where m.id = i.target_id and i.target_type = 'message'),
          i.token, i.amount, i.fee_amount, i.anonymous, v_main_hash, v_fee_hash, v_main_block)
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

-- _push_build: tip_received reads threadRootId (camelCase data keys).
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
  elsif n.kind = 'tip_received' then
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

revoke execute on function
  public.create_tip_intent(text, uuid, text, numeric, int, boolean),
  public.attach_intent_tx(uuid, text, text),
  public.confirm_tip(uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.create_tip_intent(text, uuid, text, numeric, int, boolean),
  public.attach_intent_tx(uuid, text, text)
to authenticated;
grant execute on function public.confirm_tip(uuid, jsonb, jsonb) to service_role;
