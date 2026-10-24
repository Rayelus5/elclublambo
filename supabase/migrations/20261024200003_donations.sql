-- P1 Task 3: donations to the club Safe, the Mecenas role, donor visibility and reads (P1-R1, P1-R2, P1-R3).
--   - public.donations replaces the legacy dao_ledger as the record of a donation. It keeps donor_address and allows a
--     null member_id so P2 (public donors) needs no migration.
--   - create_donation_intent(chain, token, amount, anonymous): USDC or ETH on any enabled network, to chains.safe_address,
--     no fee. The legacy (numeric, int, boolean) overload stays untouched.
--   - confirm_donation (service_role): records the verified transfer, stores the USD value computed by the server and
--     grants Mecenas once the member's total reaches app_config.donor_role_min_usd6. The role is never removed here.
--   - members.donor_visible lets a donor leave the list; reads never reveal an anonymous or hidden donor to others.
--   - club_activity reads donations (no _active_chain()).
-- Each function starts from its latest definition (cited above it).

-- ===== table =====
create table public.donations (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null unique references public.payment_intents (id),
  chain_id int not null references public.chains (chain_id),
  token text not null check (token in ('USDC', 'ETH')),
  amount numeric(78, 0) not null check (amount > 0),
  usd6 numeric(78, 0) not null check (usd6 >= 0),
  eth_price_e8 numeric(78, 0),
  price_source text not null check (price_source in ('usdc', 'chainlink')),
  member_id uuid references public.members (id),
  donor_address text not null check (donor_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash text not null,
  log_index int not null,
  block_number bigint not null,
  anonymous boolean not null default false,
  verified_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);
create index donations_member_idx on public.donations (member_id);
create index donations_verified_idx on public.donations (verified_at desc);

alter table public.donations enable row level security;
revoke all on public.donations from anon, authenticated;

-- ===== visibility, threshold, Mecenas =====
alter table public.members add column donor_visible boolean not null default true;

insert into public.app_config (key, value) values ('donor_role_min_usd6', '1000000'::jsonb);

insert into public.roles (name, color, position, permissions, is_everyone, is_system, system_key) values
  ('Mecenas', '#C6F36B', 15, 0, false, false, 'donor')
on conflict (name) do nothing;

-- ===== create_donation_intent: new 4-arg overload; the legacy (numeric, int, boolean) one stays frozen (spec D10) =====
create function public.create_donation_intent(p_chain_id int, p_token text, p_amount numeric, p_anonymous boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_safe text;
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
  if p_chain_id is null
     or p_token is null or p_token not in ('ETH', 'USDC')
     or p_amount is null or p_amount <> trunc(p_amount)
     or p_anonymous is null then
    raise exception 'invalid_input';
  end if;
  if not private.chain_enabled(p_chain_id) then
    raise exception 'chain_invalid';
  end if;

  -- for share: a concurrent Safe change waits for this intent, then sees it
  select c.safe_address into v_safe from public.chains c where c.chain_id = p_chain_id for share;
  if v_safe is null then
    raise exception 'safe_not_configured';
  end if;

  -- same ranges as create_tip_intent
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

  -- same lock key and cap as tip intents
  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'donation', p_chain_id, p_token, p_amount, 0, 0, 0,
          null, v_safe, null,
          'dao', null, p_anonymous)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', p_chain_id, 'token', p_token,
    'amount', p_amount::text, 'feeAmount', '0',
    'recipientAddress', v_safe, 'platformAddress', null,
    'expiresAt', v_exp);
end;
$$;

-- ===== confirm_donation (service_role) =====
-- p_usd6: USD value in 6 decimals computed by the server (USDC: the amount itself; ETH: amount x Chainlink price).
-- p_eth_price_e8: the Chainlink answer used (8 decimals); required for ETH, null for USDC.
create function public.confirm_donation(p_intent uuid, p_main jsonb, p_usd6 numeric, p_eth_price_e8 numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.payment_intents;
  v_h record;
  v_addr text;
  v_id uuid;
  v_min numeric;
  v_total numeric;
  v_role uuid;
  v_granted int;
begin
  select * into i from public.payment_intents x where x.id = p_intent for update;
  if not found or i.purpose <> 'donation' or i.target_type <> 'dao' then
    raise exception 'not_found';
  end if;
  if i.status = 'confirmed' then
    select d.id into v_id from public.donations d where d.intent_id = i.id;
    return jsonb_build_object('status', 'already', 'donationId', v_id);
  end if;

  if p_usd6 is null or p_usd6 < 0 or p_usd6 <> trunc(p_usd6)
     or (i.token = 'USDC' and (p_eth_price_e8 is not null or p_usd6 <> i.amount))
     or (i.token = 'ETH' and (p_eth_price_e8 is null or p_eth_price_e8 <= 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;

  select * into v_h from public._record_payment_transfers(i, p_main, null);

  select m.wallet_address into v_addr from public.members m where m.id = i.member_id;
  if v_addr is null then
    raise exception 'not_found';
  end if;

  insert into public.donations (intent_id, chain_id, token, amount, usd6, eth_price_e8, price_source, member_id,
                                donor_address, tx_hash, log_index, block_number, anonymous)
  values (i.id, i.chain_id, i.token, i.amount, p_usd6, p_eth_price_e8,
          case i.token when 'ETH' then 'chainlink' else 'usdc' end, i.member_id,
          lower(v_addr), v_h.main_hash, (p_main ->> 'logIndex')::int, v_h.block, i.anonymous)
  returning id into v_id;

  update public.payment_intents set status = 'confirmed' where id = i.id;

  -- Mecenas: the member's verified total reaches the threshold (granted once, never removed here)
  select (c.value #>> '{}')::numeric into v_min from public.app_config c where c.key = 'donor_role_min_usd6';
  select coalesce(sum(d.usd6), 0) into v_total from public.donations d where d.member_id = i.member_id;
  if v_min is not null and v_total >= v_min then
    select r.id into v_role from public.roles r where r.system_key = 'donor';
    if v_role is not null then
      insert into public.member_roles (member_id, role_id) values (i.member_id, v_role) on conflict do nothing;
      get diagnostics v_granted = row_count;
      if v_granted > 0 then
        insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
        values (null, 'donor_role_granted', 'member', i.member_id,
                jsonb_build_object('totalUsd6', v_total::text, 'donationId', v_id));
      end if;
    end if;
  end if;

  return jsonb_build_object('status', 'confirmed', 'donationId', v_id);
end;
$$;

-- ===== set_donor_visible =====
create function public.set_donor_visible(p_visible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- same bucket as update_profile and set_receive_networks
  perform private.rate_limit(v_me::text, 'profile', 30, interval '1 hour');
  if p_visible is null then
    raise exception 'invalid_input';
  end if;
  update public.members set donor_visible = p_visible where id = v_me;
end;
$$;

-- ===== donation_overview =====
create function public.donation_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'totalUsd6', (select coalesce(sum(d.usd6), 0)::text from public.donations d),
    'donorCount', (select count(distinct d.donor_address) from public.donations d),
    'byChain', coalesce((select jsonb_agg(jsonb_build_object('chainId', t.chain_id, 'usd6', t.usd6::text) order by t.chain_id)
                         from (select d.chain_id, sum(d.usd6) as usd6 from public.donations d group by d.chain_id) t),
                        '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', r.id, 'at', r.verified_at, 'chainId', r.chain_id, 'token', r.token,
                          'amount', r.amount::text, 'usd6', r.usd6::text,
                          'donorLabel', case
                            when r.member_id is not null and r.member_id = v_me then public._member_label(r.member_id)
                            when r.member_id is null or r.anonymous or not r.visible then null
                            else public._member_label(r.member_id) end)
                        order by r.verified_at desc, r.id)
                        from (select d.id, d.verified_at, d.chain_id, d.token, d.amount, d.usd6, d.member_id,
                                     d.anonymous, coalesce(m.donor_visible, false) as visible
                              from public.donations d left join public.members m on m.id = d.member_id
                              order by d.verified_at desc, d.id
                              limit 20) r),
                        '[]'::jsonb));
end;
$$;

-- ===== donor_ranking =====
-- Others' totals count only their non-anonymous donations, so an anonymous gift never surfaces through a visible name.
-- The caller's own row always shows, with everything they gave.
create function public.donor_ranking(p_limit int default 50)
returns table (member_id uuid, label text, total_usd6 text, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_lim int := greatest(1, least(100, coalesce(p_limit, 50)));
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return query
  with totals as (
    select d.member_id as mid,
           sum(d.usd6) filter (where not d.anonymous or d.member_id = v_me) as total
    from public.donations d
    where d.member_id is not null
    group by d.member_id
  ),
  ranked as (
    select t.mid, t.total, (t.mid = v_me) as me,
           row_number() over (order by t.total desc, t.mid) as rn
    from totals t
    join public.members m on m.id = t.mid
    where t.total > 0 and (m.donor_visible or t.mid = v_me)
  )
  select r.mid, public._member_label(r.mid), r.total::text, r.me
  from ranked r
  where r.rn <= v_lim or r.me
  order by r.total desc, r.mid;
end;
$$;

-- ===== my_donor_status =====
create function public.my_donor_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'totalUsd6', (select coalesce(sum(d.usd6), 0)::text from public.donations d where d.member_id = v_me),
    'isMecenas', exists (select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id
                         where mr.member_id = v_me and r.system_key = 'donor'),
    'visible', (select m.donor_visible from public.members m where m.id = v_me));
end;
$$;

-- ===== club_activity (latest 20261024100002_multired_payments.sql): the donation branch reads donations =====
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
  dons as (
    select d.verified_at, d.member_id, d.anonymous, d.token, d.amount
    from public.donations d
    order by d.verified_at desc, d.id
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
    select 'donation', d.verified_at, d.member_id, d.anonymous, null, d.token, d.amount, null, null from dons d
    union all
    select 'bounty', b.created_at, b.author_id, false, null, b.token, b.amount, b.channel_id, b.message_id from new_bounties b
    order by 2 desc
    limit (select n from lim)
  )
  select x.kind, x.at,
         case
           when x.kind = 'tip' and x.anonymous and x.actor <> (select id from me) then 'Anónimo'
           when x.kind = 'donation' and x.actor is distinct from (select id from me)
                and (x.actor is null or x.anonymous
                     or not (select a.donor_visible from public.members a where a.id = x.actor)) then 'Anónimo'
           else public._member_label(x.actor)
         end,
         case when x.target is null then null else public._member_label(x.target) end,
         x.token, x.amount::text, x.channel_id, x.message_id,
         case when x.target is null then null else (select w.wallet_address::text from public.members w where w.id = x.target) end
  from merged x
  where public.is_active_member()
  order by x.at desc
$$;

-- ===== grants =====
revoke execute on function
  public.create_donation_intent(int, text, numeric, boolean),
  public.confirm_donation(uuid, jsonb, numeric, numeric),
  public.set_donor_visible(boolean),
  public.donation_overview(),
  public.donor_ranking(int),
  public.my_donor_status(),
  public.club_activity(int)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_donation_intent(int, text, numeric, boolean),
  public.set_donor_visible(boolean),
  public.donation_overview(),
  public.donor_ranking(int),
  public.my_donor_status(),
  public.club_activity(int)
to authenticated;

grant execute on function public.confirm_donation(uuid, jsonb, numeric, numeric) to service_role;
