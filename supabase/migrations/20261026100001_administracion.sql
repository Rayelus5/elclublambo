-- Administración Task 1: site switches, maintenance, team access list, maintenance password, admin history and
-- closable registration.
--
-- A-R1  Non-secret state in app_config ('site_switches', 'maintenance'). Private state in public.* tables with RLS on,
--       no policies and `revoke all` from anon/authenticated (the chain_config pattern; service_role keeps its default
--       grants so the e2e can clean up): maintenance_access_wallets, maintenance_password (single row),
--       maintenance_grants, registration_holds. app_config is readable by active members, so the hash cannot live there.
-- A-R2  Every RPC is security definer with search_path ''. site_state() for anon/authenticated; admin_* for
--       authenticated, gated on has_global_perm(512) ('forbidden'); my_maintenance_access() / my_registration_blocked()
--       for authenticated; maintenance_password_record() / grant_maintenance_access() for service_role only. Audit
--       actions: admin.switch, admin.maintenance, admin.maintenance_password ({}), admin.access_add, admin.access_remove.
-- A-R5  Invalidation: a password change bumps the version and drops every grant; removing a wallet drops its grants and
--       my_maintenance_access() also requires the wallet to still be listed; turning maintenance off (not enabled and no
--       startsAt) drops every grant; grants expire at least(now() + 12 h, endsAt).
-- A-R10 Password hash format scrypt$N$r$p$<salt b64>$<hash b64> (checked by regex here, hashed in Node). Attempt
--       buckets: ip_rate_limit_hit(..., 'maintenance_password') 20 / 15 min per IP, rate_limit_hit('maintenance_password')
--       5 / 15 min per session.
-- A-R11 Maintenance validation: 'default' takes no messages, returnAt or schedule; 'custom' needs both messages (1..500
--       chars, trimmed); returnAt > now(); endsAt > startsAt; endsAt > now(); anything else is maintenance_invalid.
-- A-R13 Closed registration: an after-insert trigger on auth.users records a hold while site_switches.registration is
--       false (never raises, so GoTrue never breaks). my_registration_blocked() = closed ∧ hold ∧ no members row;
--       is_public_account() gains `and not my_registration_blocked()`. Reopening clears every hold.

-- ===== app_config seeds (A-R1) =====
insert into public.app_config (key, value) values
  ('site_switches', '{"giveaways":true,"pay":true,"checker":true,"vouches":true,"approvals":true,"multisend":true,"gas":true,"donate":true,"checkerApi":true,"registration":true}'::jsonb),
  ('maintenance', '{"enabled":false,"mode":"default","messageEs":null,"messageEn":null,"returnAt":null,"startsAt":null,"endsAt":null}'::jsonb);

-- ===== private tables (A-R1) =====
create table public.maintenance_access_wallets (
  wallet text primary key check (wallet ~ '^0x[0-9a-f]{40}$'),
  note text check (note is null or char_length(note) <= 80),
  added_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.maintenance_password (
  id boolean primary key default true check (id),
  password_hash text,
  version int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.maintenance_grants (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  wallet text not null,
  password_version int not null,
  expires_at timestamptz not null
);
create index maintenance_grants_wallet_idx on public.maintenance_grants (wallet);

create table public.registration_holds (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.maintenance_access_wallets enable row level security;
alter table public.maintenance_password enable row level security;
alter table public.maintenance_grants enable row level security;
alter table public.registration_holds enable row level security;
revoke all on public.maintenance_access_wallets, public.maintenance_password, public.maintenance_grants,
  public.registration_holds from anon, authenticated;

-- ===== site_state (anon + authenticated) =====
create function public.site_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'switches', (select c.value from public.app_config c where c.key = 'site_switches'),
    'maintenance', (select c.value from public.app_config c where c.key = 'maintenance'))
$$;

-- ===== admin_overview =====
create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_member_id() is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'switches', (select c.value from public.app_config c where c.key = 'site_switches'),
    'maintenance', (select c.value from public.app_config c where c.key = 'maintenance'),
    'passwordSet', exists (select 1 from public.maintenance_password p where p.password_hash is not null),
    'passwordUpdatedAt', (select p.updated_at from public.maintenance_password p where p.password_hash is not null),
    'accessList', (select coalesce(jsonb_agg(jsonb_build_object('wallet', w.wallet, 'note', w.note, 'createdAt', w.created_at)
                                             order by w.created_at, w.wallet), '[]'::jsonb)
                   from public.maintenance_access_wallets w),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', h.created_at, 'actor', h.actor, 'action', h.action,
                                                             'payload', h.payload)
                                          order by h.created_at desc, h.id desc), '[]'::jsonb)
                from (select a.id, a.created_at, a.action, a.payload,
                             case when m.handle is not null then '@' || m.handle::text else m.wallet_address end as actor
                      from public.audit_log a
                      left join public.members m on m.id = a.actor_member_id
                      where a.action like 'admin.%'
                      order by a.created_at desc, a.id desc
                      limit 50) h)
  );
end;
$$;

-- ===== admin_set_switch =====
create function public.admin_set_switch(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_key is null or p_enabled is null or p_key not in
     ('giveaways', 'pay', 'checker', 'vouches', 'approvals', 'multisend', 'gas', 'donate', 'checkerApi', 'registration') then
    raise exception 'switch_invalid';
  end if;

  update public.app_config set value = jsonb_set(value, array[p_key], to_jsonb(p_enabled))
  where key = 'site_switches';

  if p_key = 'registration' and p_enabled then
    delete from public.registration_holds where true;
  end if;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'admin.switch', jsonb_build_object('key', p_key, 'enabled', p_enabled));
end;
$$;

-- ===== admin_set_maintenance (A-R11) =====
create function public.admin_set_maintenance(
  p_enabled boolean, p_mode text, p_message_es text, p_message_en text,
  p_return_at timestamptz, p_starts_at timestamptz, p_ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_es text := nullif(btrim(p_message_es), '');
  v_en text := nullif(btrim(p_message_en), '');
  -- dates are stored as ISO 8601 UTC with milliseconds (what JavaScript's Date#toISOString produces)
  v_return text := to_char(p_return_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_starts text := to_char(p_starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_ends text := to_char(p_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_enabled is null or p_mode is null or p_mode not in ('default', 'custom') then
    raise exception 'maintenance_invalid';
  end if;
  if p_mode = 'default' and (v_es is not null or v_en is not null or p_return_at is not null
                             or p_starts_at is not null or p_ends_at is not null) then
    raise exception 'maintenance_invalid';
  end if;
  if p_mode = 'custom' and (v_es is null or v_en is null or char_length(v_es) > 500 or char_length(v_en) > 500) then
    raise exception 'maintenance_invalid';
  end if;
  if (p_return_at is not null and p_return_at <= now())
     or (p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at)
     or (p_ends_at is not null and p_ends_at <= now()) then
    raise exception 'maintenance_invalid';
  end if;

  update public.app_config set value = jsonb_build_object(
    'enabled', p_enabled, 'mode', p_mode, 'messageEs', v_es, 'messageEn', v_en,
    'returnAt', v_return, 'startsAt', v_starts, 'endsAt', v_ends)
  where key = 'maintenance';

  if not p_enabled and p_starts_at is null then
    delete from public.maintenance_grants where true;
  end if;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'admin.maintenance', jsonb_build_object(
    'enabled', p_enabled, 'mode', p_mode, 'returnAt', v_return, 'startsAt', v_starts, 'endsAt', v_ends));
end;
$$;

-- ===== admin_set_maintenance_password (A-R10) =====
create function public.admin_set_maintenance_password(p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_hash is null or p_hash !~ '^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' then
    raise exception 'password_invalid';
  end if;

  insert into public.maintenance_password as p (id, password_hash, version, updated_at)
  values (true, p_hash, 1, now())
  on conflict (id) do update set password_hash = excluded.password_hash, version = p.version + 1, updated_at = now();

  delete from public.maintenance_grants where true;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'admin.maintenance_password', '{}'::jsonb);
end;
$$;

-- ===== admin_add_access_wallet =====
create function public.admin_add_access_wallet(p_wallet text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_wallet text := lower(btrim(p_wallet));
  v_note text := nullif(btrim(p_note), '');
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if v_wallet is null or v_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'wallet_invalid';
  end if;
  if v_note is not null and char_length(v_note) > 80 then
    raise exception 'note_invalid';
  end if;

  insert into public.maintenance_access_wallets (wallet, note, added_by)
  values (v_wallet, v_note, v_me)
  on conflict (wallet) do update set note = excluded.note;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'admin.access_add', jsonb_build_object('wallet', v_wallet, 'note', v_note));
end;
$$;

-- ===== admin_remove_access_wallet =====
create function public.admin_remove_access_wallet(p_wallet text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_wallet text := lower(btrim(p_wallet));
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;

  delete from public.maintenance_access_wallets w where w.wallet = v_wallet;
  if not found then
    return;
  end if;
  delete from public.maintenance_grants g where g.wallet = v_wallet;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'admin.access_remove', jsonb_build_object('wallet', v_wallet));
end;
$$;

-- ===== my_maintenance_access (authenticated) =====
create function public.my_maintenance_access()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wallet text := public.auth_wallet_address();
begin
  if public.has_global_perm(512) then
    return 'superadmin';
  end if;
  if auth.uid() is null or v_wallet is null
     or not exists (select 1 from public.maintenance_access_wallets w where w.wallet = v_wallet) then
    return 'none';
  end if;
  if exists (
    select 1 from public.maintenance_grants g
    join public.maintenance_password p on p.version = g.password_version
    where g.auth_user_id = auth.uid() and g.wallet = v_wallet and g.expires_at > now()
  ) then
    return 'granted';
  end if;
  return 'listed';
end;
$$;

-- ===== maintenance_password_record (service_role) =====
create function public.maintenance_password_record()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (select jsonb_build_object('hash', p.password_hash, 'version', p.version)
          from public.maintenance_password p where p.password_hash is not null)
$$;

-- ===== grant_maintenance_access (service_role) =====
-- Called by the server after the password check. The wallet is the user's first web3 identity (as auth_wallet_address).
create function public.grant_maintenance_access(p_auth_user_id uuid, p_password_version int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet text;
  v_version int;
  v_ends timestamptz;
begin
  select lower(i.identity_data->'custom_claims'->>'address') into v_wallet
  from auth.identities i
  where i.user_id = p_auth_user_id and i.provider = 'web3'
  order by i.created_at
  limit 1;

  if v_wallet is null or not exists (select 1 from public.maintenance_access_wallets w where w.wallet = v_wallet) then
    return 'not_listed';
  end if;

  select p.version into v_version from public.maintenance_password p where p.password_hash is not null;
  if v_version is null or p_password_version is distinct from v_version then
    return 'stale';
  end if;

  select (c.value->>'endsAt')::timestamptz into v_ends from public.app_config c where c.key = 'maintenance';

  insert into public.maintenance_grants as g (auth_user_id, wallet, password_version, expires_at)
  values (p_auth_user_id, v_wallet, v_version, least(now() + interval '12 hours', v_ends))
  on conflict (auth_user_id) do update
    set wallet = excluded.wallet, password_version = excluded.password_version, expires_at = excluded.expires_at;
  return 'granted';
end;
$$;

-- ===== closed registration (A-R13) =====
create function public.my_registration_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce((select (c.value->>'registration')::boolean from public.app_config c where c.key = 'site_switches'), true)
        = false
    and exists (select 1 from public.registration_holds h where h.auth_user_id = auth.uid())
    and not exists (select 1 from public.members m where m.auth_user_id = auth.uid())
$$;

-- Never raises: a failure here must not break GoTrue's sign-up.
create function private.hold_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if coalesce((select (c.value->>'registration')::boolean from public.app_config c where c.key = 'site_switches'), true)
       = false then
      insert into public.registration_holds (auth_user_id) values (new.id) on conflict do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function private.hold_registration() from public, anon, authenticated, service_role;

create trigger hold_registration
  after insert on auth.users
  for each row execute function private.hold_registration();

-- is_public_account: definition from 20261025100001_public_accounts.sql plus the registration block.
-- create or replace keeps the existing grants (authenticated).
create or replace function public.is_public_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and public.auth_wallet_address() is not null
    and not exists (
      select 1 from public.members m
      where m.auth_user_id = auth.uid() and m.status = 'banned'
    )
    and not public.my_registration_blocked()
$$;

-- ===== rate limit buckets (A-R10) =====
-- rate_limit_hit: branches copied from 20261025500001_vouches.sql. ip_rate_limit_hit: branches copied from
-- 20261025600001_approvals_rate_limit.sql. create or replace keeps the existing grants (rate_limit_hit: authenticated;
-- ip_rate_limit_hit: service_role).
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
  elsif p_bucket = 'maintenance_password' then
    perform private.rate_limit(v_subject, 'maintenance_password', 5, interval '15 minutes');
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
  elsif p_bucket = 'approvals_scan' then
    perform private.rate_limit(p_subject, 'approvals_scan', 30, interval '10 minutes');
  elsif p_bucket = 'maintenance_password' then
    perform private.rate_limit(p_subject, 'maintenance_password', 20, interval '15 minutes');
  else
    raise exception 'invalid_input';
  end if;
end;
$$;

-- ===== grants (A-R2) =====
revoke execute on function public.site_state() from public;
grant execute on function public.site_state() to anon, authenticated;

revoke execute on function
  public.admin_overview(),
  public.admin_set_switch(text, boolean),
  public.admin_set_maintenance(boolean, text, text, text, timestamptz, timestamptz, timestamptz),
  public.admin_set_maintenance_password(text),
  public.admin_add_access_wallet(text, text),
  public.admin_remove_access_wallet(text),
  public.my_maintenance_access(),
  public.my_registration_blocked()
from public, anon;

grant execute on function
  public.admin_overview(),
  public.admin_set_switch(text, boolean),
  public.admin_set_maintenance(boolean, text, text, text, timestamptz, timestamptz, timestamptz),
  public.admin_set_maintenance_password(text),
  public.admin_add_access_wallet(text, text),
  public.admin_remove_access_wallet(text),
  public.my_maintenance_access(),
  public.my_registration_blocked()
to authenticated;

revoke execute on function
  public.maintenance_password_record(),
  public.grant_maintenance_access(uuid, int)
from public, anon, authenticated;

grant execute on function
  public.maintenance_password_record(),
  public.grant_maintenance_access(uuid, int)
to service_role;
