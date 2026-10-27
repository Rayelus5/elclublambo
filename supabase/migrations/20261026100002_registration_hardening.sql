-- Administración Task 7 fix: closed registration (A-R13) also holds on the service-role paths.
--
-- The service-role RPCs act for a user passed as an argument (auth.uid() is null there), so is_public_account() /
-- my_registration_blocked() never ran on them and an account held while registration was closed could still enter
-- public giveaways. private.registration_blocked_for(uuid) is the one rule (closed ∧ hold ∧ no members row), shared by
-- my_registration_blocked() (for auth.uid()) and by the RPCs that act for a public user:
--   - enter_public_giveaway (p_user)                 'forbidden'
--   - record_public_giveaway_payout (p_actor)        'forbidden'
--   - mark_public_prize_delivered (auth.uid())       'forbidden'
-- (A host can only be held in theory: create_public_giveaway already needs is_public_account(). The check is defence in
-- depth.) The other public writes (create_public_giveaway, upsert_public_profile, create_public_donation_intent,
-- attach_public_donation_tx, ...) run on the user's JWT and already check is_public_account(). record_vouch records an
-- on-chain fact for no user id; the server action gates it on getPublicSession(), which now refuses a held session.
-- is_public_account() also needs the auth user to still exist (a leftover JWT of a deleted held account).

-- ===== the shared rule =====
create function private.registration_blocked_for(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null
    and coalesce((select (c.value->>'registration')::boolean from public.app_config c where c.key = 'site_switches'), true)
        = false
    and exists (select 1 from public.registration_holds h where h.auth_user_id = p_user)
    and not exists (select 1 from public.members m where m.auth_user_id = p_user)
$$;
revoke execute on function private.registration_blocked_for(uuid) from public, anon, authenticated, service_role;

-- create or replace keeps the existing grants (authenticated).
create or replace function public.my_registration_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.registration_blocked_for(auth.uid())
$$;

create or replace function public.is_public_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (select 1 from auth.users u where u.id = auth.uid())
    and public.auth_wallet_address() is not null
    and not exists (
      select 1 from public.members m
      where m.auth_user_id = auth.uid() and m.status = 'banned'
    )
    and not private.registration_blocked_for(auth.uid())
$$;

-- ===== enter_public_giveaway: 20261025100002_public_giveaways.sql plus the hold =====
create or replace function public.enter_public_giveaway(p_id uuid, p_user uuid, p_wallet text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet text := lower(btrim(coalesce(p_wallet, '')));
  v_rows int;
  g public.public_giveaways;
begin
  if p_id is null or p_user is null or v_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid_input';
  end if;
  if exists (select 1 from public.members m where m.auth_user_id = p_user and m.status = 'banned')
     or private.registration_blocked_for(p_user)
     or not exists (select 1 from auth.identities i
                    where i.user_id = p_user and i.provider = 'web3'
                      and lower(i.identity_data -> 'custom_claims' ->> 'address') = v_wallet) then
    raise exception 'forbidden';
  end if;
  perform private.rate_limit('u:' || p_user::text, 'public_giveaway_entry', 30, interval '10 minutes');

  select * into g from public.public_giveaways x where x.id = p_id for no key update;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status <> 'open' or now() >= g.closes_at then
    raise exception 'giveaway_closed';
  end if;
  if exists (select 1 from public.public_giveaway_entries e where e.giveaway_id = g.id and e.user_id = p_user) then
    return 'already';
  end if;
  if g.has_allowlist
     and not exists (select 1 from public.public_giveaway_allowlist a where a.giveaway_id = g.id and a.address = v_wallet) then
    raise exception 'not_allowed';
  end if;
  if (select count(*) from public.public_giveaway_entries e where e.giveaway_id = g.id) >= 5000 then
    raise exception 'giveaway_full';
  end if;

  -- clock_timestamp: entries made in one transaction still get their own order
  insert into public.public_giveaway_entries (giveaway_id, user_id, wallet_address, entered_at)
  values (g.id, p_user, v_wallet, clock_timestamp())
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'already';
  end if;
  return 'entered';
end;
$$;

-- ===== record_public_giveaway_payout: 20261025100003_public_giveaways_draw.sql plus the hold =====
create or replace function public.record_public_giveaway_payout(p_prize uuid, p_payout jsonb, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_giveaway uuid;
  g public.public_giveaways;
  p public.public_giveaway_prizes;
  v_hash text;
  v_log int;
begin
  if p_actor is null or private.registration_blocked_for(p_actor) then
    raise exception 'forbidden';
  end if;
  if p_prize is null or p_payout is null or jsonb_typeof(p_payout) <> 'object'
     or coalesce(p_payout ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(p_payout ->> 'logIndex', '') !~ '^[0-9]{1,9}$'
     or coalesce(p_payout ->> 'blockNumber', '') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid_input';
  end if;
  v_hash := lower(p_payout ->> 'txHash');
  v_log := (p_payout ->> 'logIndex')::int;

  select x.giveaway_id into v_giveaway from public.public_giveaway_prizes x where x.id = p_prize;
  if not found then
    raise exception 'not_found';
  end if;
  select * into g from public.public_giveaways x where x.id = v_giveaway for share;
  if g.host_user_id <> p_actor then
    raise exception 'forbidden';
  end if;
  select * into p from public.public_giveaway_prizes x where x.id = p_prize for update;
  if not found then
    raise exception 'not_found';
  end if;

  if p.status = 'paid' and p.payout_tx_hash = v_hash and p.payout_log_index = v_log then
    return 'already';
  end if;
  if p.kind <> 'crypto' or p.status <> 'awarded' then
    raise exception 'invalid_state';
  end if;
  if exists (select 1 from public.onchain_transfers t
             where t.chain_id = p.chain_id and t.tx_hash = v_hash and t.log_index = v_log)
     or exists (select 1 from public.giveaway_prizes o
                where o.chain_id = p.chain_id and o.payout_tx_hash = v_hash and o.payout_log_index = v_log)
     or exists (select 1 from public.public_giveaway_prizes o
                where o.id <> p.id and o.chain_id = p.chain_id and o.payout_tx_hash = v_hash and o.payout_log_index = v_log) then
    raise exception 'tx_already_used';
  end if;

  begin
    update public.public_giveaway_prizes
    set status = 'paid', payout_tx_hash = v_hash, payout_log_index = v_log, paid_at = now()
    where id = p.id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;
  return 'paid';
end;
$$;

-- ===== mark_public_prize_delivered: 20261025100003_public_giveaways_draw.sql plus the hold =====
create or replace function public.mark_public_prize_delivered(p_prize uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_giveaway uuid;
  g public.public_giveaways;
  p public.public_giveaway_prizes;
begin
  if v_me is null or private.registration_blocked_for(v_me) then
    raise exception 'forbidden';
  end if;
  select x.giveaway_id into v_giveaway from public.public_giveaway_prizes x where x.id = p_prize;
  if not found then
    raise exception 'not_found';
  end if;
  select * into g from public.public_giveaways x where x.id = v_giveaway for share;
  if g.host_user_id <> v_me then
    raise exception 'forbidden';
  end if;
  select * into p from public.public_giveaway_prizes x where x.id = p_prize for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p.kind <> 'custom' or p.status <> 'awarded' then
    raise exception 'invalid_state';
  end if;
  update public.public_giveaway_prizes set status = 'delivered', delivered_at = now() where id = p.id;
end;
$$;
