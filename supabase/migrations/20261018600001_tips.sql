-- F3b Task 1: payment intents, on-chain transfer ledger, tips, system notices and the confirm RPC.
-- Money never moves through the database: intents snapshot amounts and addresses, the server verifies the
-- transfers on-chain and only then calls confirm_tip (service_role). Clients read through definer RPCs.

-- ===== payment_intents =====
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  purpose text not null check (purpose in ('tip', 'bounty', 'donation')),
  chain_id int not null check (chain_id in (59144, 59141)),
  token text not null check (token in ('ETH', 'USDC')),
  amount numeric(78, 0) not null check (amount > 0),
  fee_bps int not null check (fee_bps between 0 and 5000),
  min_fee_bps int not null check (min_fee_bps between 0 and 5000),
  fee_amount numeric(78, 0) not null check (fee_amount >= 0),
  recipient_member_id uuid references public.members (id),
  recipient_address text not null check (recipient_address ~ '^0x[0-9a-f]{40}$'),
  platform_address text check (platform_address is null or platform_address ~ '^0x[0-9a-f]{40}$'),
  target_type text not null check (target_type in ('message', 'profile', 'bounty', 'dao')),
  target_id uuid,
  anonymous boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed', 'expired')),
  fee_tx_hash text check (fee_tx_hash is null or fee_tx_hash ~ '^0x[0-9a-f]{64}$'),
  main_tx_hash text check (main_tx_hash is null or main_tx_hash ~ '^0x[0-9a-f]{64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z_]{1,64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index payment_intents_member_idx on public.payment_intents (member_id, status, expires_at);

-- ===== tips =====
create table public.tips (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null unique references public.payment_intents (id),
  chain_id int not null check (chain_id in (59144, 59141)),
  from_member uuid not null references public.members (id),
  to_member uuid not null references public.members (id),
  target_type text not null check (target_type in ('message', 'profile')),
  message_id uuid references public.messages (id) on delete set null,
  token text not null check (token in ('ETH', 'USDC')),
  amount numeric(78, 0) not null check (amount > 0),
  fee_amount numeric(78, 0) not null check (fee_amount >= 0),
  anonymous boolean not null,
  main_tx_hash text not null check (main_tx_hash ~ '^0x[0-9a-f]{64}$'),
  fee_tx_hash text check (fee_tx_hash is null or fee_tx_hash ~ '^0x[0-9a-f]{64}$'),
  block_number bigint not null,
  created_at timestamptz not null default now()
);
create index tips_message_idx on public.tips (message_id) where message_id is not null;
create index tips_to_member_idx on public.tips (to_member, created_at desc);

-- ===== onchain_transfers: a transfer can credit one intent, ever =====
create table public.onchain_transfers (
  chain_id int not null check (chain_id in (59144, 59141)),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index int not null check (log_index >= -1),
  intent_id uuid not null references public.payment_intents (id),
  role text not null check (role in ('main', 'fee')),
  primary key (chain_id, tx_hash, log_index),
  unique (intent_id, role)
);

alter table public.payment_intents enable row level security;
alter table public.tips enable row level security;
alter table public.onchain_transfers enable row level security;

revoke all on public.payment_intents, public.tips, public.onchain_transfers from anon;
revoke all on public.tips, public.onchain_transfers from authenticated;
revoke insert, update, delete, truncate on public.payment_intents from authenticated;
grant select on public.payment_intents to authenticated;
create policy payment_intents_select on public.payment_intents
  for select to authenticated using (member_id = public.current_member_id());

-- ===== messages: system notices =====
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'alpha', 'system'));
alter table public.messages alter column author_id drop not null;
alter table public.messages add constraint messages_system_author check ((kind = 'system') = (author_id is null));
alter table public.messages add column tip_id uuid references public.tips (id) on delete set null;
create index messages_tip_idx on public.messages (tip_id) where tip_id is not null;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received'
));

-- ===== helpers =====

-- Base units to text with a Spanish decimal comma and no trailing zeros ("12,5", "0,001"). Mirrors the TS formatter.
create function public._format_token_amount(p_amount numeric, p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select div(p_amount, d.unit)::text
         || case when rtrim(lpad(mod(p_amount, d.unit)::text, d.dec, '0'), '0') = '' then ''
                 else ',' || rtrim(lpad(mod(p_amount, d.unit)::text, d.dec, '0'), '0') end
  from (select case p_token when 'ETH' then 18 else 6 end as dec,
               case p_token when 'ETH' then 1000000000000000000::numeric else 1000000::numeric end as unit) d
$$;

-- Same label as the TS mentionLabel: @handle, else @display_name, else @short wallet.
create function public._member_label(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce('@' || a.handle::text,
                  '@' || nullif(btrim(regexp_replace(a.display_name, '[[:cntrl:]]+', ' ', 'g')), ''),
                  '@' || left(a.wallet_address, 6) || '…' || right(a.wallet_address, 4))
  from public.members a where a.id = p_member
$$;

-- ===== create_tip_intent =====
create function public.create_tip_intent(
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
  if p_fee_bps < coalesce(v_min_fee, 0) or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
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

-- ===== attach_intent_tx =====
create function public.attach_intent_tx(p_intent uuid, p_role text, p_tx_hash text)
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
end;
$$;

-- ===== reads =====
create function public.tips_summary(p_message_ids uuid[])
returns table (message_id uuid, token text, total numeric, tip_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select t.message_id, t.token, sum(t.amount), count(*)::int
  from public.tips t
  join public.messages m on m.id = t.message_id and m.deleted_at is null
  where public.is_active_member()
    and t.message_id = any (p_message_ids)
    and m.channel_id in (select v.id from public.visible_channels() v)
  group by t.message_id, t.token
$$;

create function public.message_tips(p_message_id uuid)
returns table (tip_id uuid, donor_id uuid, is_me boolean, token text, amount numeric, chain_id int,
               main_tx_hash text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         case when t.anonymous and t.from_member <> public.current_member_id() then null else t.from_member end,
         t.from_member = public.current_member_id(),
         t.token, t.amount, t.chain_id, t.main_tx_hash, t.created_at
  from public.tips t
  join public.messages m on m.id = t.message_id and m.deleted_at is null
  where public.is_active_member()
    and t.message_id = p_message_id
    and m.channel_id in (select v.id from public.visible_channels() v)
  order by t.created_at desc, t.id
$$;

create function public.member_tips(p_member uuid, p_limit int default 20)
returns table (tip_id uuid, donor_id uuid, is_me boolean, token text, amount numeric, chain_id int,
               main_tx_hash text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         case when t.anonymous and t.from_member <> public.current_member_id() then null else t.from_member end,
         t.from_member = public.current_member_id(),
         t.token, t.amount, t.chain_id, t.main_tx_hash, t.created_at
  from public.tips t
  left join public.messages m on m.id = t.message_id
  where public.is_active_member()
    and t.to_member = p_member
    and (t.target_type = 'profile'
         or (m.id is not null and m.deleted_at is null
             and m.channel_id in (select v.id from public.visible_channels() v)))
  order by t.created_at desc, t.id
  limit greatest(1, least(100, coalesce(p_limit, 20)))
$$;

-- ===== confirm_tip (service_role) =====
create function public.confirm_tip(p_intent uuid, p_main jsonb, p_fee jsonb)
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
begin
  select * into i from public.payment_intents x where x.id = p_intent for update;
  if not found or i.purpose <> 'tip' then
    raise exception 'not_found';
  end if;
  if i.status = 'confirmed' then
    select t.id into v_tip from public.tips t where t.intent_id = i.id;
    return v_tip;
  end if;
  if i.status <> 'pending' or i.expires_at <= now() then
    raise exception 'intent_expired';
  end if;

  if p_main is null or jsonb_typeof(p_main) <> 'object'
     or (p_main ->> 'txHash') !~ '^0x[0-9a-fA-F]{64}$'
     or (p_main ->> 'logIndex') !~ '^-?[0-9]{1,9}$'
     or (p_main ->> 'blockNumber') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid_input';
  end if;
  v_main_hash := lower(p_main ->> 'txHash');
  v_main_log := (p_main ->> 'logIndex')::int;
  v_main_block := (p_main ->> 'blockNumber')::bigint;
  if (i.token = 'ETH' and v_main_log <> -1) or (i.token = 'USDC' and v_main_log < 0) then
    raise exception 'invalid_input';
  end if;
  if i.main_tx_hash is distinct from v_main_hash then
    raise exception 'tx_mismatch';
  end if;

  if i.fee_amount > 0 then
    if p_fee is null or jsonb_typeof(p_fee) <> 'object' then
      raise exception 'tx_mismatch';
    end if;
    if (p_fee ->> 'txHash') !~ '^0x[0-9a-fA-F]{64}$' or (p_fee ->> 'logIndex') !~ '^-?[0-9]{1,9}$' then
      raise exception 'invalid_input';
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
          case when i.target_type = 'message' then i.target_id end,
          i.token, i.amount, i.fee_amount, i.anonymous, v_main_hash, v_fee_hash, v_main_block)
  returning id into v_tip;

  update public.payment_intents set status = 'confirmed' where id = i.id;

  if i.target_type = 'message' then
    select * into v_msg from public.messages x where x.id = i.target_id;
    if found then
      v_root := coalesce(v_msg.thread_root_id, v_msg.id);
      -- serialize with normal replies on the same root
      perform 1 from public.messages r where r.id = v_root for update;
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
         case when v_notice is not null then v_msg.channel_id end,
         v_notice,
         jsonb_strip_nulls(jsonb_build_object('tipId', v_tip, 'messageId', case when v_notice is not null then v_msg.id end,
                                              'thread_root_id', v_root))
  from public.members r
  where r.id = i.recipient_member_id and r.status = 'active';

  return v_tip;
end;
$$;

create function public.fail_intent(p_intent uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_code is null or p_code !~ '^[a-z_]{1,64}$' then
    raise exception 'invalid_input';
  end if;
  update public.payment_intents set status = 'failed', failure_code = p_code
  where id = p_intent and status = 'pending';
end;
$$;

-- ===== system messages must tolerate the null author =====

-- Never fan out notifications for system messages.
create or replace function public._notify_message(p_message uuid, p_only_mentions boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  v_default text;
  v_data jsonb;
begin
  select * into m from public.messages x where x.id = p_message;
  if not found or m.deleted_at is not null or m.kind = 'system' then
    return;
  end if;
  select c.default_follow into v_default from public.channels c where c.id = m.channel_id;
  v_data := case when m.thread_root_id is null then '{}'::jsonb
                 else jsonb_build_object('thread_root_id', m.thread_root_id) end;

  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  select r.recipient, r.kind, m.author_id, m.channel_id, m.id,
         case when r.kind = 'channel_message' then '{}'::jsonb else v_data end
  from (
    select distinct on (cand.recipient) cand.recipient, cand.kind
    from (
      select mm.target_id as recipient, 'mention'::text as kind, 1 as prio
      from public.message_mentions mm
      where mm.message_id = m.id and mm.kind = 'member' and mm.notify

      union all
      select mr.member_id, 'mention', 1
      from public.message_mentions mm
      join public.member_roles mr on mr.role_id = mm.target_id
      where mm.message_id = m.id and mm.kind = 'role' and mm.notify
        and not exists (
          select 1 from public.channel_follow_prefs f
          where f.member_id = mr.member_id and f.channel_id = m.channel_id and f.level = 'mute')

      union all
      select mb.id, 'mention', 1
      from public.message_mentions mm
      join public.members mb on mb.status = 'active'
      where mm.message_id = m.id and mm.kind = 'everyone' and mm.notify
        and not exists (
          select 1 from public.channel_follow_prefs f
          where f.member_id = mb.id and f.channel_id = m.channel_id and f.level = 'mute')

      union all
      select a.author_id, 'reply', 2
      from (
        select r0.author_id from public.messages r0
        where not p_only_mentions and m.thread_root_id is not null and r0.id = m.thread_root_id
        union
        select r1.author_id from public.messages r1
        where not p_only_mentions and m.thread_root_id is not null and r1.thread_root_id = m.thread_root_id
          and r1.id <> m.id and r1.deleted_at is null
      ) a

      union all
      select q.author_id, 'reply', 2
      from public.messages q
      where not p_only_mentions and m.quoted_message_id is not null and q.id = m.quoted_message_id

      union all
      select mb.id, 'channel_message', 3
      from public.members mb
      left join public.channel_follow_prefs f on f.member_id = mb.id and f.channel_id = m.channel_id
      where not p_only_mentions and m.thread_root_id is null and mb.status = 'active'
        and coalesce(f.level, v_default) = 'all'
    ) cand
    where cand.recipient is not null and cand.recipient <> m.author_id
    order by cand.recipient, cand.prio
  ) r
  join public.members rm on rm.id = r.recipient and rm.status = 'active'
  where case
          when p_only_mentions and exists (
            select 1 from public.notifications n where n.recipient_id = r.recipient and n.message_id = m.id) then false
          else (public.channel_permissions(r.recipient, m.channel_id) & 1) = 1
        end
  on conflict (recipient_id, message_id) where message_id is not null do nothing;
end;
$$;

-- edit_message: identical to 20261017300002 except the author test is null-safe and system notices are refused.
create or replace function public.edit_message(p_id uuid, p_body jsonb, p_body_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_perms bigint;
  v_text text;
begin
  select * into v_msg from public.messages m where m.id = p_id for update;
  if v_actor is null or not found or v_msg.kind = 'system' or v_msg.author_id is distinct from v_actor
     or v_msg.deleted_at is not null then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  if (v_perms & 1) = 0 or (v_perms & case when v_msg.thread_root_id is null then 2 else 4 end) = 0 then
    raise exception 'forbidden';
  end if;

  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'invalid_input';
  end if;
  if p_body ->> 'type' is distinct from 'doc' then
    raise exception 'invalid_input';
  end if;
  if octet_length(p_body::text) > 65536 then
    raise exception 'too_long';
  end if;
  v_text := public._doc_text(p_body);
  if char_length(v_text) > 20000 or (not v_msg.expanded and char_length(v_text) > 4000) then
    raise exception 'too_long';
  end if;
  if v_text = '' and not exists (
    select 1 from public.message_attachments a where a.message_id = p_id) then
    raise exception 'invalid_input';
  end if;

  update public.messages
  set body = p_body, body_text = v_text, allow_links = (v_perms & 2048) = 2048, edited_at = now()
  where id = p_id;

  delete from public.message_mentions where message_id = p_id;
  perform public._insert_mentions(p_id, p_body, v_perms);

  perform public._notify_message(p_id, true);
end;
$$;

-- report_message: identical to 20261017300004 plus system notices are not reportable.
create or replace function public.report_message(p_message uuid, p_reason text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  m public.messages;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() or p_message is null then
    raise exception 'forbidden';
  end if;
  select * into m from public.messages x where x.id = p_message;
  if not found or m.deleted_at is not null or m.kind = 'system' or m.author_id is null or m.author_id = v_me
     or not public.can_view(m.channel_id) then
    raise exception 'forbidden';
  end if;
  if p_reason is null or p_reason not in ('scam', 'spam', 'abuse', 'other')
     or (p_note is not null and char_length(p_note) > 500) then
    raise exception 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || v_me::text, 0));

  if exists (
    select 1 from public.reports r where r.message_id = m.id and r.reporter_id = v_me and r.status = 'open'
  ) then
    raise exception 'already_reported';
  end if;
  if (
    select count(*) from public.reports r where r.reporter_id = v_me and r.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'rate_limited';
  end if;

  insert into public.reports (message_id, channel_id, reporter_id, reason, note, snapshot_author_id, snapshot_text)
  values (m.id, m.channel_id, v_me, p_reason, nullif(btrim(p_note), ''), m.author_id, left(m.body_text, 1000))
  returning id into v_id;

  insert into public.notifications (recipient_id, kind, actor_id, channel_id, data)
  select s.id, 'report_new', v_me, m.channel_id, jsonb_build_object('report_id', v_id)
  from public.members s
  where s.status = 'active'
    and s.id <> v_me
    and (public.channel_permissions(s.id, m.channel_id) & 8) = 8;

  return v_id;
end;
$$;

-- search_messages: system notices are not searchable.
create or replace function public.search_messages(p_q text, p_limit int default 20, p_channel uuid default null)
returns table (
  id uuid, channel_id uuid, thread_root_id uuid, author_id uuid,
  created_at timestamptz, snippet text, rank real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q tsquery := public._search_tsquery(p_q);
  v_limit int := greatest(1, least(50, coalesce(p_limit, 20)));
begin
  if v_q is null then
    return;
  end if;
  return query
    select m.id, m.channel_id, m.thread_root_id, m.author_id, m.created_at,
           left(m.body_text, 160), ts_rank(m.search_tsv, v_q)
    from public.messages m
    where m.search_tsv @@ v_q
      and m.deleted_at is null
      and m.kind <> 'system'
      and m.body_text <> ''
      and (p_channel is null or m.channel_id = p_channel)
    order by ts_rank(m.search_tsv, v_q) desc, m.created_at desc
    limit v_limit;
end;
$$;

-- _push_build: same body as 20261018500003 plus the tip_received case.
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
      v_root := n.data ->> 'thread_root_id';
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

-- ===== grants =====
revoke execute on function
  public._format_token_amount(numeric, text),
  public._member_label(uuid),
  public.create_tip_intent(text, uuid, text, numeric, int, boolean),
  public.attach_intent_tx(uuid, text, text),
  public.tips_summary(uuid[]),
  public.message_tips(uuid),
  public.member_tips(uuid, int),
  public.confirm_tip(uuid, jsonb, jsonb),
  public.fail_intent(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_tip_intent(text, uuid, text, numeric, int, boolean),
  public.attach_intent_tx(uuid, text, text),
  public.tips_summary(uuid[]),
  public.message_tips(uuid),
  public.member_tips(uuid, int)
to authenticated;

grant execute on function
  public.confirm_tip(uuid, jsonb, jsonb),
  public.fail_intent(uuid, text)
to service_role;
