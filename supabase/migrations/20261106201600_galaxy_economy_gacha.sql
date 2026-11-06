-- Galaxy Survivor M2b (GDD §9, §11.3, §8.5, §18.5): economy, owned galaxies and the deep scan.
--
--   balances        one row per (account, currency); never below 0 (CHECK, and the server debits under FOR UPDATE).
--   ledger          append-only: every balance change with the balance after it, its reason and its operation key.
--   operations      idempotency: (account, key) → the stored result of that action; a retry returns it unchanged.
--   galaxies        owned galaxies. Never deleted: disintegrating sets disintegrated_at. The seed is the whole galaxy
--                   (renderFromSeed); traits/tier/name are stored for queries and audit.
--   gacha_accounts  per account: welcome grant and the Madrid day of the last free pull.
--   gacha_state     per (account, pity group): pulls since the last legendary / featured galaxy, welcome luck.
--   gacha_pulls     append-only audit of every pull: seed, luck before it, config and engine versions (GDD §7).

create function galaxy.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only';
end;
$$;
revoke all on function galaxy.forbid_mutation() from public, anon, authenticated, service_role;

create table galaxy.balances (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  currency text not null check (currency ~ '^(coins|dust|signal|signal:[a-z0-9-]{1,32})$'),
  amount bigint not null default 0 check (amount >= 0),
  primary key (account_id, currency)
);

create table galaxy.ledger (
  id bigserial primary key,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  currency text not null check (currency ~ '^(coins|dust|signal|signal:[a-z0-9-]{1,32})$'),
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null check (length(reason) between 1 and 80),
  ref jsonb not null default '{}'::jsonb,
  operation_key text,
  created_at timestamptz not null default now()
);
create index ledger_account_time on galaxy.ledger (account_id, created_at desc);
create trigger ledger_append_only before update or delete on galaxy.ledger
  for each row execute function galaxy.forbid_mutation();
create trigger ledger_no_truncate before truncate on galaxy.ledger
  for each statement execute function galaxy.forbid_mutation();

create table galaxy.operations (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  key text not null check (length(key) between 8 and 80),
  kind text not null check (length(kind) between 1 and 40),
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (account_id, key)
);

create table galaxy.galaxies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references galaxy.accounts (id) on delete cascade,
  seed numeric(20, 0) not null check (seed >= 0 and seed < 18446744073709551616),
  engine_version text not null,
  traits jsonb not null check (jsonb_typeof(traits) = 'object'),
  dna text not null check (dna ~ '^[0-9a-f]{64}$'),
  name text not null check (length(name) between 1 and 40),
  designation text not null check (designation ~ '^GX-[0-9A-F]{6}$'),
  tier smallint not null check (tier between 0 and 4),
  score real not null,
  finish text not null check (finish in ('normal', 'holo', 'prismatic', 'braille', 'corrupt')),
  featured boolean not null default false,
  level smallint not null default 1 check (level between 1 and 10),
  season text,
  origin text not null check (origin in ('pull', 'fusion', 'grant')),
  lineage uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  disintegrated_at timestamptz
);
create index galaxies_owner_live on galaxy.galaxies (owner_id, created_at desc, id) where disintegrated_at is null;
create index galaxies_owner_tier on galaxy.galaxies (owner_id, tier, created_at desc, id) where disintegrated_at is null;

create table galaxy.gacha_accounts (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  welcome_granted_at timestamptz,
  last_free_day date
);

create table galaxy.gacha_state (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  pity_group text not null check (pity_group ~ '^[a-z0-9-]{1,32}$'),
  since_legendary int not null default 0 check (since_legendary >= 0),
  since_featured int not null default 0 check (since_featured >= 0),
  welcome boolean not null default false,
  total_pulls int not null default 0 check (total_pulls >= 0),
  primary key (account_id, pity_group)
);

create table galaxy.gacha_pulls (
  id bigserial primary key,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  banner text not null,
  pity_group text not null,
  seed numeric(20, 0) not null check (seed >= 0 and seed < 18446744073709551616),
  tier smallint not null check (tier between 0 and 4),
  featured boolean not null,
  finish text not null,
  pity_before int not null check (pity_before >= 0),
  config_version int not null,
  engine_version text not null,
  galaxy_id uuid not null references galaxy.galaxies (id),
  operation_key text not null,
  created_at timestamptz not null default now()
);
create index gacha_pulls_account_time on galaxy.gacha_pulls (account_id, created_at desc);
create trigger gacha_pulls_append_only before update or delete on galaxy.gacha_pulls
  for each row execute function galaxy.forbid_mutation();
create trigger operations_append_only before update or delete on galaxy.operations
  for each row execute function galaxy.forbid_mutation();

alter table galaxy.balances enable row level security;
alter table galaxy.ledger enable row level security;
alter table galaxy.operations enable row level security;
alter table galaxy.galaxies enable row level security;
alter table galaxy.gacha_accounts enable row level security;
alter table galaxy.gacha_state enable row level security;
alter table galaxy.gacha_pulls enable row level security;
create policy galaxy_api_all on galaxy.balances for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.ledger for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.operations for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.galaxies for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.gacha_accounts for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.gacha_state for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.gacha_pulls for all to galaxy_api using (true) with check (true);

revoke all on galaxy.balances, galaxy.ledger, galaxy.operations, galaxy.galaxies, galaxy.gacha_accounts,
  galaxy.gacha_state, galaxy.gacha_pulls from public, anon, authenticated, service_role;
revoke all on sequence galaxy.ledger_id_seq, galaxy.gacha_pulls_id_seq from public, anon, authenticated, service_role;

grant select, insert, update on galaxy.balances to galaxy_api;
grant select, insert on galaxy.ledger to galaxy_api;
grant select, insert on galaxy.operations to galaxy_api;
grant select, insert, update on galaxy.galaxies to galaxy_api;
grant select, insert, update on galaxy.gacha_accounts to galaxy_api;
grant select, insert, update on galaxy.gacha_state to galaxy_api;
grant select, insert on galaxy.gacha_pulls to galaxy_api;
grant usage on sequence galaxy.ledger_id_seq, galaxy.gacha_pulls_id_seq to galaxy_api;
