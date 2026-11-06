-- Galaxy Survivor M1 (games/galaxy/docs/GDD.md §16.1, §18.2, §18.5): the `galaxy` schema with its own accounts.
--
-- The game server (container `galaxy`) connects straight to Postgres as `galaxy_api`. That role sees only what is
-- granted here, table by table; the schema is never exposed through PostgREST (not in api.schemas) and the API roles
-- (anon, authenticated, service_role) have no usage on it. No Supabase Auth: a Supabase session must never be valid
-- for the game, nor a game session for ElClub.
--
-- galaxy_api is created NOLOGIN and without a password: roles are cluster-wide and survive `db reset`, hence the
-- guarded create. Each environment sets the password outside the history (local: games/galaxy/scripts/dev-db-role.mjs;
-- PRE: games/galaxy/docs/DEPLOY_PRE.md).
--
-- Tables:
--   accounts             lowercase usernames ^[a-z0-9_]{3,20}$, argon2id hash, ban fields.
--   account_roles        superadmin | admin | moderator. Any role means TOTP at login.
--   reserved_usernames   names nobody can register (create-admin may bypass it).
--   sessions             sha256 of the cookie token (gs_sid), mfa flag, expiry, last ip / user agent.
--   login_challenges     short-lived second step for role holders (password ok -> TOTP).
--   admin_totp           TOTP secret encrypted by the server (AES-256-GCM, key outside the DB), last used step.
--   reset_codes          admin-issued one-time recovery codes (sha256), 24 h.
--   rate_limit_hits      fixed-window counters behind galaxy.rate_limit (same mechanics as private.rate_limit).
--   admin_audit_log      append-only record of every admin / CLI action (who, what, before, after, reason, ip).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'galaxy_api') then
    create role galaxy_api nologin;
  end if;
end;
$$;

create schema galaxy;
revoke all on schema galaxy from public, anon, authenticated, service_role;
grant usage on schema galaxy to galaxy_api;

-- ===== accounts =====
create table galaxy.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  password_hash text not null,
  created_at timestamptz not null default now(),
  banned_until timestamptz,
  ban_reason text
);

create table galaxy.account_roles (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  role text not null check (role in ('superadmin', 'admin', 'moderator')),
  granted_at timestamptz not null default now(),
  primary key (account_id, role)
);

create table galaxy.reserved_usernames (
  username text primary key check (username ~ '^[a-z0-9_]{3,20}$')
);
insert into galaxy.reserved_usernames (username) values
  ('rayelus'), ('admin'), ('administrador'), ('moderador'), ('moderator'), ('perkins'), ('ecn'), ('galaxy'),
  ('sistema'), ('system'), ('soporte'), ('support'), ('root'), ('staff');

-- ===== sessions and second factor =====
create table galaxy.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  token_hash bytea not null unique,
  mfa boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip inet,
  user_agent text
);
create index sessions_account_idx on galaxy.sessions (account_id);

create table galaxy.login_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table galaxy.admin_totp (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  secret_enc bytea not null,
  last_used_step bigint not null default 0,
  created_at timestamptz not null default now()
);

create table galaxy.reset_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  code_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references galaxy.accounts (id) on delete set null
);
create index reset_codes_account_idx on galaxy.reset_codes (account_id);

-- ===== rate limits (copy of private.rate_limit, 20261019700101_rate_limits.sql) =====
create table galaxy.rate_limit_hits (
  subject text not null,
  bucket text not null,
  window_start timestamptz not null,
  hits int not null,
  primary key (subject, bucket, window_start)
);

create function galaxy.rate_limit(p_subject text, p_bucket text, p_max int, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
begin
  if p_subject is null then
    return;
  end if;
  delete from galaxy.rate_limit_hits h
  where h.subject = p_subject and h.bucket = p_bucket
    and h.window_start < now() - greatest(p_window, interval '1 day');
  insert into galaxy.rate_limit_hits as h (subject, bucket, window_start, hits)
  values (p_subject, p_bucket, date_bin(p_window, now(), timestamptz '2000-01-01Z'), 1)
  on conflict (subject, bucket, window_start) do update set hits = h.hits + 1
  returning h.hits into v_hits;
  if v_hits > p_max then
    raise exception 'rate_limited';
  end if;
end;
$$;
revoke all on function galaxy.rate_limit(text, text, int, interval) from public, anon, authenticated, service_role;
grant execute on function galaxy.rate_limit(text, text, int, interval) to galaxy_api;

-- ===== append-only admin audit log =====
create table galaxy.admin_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references galaxy.accounts (id) on delete set null,
  actor_label text not null,
  action text not null,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  reason text not null,
  ip inet
);
create index admin_audit_log_at_idx on galaxy.admin_audit_log (at desc);

create function galaxy.forbid_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log_is_append_only';
end;
$$;
create trigger admin_audit_log_append_only
  before update or delete on galaxy.admin_audit_log
  for each row execute function galaxy.forbid_audit_mutation();
-- Row triggers do not fire on TRUNCATE.
create trigger admin_audit_log_no_truncate
  before truncate on galaxy.admin_audit_log
  for each statement execute function galaxy.forbid_audit_mutation();

-- ===== RLS on (no policies: only table grants matter for galaxy_api, which owns nothing) =====
alter table galaxy.accounts enable row level security;
alter table galaxy.account_roles enable row level security;
alter table galaxy.reserved_usernames enable row level security;
alter table galaxy.sessions enable row level security;
alter table galaxy.login_challenges enable row level security;
alter table galaxy.admin_totp enable row level security;
alter table galaxy.reset_codes enable row level security;
alter table galaxy.rate_limit_hits enable row level security;
alter table galaxy.admin_audit_log enable row level security;

-- RLS without policies would hide every row from galaxy_api: it gets a permissive policy per table; what it may do is
-- decided by the grants below, never by row filters.
create policy galaxy_api_all on galaxy.accounts for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.account_roles for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.reserved_usernames for select to galaxy_api using (true);
create policy galaxy_api_all on galaxy.sessions for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.login_challenges for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.admin_totp for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.reset_codes for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.admin_audit_log for all to galaxy_api using (true) with check (true);

-- ===== grants =====
revoke all on all tables in schema galaxy from public, anon, authenticated, service_role;
revoke all on all sequences in schema galaxy from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.accounts to galaxy_api;
grant select, insert, delete on galaxy.account_roles to galaxy_api;
grant select on galaxy.reserved_usernames to galaxy_api;
grant select, insert, update, delete on galaxy.sessions to galaxy_api;
grant select, insert, update on galaxy.login_challenges to galaxy_api;
grant select, insert, update on galaxy.admin_totp to galaxy_api;
grant select, insert, update on galaxy.reset_codes to galaxy_api;
grant select, insert on galaxy.admin_audit_log to galaxy_api;
grant usage on all sequences in schema galaxy to galaxy_api;
-- Convention for every later galaxy migration: revoke from public/anon/authenticated/service_role and grant
-- galaxy_api explicitly on each new table, sequence and function (functions are executable by PUBLIC by default,
-- and IN SCHEMA default privileges cannot revoke that global default).
