-- P5 Task 2: EAS vouches on Base (P5-R5, P5-R5b, P5-R5c).
--
-- public.vouches indexes the attestations made with the fixed ElClub schema (uint8 kind) on Base / Base Sepolia. A row is
-- written by the server only after it has read the attestation on chain (kind, attester, recipient and times come from
-- getAttestation, never from the client). The data is public on chain, so non-revoked rows are readable through RLS by
-- anon and authenticated; nobody but service_role (through the RPCs below) writes.
--
--   record_vouch(...)        insert, lowercase; self_vouch / invalid_input; same uid again -> { already: true }
--   apply_vouch_state(...)   'active' (nothing), 'revoked' (revoked_at kept once set), 'removed' (row deleted, only once it
--                            is 10 minutes old: younger, the current state 'active' / 'revoked' is returned), or not_found
--   vouches_for(addr)        counts of distinct attesters per kind, distinct attesters in total, newest 50 items
--   vouches_given_by(addr)   the newest 50 non-revoked vouches an address gave
--   vouch_attester(uid)      the attester of a stored uid (null if unknown): the revoke action checks it before writing
-- Buckets: rate_limit_hit('vouch_write') 30 / 10 min per session; ip_rate_limit_hit(..., 'vouch_refresh') 30 / 10 min.

create table public.vouches (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null references public.chains (chain_id) check (chain_id in (8453, 84532)),
  uid text not null unique check (uid ~ '^0x[0-9a-f]{64}$'),
  attester text not null check (attester ~ '^0x[0-9a-f]{40}$'),
  recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  kind smallint not null check (kind between 0 and 255),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  attested_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (attester <> recipient)
);
create index vouches_recipient_idx on public.vouches (recipient) where revoked_at is null;
create index vouches_attester_idx on public.vouches (attester);

alter table public.vouches enable row level security;
revoke all on public.vouches from public, anon, authenticated;
grant select on public.vouches to anon, authenticated;
create policy vouches_public_read on public.vouches
  for select to anon, authenticated using (revoked_at is null);

-- ===== record_vouch =====
create function public.record_vouch(
  p_chain_id int, p_uid text, p_attester text, p_recipient text, p_kind int, p_tx_hash text,
  p_attested_at timestamptz, p_revoked_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := lower(p_uid);
  v_attester text := lower(p_attester);
  v_recipient text := lower(p_recipient);
  v_tx text := lower(p_tx_hash);
  v_id uuid;
begin
  if p_chain_id is null or p_chain_id not in (8453, 84532)
     or v_uid is null or v_uid !~ '^0x[0-9a-f]{64}$'
     or v_attester is null or v_attester !~ '^0x[0-9a-f]{40}$'
     or v_recipient is null or v_recipient !~ '^0x[0-9a-f]{40}$'
     or v_tx is null or v_tx !~ '^0x[0-9a-f]{64}$'
     or p_kind is null or p_kind not between 0 and 255
     or p_attested_at is null then
    raise exception 'invalid_input';
  end if;
  if v_attester = v_recipient then
    raise exception 'self_vouch';
  end if;
  insert into public.vouches (chain_id, uid, attester, recipient, kind, tx_hash, attested_at, revoked_at)
  values (p_chain_id, v_uid, v_attester, v_recipient, p_kind, v_tx, p_attested_at, p_revoked_at)
  on conflict (uid) do nothing
  returning id into v_id;
  return jsonb_build_object('already', v_id is null, 'uid', v_uid);
end;
$$;

-- ===== apply_vouch_state =====
create function public.apply_vouch_state(p_uid text, p_state text, p_revoked_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := lower(p_uid);
  v_found int;
  v_current text;
begin
  if v_uid is null or v_uid !~ '^0x[0-9a-f]{64}$' or p_state is null or p_state not in ('active', 'revoked', 'removed') then
    raise exception 'invalid_input';
  end if;
  if p_state = 'active' then
    perform 1 from public.vouches v where v.uid = v_uid;
    v_found := case when found then 1 else 0 end;
  elsif p_state = 'revoked' then
    update public.vouches v set revoked_at = coalesce(v.revoked_at, p_revoked_at, now()) where v.uid = v_uid;
    get diagnostics v_found = row_count;
  else
    -- A zero read right after recording can come from an RPC node a few blocks behind: a young row is kept and its
    -- current state returned, so one lagging read cannot delete a valid vouch.
    select case when v.revoked_at is null then 'active' else 'revoked' end into v_current
    from public.vouches v where v.uid = v_uid and v.created_at > now() - interval '10 minutes';
    if v_current is not null then
      return v_current;
    end if;
    delete from public.vouches v where v.uid = v_uid;
    get diagnostics v_found = row_count;
  end if;
  if v_found = 0 then
    return 'not_found';
  end if;
  return p_state;
end;
$$;

-- ===== reads (service_role) =====
create function public.vouches_for(p_recipient text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_recipient text := lower(p_recipient);
begin
  if v_recipient is null or v_recipient !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid_input';
  end if;
  return jsonb_build_object(
    'counts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'attesters', c.n) order by c.kind)
      from (select v.kind, count(distinct v.attester)::int as n
            from public.vouches v where v.recipient = v_recipient and v.revoked_at is null group by v.kind) c), '[]'::jsonb),
    'total', (select count(distinct v.attester)::int from public.vouches v where v.recipient = v_recipient and v.revoked_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'uid', i.uid, 'chainId', i.chain_id, 'kind', i.kind, 'attester', i.attester, 'attesterAlias', i.alias,
        'attestedAt', i.attested_at, 'txHash', i.tx_hash) order by i.attested_at desc, i.uid)
      from (select v.uid, v.chain_id, v.kind, v.attester, v.attested_at, v.tx_hash,
                   (select p.alias::text from public.public_profiles p where p.wallet_address = v.attester
                    order by p.updated_at desc limit 1) as alias
            from public.vouches v where v.recipient = v_recipient and v.revoked_at is null
            order by v.attested_at desc, v.uid limit 50) i), '[]'::jsonb));
end;
$$;

create function public.vouches_given_by(p_attester text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_attester text := lower(p_attester);
begin
  if v_attester is null or v_attester !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid_input';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'uid', i.uid, 'chainId', i.chain_id, 'kind', i.kind, 'recipient', i.recipient, 'recipientAlias', i.alias,
      'attestedAt', i.attested_at) order by i.attested_at desc, i.uid)
    from (select v.uid, v.chain_id, v.kind, v.recipient, v.attested_at,
                 (select p.alias::text from public.public_profiles p where p.wallet_address = v.recipient
                  order by p.updated_at desc limit 1) as alias
          from public.vouches v where v.attester = v_attester and v.revoked_at is null
          order by v.attested_at desc, v.uid limit 50) i), '[]'::jsonb);
end;
$$;

create function public.vouch_attester(p_uid text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid text := lower(p_uid);
begin
  if v_uid is null or v_uid !~ '^0x[0-9a-f]{64}$' then
    raise exception 'invalid_input';
  end if;
  return (select v.attester from public.vouches v where v.uid = v_uid);
end;
$$;

revoke execute on function public.record_vouch(int, text, text, text, int, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.record_vouch(int, text, text, text, int, text, timestamptz, timestamptz) to service_role;
revoke execute on function public.apply_vouch_state(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_vouch_state(text, text, timestamptz) to service_role;
revoke execute on function public.vouches_for(text) from public, anon, authenticated;
grant execute on function public.vouches_for(text) to service_role;
revoke execute on function public.vouches_given_by(text) from public, anon, authenticated;
grant execute on function public.vouches_given_by(text) to service_role;
revoke execute on function public.vouch_attester(text) from public, anon, authenticated;
grant execute on function public.vouch_attester(text) to service_role;

-- ===== rate limits: new buckets, existing ones copied unchanged =====
-- create or replace keeps the existing grants (rate_limit_hit: authenticated; ip_rate_limit_hit: service_role).
create or replace function public.rate_limit_hit(p_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text := coalesce(public.current_member_id()::text, 'u:' || auth.uid()::text);
begin
  if v_subject is null then
    raise exception 'not_authenticated';
  end if;
  if p_bucket = 'chain_verify' then
    perform private.rate_limit(v_subject, 'chain_verify', 120, interval '10 minutes');
  elsif p_bucket = 'redeem_invite' then
    perform private.rate_limit(v_subject, 'redeem_invite', 10, interval '1 hour');
  elsif p_bucket = 'vouch_write' then
    perform private.rate_limit(v_subject, 'vouch_write', 30, interval '10 minutes');
  else
    raise exception 'invalid_input';
  end if;
end;
$$;

create or replace function public.ip_rate_limit_hit(p_subject text, p_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_subject is null or p_subject !~ '^ip:([0-9a-f]{32}|unknown)$' then
    raise exception 'invalid_input';
  end if;
  if p_bucket = 'checker_web' then
    perform private.rate_limit(p_subject, 'checker_web', 30, interval '10 minutes');
  elsif p_bucket = 'api_free' then
    perform private.rate_limit(p_subject, 'api_free', 60, interval '1 hour');
  elsif p_bucket = 'api_paid_attempt' then
    perform private.rate_limit(p_subject, 'api_paid_attempt', 300, interval '1 hour');
  elsif p_bucket = 'vouch_refresh' then
    perform private.rate_limit(p_subject, 'vouch_refresh', 30, interval '10 minutes');
  else
    raise exception 'invalid_input';
  end if;
end;
$$;
