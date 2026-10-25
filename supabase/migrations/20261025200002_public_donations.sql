-- P3 Task 6: donations from people outside the club (P3-R7, P3-R8, P3-R9).
--   - public_donation_intents: a public account (SIWE session, not a banned member) donates to the club Safe. The donor
--     address is always the session wallet. An active member is sent to the club donation (use_club_donation).
--   - A confirmed public donation lands in donations with member_id null and public_intent_id; every donation now has
--     exactly one of intent_id (club, payment_intents) / public_intent_id. listed = «appear in the club's donor list».
--   - Anti-reuse: onchain_transfers.intent_id is NOT NULL and references payment_intents, so a public donation cannot be
--     recorded there. confirm_public_donation instead refuses a (chain, tx, log) already present in onchain_transfers
--     or donations; donations' unique (chain_id, tx_hash, log_index) closes the race with a concurrent confirm (club or
--     public), since confirm_donation writes both tables in one transaction.
--   - Entering the club (any members insert: redeem_invite, bootstrap) claims the wallet's public donations and grants
--     Mecenas once their total reaches donor_role_min_usd6 (trigger _claim_public_donations). A member who is later
--     banned keeps them.
--   - donor_ranking (latest 20261024200003_donations.sql), same signature: adds listed, non-anonymous external donors as
--     «Donante externo · 0x1234…abcd» with member_id null. Member rows are unchanged.
--   - public_donation_overview (service role): only the club total and the number of donations, for the public page.

-- ===== tables =====
create table public.public_donation_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  donor_address text not null check (donor_address ~ '^0x[0-9a-f]{40}$'),
  chain_id int not null references public.chains (chain_id),
  token text not null check (token in ('USDC', 'ETH')),
  amount numeric(78, 0) not null check (amount > 0),
  recipient_address text not null,
  anonymous boolean not null default false,
  listed boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  main_tx_hash text check (main_tx_hash is null or main_tx_hash ~ '^0x[0-9a-f]{64}$'),
  fail_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index public_donation_intents_user_idx on public.public_donation_intents (user_id, status);

alter table public.public_donation_intents enable row level security;
revoke all on public.public_donation_intents from public, anon, authenticated;

alter table public.donations alter column intent_id drop not null;
alter table public.donations add column public_intent_id uuid unique references public.public_donation_intents (id);
alter table public.donations add constraint donations_one_intent check (num_nonnulls(intent_id, public_intent_id) = 1);
alter table public.donations add column listed boolean not null default false;
create index donations_donor_unclaimed_idx on public.donations (donor_address) where member_id is null;

-- ===== create_public_donation_intent =====
-- Same ranges, Safe lookup (for share) and 20-pending cap as create_donation_intent; returns the same shape.
create function public.create_public_donation_intent(p_chain_id int, p_token text, p_amount numeric,
                                                     p_anonymous boolean, p_listed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wallet text := public.auth_wallet_address();
  v_safe text;
  v_id uuid;
  v_exp timestamptz;
  v_min numeric;
  v_max numeric;
begin
  if v_uid is null or v_wallet is null or not public.is_public_account() then
    raise exception 'forbidden';
  end if;
  if public.is_active_member() then
    raise exception 'use_club_donation';
  end if;
  perform private.rate_limit('u:' || v_uid::text, 'payment_intent', 30, interval '10 minutes');
  if p_chain_id is null
     or p_token is null or p_token not in ('ETH', 'USDC')
     or p_amount is null or p_amount <> trunc(p_amount)
     or p_anonymous is null or p_listed is null then
    raise exception 'invalid_input';
  end if;
  if not private.chain_enabled(p_chain_id) then
    raise exception 'chain_invalid';
  end if;

  select c.safe_address into v_safe from public.chains c where c.chain_id = p_chain_id for share;
  if v_safe is null then
    raise exception 'safe_not_configured';
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

  perform pg_advisory_xact_lock(hashtextextended('public_donation_intent:' || v_uid::text, 0));
  if (select count(*) from public.public_donation_intents i
      where i.user_id = v_uid and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.public_donation_intents (user_id, donor_address, chain_id, token, amount, recipient_address,
                                              anonymous, listed)
  values (v_uid, v_wallet, p_chain_id, p_token, p_amount, v_safe, p_anonymous, p_listed)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', p_chain_id, 'token', p_token,
    'amount', p_amount::text, 'feeAmount', '0',
    'recipientAddress', v_safe, 'platformAddress', null,
    'expiresAt', v_exp);
end;
$$;

-- ===== attach_public_donation_tx (owner, pending, not expired) =====
create function public.attach_public_donation_tx(p_intent uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := lower(p_hash);
  i public.public_donation_intents;
begin
  if auth.uid() is null or not public.is_public_account() then
    raise exception 'forbidden';
  end if;
  if p_intent is null or v_hash is null or v_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'invalid_input';
  end if;
  select * into i from public.public_donation_intents x where x.id = p_intent and x.user_id = auth.uid() for update;
  if not found then
    raise exception 'not_found';
  end if;
  if i.status <> 'pending' or i.expires_at <= now() then
    raise exception 'intent_expired';
  end if;
  if i.main_tx_hash is not null and i.main_tx_hash <> v_hash then
    raise exception 'tx_already_attached';
  end if;
  update public.public_donation_intents set main_tx_hash = v_hash where id = i.id;
end;
$$;

-- ===== confirm_public_donation (service_role) =====
-- Same usd6 rules as confirm_donation. Expiry as ruling F3b-R2: the hash can only be attached before expiry, so an
-- expired intent with a hash still confirms within 7 days of creation.
create function public.confirm_public_donation(p_intent uuid, p_main jsonb, p_usd6 numeric, p_eth_price_e8 numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.public_donation_intents;
  v_hash text;
  v_log int;
  v_block bigint;
  v_id uuid;
begin
  select * into i from public.public_donation_intents x where x.id = p_intent for update;
  if not found then
    raise exception 'not_found';
  end if;
  if i.status = 'confirmed' then
    select d.id into v_id from public.donations d where d.public_intent_id = i.id;
    return jsonb_build_object('status', 'already', 'donationId', v_id);
  end if;
  if i.status <> 'pending'
     or (i.expires_at <= now() and not (i.main_tx_hash is not null and now() <= i.created_at + interval '7 days')) then
    raise exception 'intent_expired';
  end if;

  if p_usd6 is null or p_usd6 < 0 or p_usd6 <> trunc(p_usd6)
     or (i.token = 'USDC' and (p_eth_price_e8 is not null or p_usd6 <> i.amount))
     or (i.token = 'ETH' and (p_eth_price_e8 is null or p_eth_price_e8 <= 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;
  if p_main is null or jsonb_typeof(p_main) <> 'object'
     or coalesce(p_main ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(p_main ->> 'logIndex', '') !~ '^-?[0-9]{1,9}$'
     or coalesce(p_main ->> 'blockNumber', '') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid_input';
  end if;
  v_hash := lower(p_main ->> 'txHash');
  v_log := (p_main ->> 'logIndex')::int;
  v_block := (p_main ->> 'blockNumber')::bigint;
  if (i.token = 'ETH' and v_log <> -1) or (i.token = 'USDC' and v_log < 0) then
    raise exception 'invalid_input';
  end if;
  if i.main_tx_hash is null or i.main_tx_hash is distinct from v_hash then
    raise exception 'tx_mismatch';
  end if;

  if exists (select 1 from public.onchain_transfers t
             where t.chain_id = i.chain_id and t.tx_hash = v_hash and t.log_index = v_log)
     or exists (select 1 from public.donations d
                where d.chain_id = i.chain_id and d.tx_hash = v_hash and d.log_index = v_log) then
    raise exception 'tx_already_used';
  end if;

  begin
    insert into public.donations (public_intent_id, chain_id, token, amount, usd6, eth_price_e8, price_source, member_id,
                                  donor_address, tx_hash, log_index, block_number, anonymous, listed)
    values (i.id, i.chain_id, i.token, i.amount, p_usd6, p_eth_price_e8,
            case i.token when 'ETH' then 'chainlink' else 'usdc' end, null,
            i.donor_address, v_hash, v_log, v_block, i.anonymous, i.listed)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;

  update public.public_donation_intents set status = 'confirmed' where id = i.id;
  return jsonb_build_object('status', 'confirmed', 'donationId', v_id);
end;
$$;

-- ===== fail_public_donation (service_role) =====
create function public.fail_public_donation(p_intent uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or p_reason !~ '^[a-z_]{1,64}$' then
    raise exception 'invalid_input';
  end if;
  update public.public_donation_intents set status = 'failed', fail_reason = p_reason
  where id = p_intent and status = 'pending';
end;
$$;

-- ===== my_public_donations (authenticated) =====
-- The caller's confirmed public donations (also those already claimed by their membership), newest first.
create function public.my_public_donations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_public_account() then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'totalUsd6', (select coalesce(sum(d.usd6), 0)::text
                  from public.donations d join public.public_donation_intents i on i.id = d.public_intent_id
                  where i.user_id = auth.uid()),
    'donations', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', r.id, 'at', r.verified_at, 'chainId', r.chain_id, 'token', r.token,
                             'amount', r.amount::text, 'usd6', r.usd6::text, 'txHash', r.tx_hash,
                             'anonymous', r.anonymous, 'listed', r.listed)
                           order by r.verified_at desc, r.id)
                           from (select d.* from public.donations d
                                 join public.public_donation_intents i on i.id = d.public_intent_id
                                 where i.user_id = auth.uid()
                                 order by d.verified_at desc, d.id
                                 limit 100) r),
                          '[]'::jsonb));
end;
$$;

-- ===== public_donation_overview (service_role) =====
-- For the public donate page: no names, no addresses.
create function public.public_donation_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'totalUsd6', coalesce(sum(d.usd6), 0)::text,
    'donationCount', count(*)::int)
  from public.donations d
$$;

-- ===== members insert: claim the wallet's public donations and grant Mecenas (P3-R9) =====
create function public._claim_public_donations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed int;
  v_min numeric;
  v_total numeric;
  v_role uuid;
  v_granted int;
begin
  update public.donations set member_id = new.id
  where member_id is null and donor_address = lower(new.wallet_address);
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return null;
  end if;

  select (c.value #>> '{}')::numeric into v_min from public.app_config c where c.key = 'donor_role_min_usd6';
  -- same per-member lock as confirm_donation
  perform pg_advisory_xact_lock(hashtextextended('donor:' || new.id::text, 0));
  select coalesce(sum(d.usd6), 0) into v_total from public.donations d where d.member_id = new.id;
  if v_min is not null and v_total >= v_min then
    select r.id into v_role from public.roles r where r.system_key = 'donor';
    if v_role is not null then
      insert into public.member_roles (member_id, role_id) values (new.id, v_role) on conflict do nothing;
      get diagnostics v_granted = row_count;
      if v_granted > 0 then
        insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
        values (null, 'donor_role_granted', 'member', new.id,
                jsonb_build_object('totalUsd6', v_total::text, 'claimedDonations', v_claimed));
      end if;
    end if;
  end if;
  return null;
end;
$$;

create trigger members_claim_public_donations
after insert on public.members
for each row execute function public._claim_public_donations();

-- ===== donor_ranking (latest 20261024200003_donations.sql) =====
-- Member rows as before. External donors (member_id null) appear only with their listed, non-anonymous donations,
-- grouped by address; is_me is always false for them (the caller is an active member, so their own wallet's donations
-- were claimed on entry).
create or replace function public.donor_ranking(p_limit int default 50)
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
  members_ranked as (
    select t.mid, null::text as addr, t.total, (t.mid = v_me) as me
    from totals t
    join public.members m on m.id = t.mid
    where t.total > 0 and (m.donor_visible or t.mid = v_me)
  ),
  externals as (
    select null::uuid as mid, d.donor_address as addr, sum(d.usd6) as total, false as me
    from public.donations d
    where d.member_id is null and d.listed and not d.anonymous
    group by d.donor_address
    having sum(d.usd6) > 0
  ),
  ranked as (
    select u.mid, u.addr, u.total, u.me,
           row_number() over (order by u.total desc, u.mid nulls last, u.addr) as rn
    from (select * from members_ranked union all select * from externals) u
  )
  select r.mid,
         coalesce(public._member_label(r.mid), 'Donante externo · ' || left(r.addr, 6) || '…' || right(r.addr, 4)),
         r.total::text, r.me
  from ranked r
  where r.rn <= v_lim or r.me
  order by r.rn;
end;
$$;

-- ===== grants =====
revoke execute on function
  public.create_public_donation_intent(int, text, numeric, boolean, boolean),
  public.attach_public_donation_tx(uuid, text),
  public.confirm_public_donation(uuid, jsonb, numeric, numeric),
  public.fail_public_donation(uuid, text),
  public.my_public_donations(),
  public.public_donation_overview(),
  public._claim_public_donations(),
  public.donor_ranking(int)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_public_donation_intent(int, text, numeric, boolean, boolean),
  public.attach_public_donation_tx(uuid, text),
  public.my_public_donations(),
  public.donor_ranking(int)
to authenticated;

grant execute on function
  public.confirm_public_donation(uuid, jsonb, numeric, numeric),
  public.fail_public_donation(uuid, text),
  public.public_donation_overview()
to service_role;
