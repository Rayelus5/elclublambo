-- Galaxy Survivor (plan «referidos»; the owner): referral codes. An admin gives a veteran player a code; a new player
-- signs up with it; the newcomer's gift goes to the mailbox at once and the owner's when the newcomer reaches a level.
-- A sign-up that looks like the same person is kept but held (state 'held') until an admin approves or rejects it.
--
--   referral_codes    a code and its owner (staff never own one), with an optional cap of uses and an end date
--   referral_rewards  an owner's own gifts and level instead of the global ones (each one null: the global one)
--   referrals         one row per newcomer: the code, the owner, the address and browser it signed up from, why it
--                     was held, and when each gift was paid (each once)

create table galaxy.referral_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9-]{4,20}$'),
  owner_id uuid not null references galaxy.accounts (id) on delete cascade,
  enabled boolean not null default true,
  max_uses integer check (max_uses is null or max_uses between 1 and 100000),
  expires_at timestamptz,
  note text check (note is null or length(note) <= 200),
  created_by uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index referral_codes_code on galaxy.referral_codes (code);
create index referral_codes_owner on galaxy.referral_codes (owner_id, created_at desc);

create table galaxy.referral_rewards (
  owner_id uuid primary key references galaxy.accounts (id) on delete cascade,
  owner_gifts jsonb check (owner_gifts is null or jsonb_typeof(owner_gifts) = 'object'),
  newcomer_gifts jsonb check (newcomer_gifts is null or jsonb_typeof(newcomer_gifts) = 'object'),
  activation_level smallint check (activation_level is null or activation_level between 1 and 100),
  updated_by uuid references galaxy.accounts (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table galaxy.referrals (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  code_id uuid not null references galaxy.referral_codes (id) on delete cascade,
  owner_id uuid not null references galaxy.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  signup_ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  state text not null default 'pending' check (state in ('pending', 'held', 'rewarded', 'rejected')),
  flags text[] not null default '{}',
  newcomer_paid_at timestamptz,
  owner_paid_at timestamptz,
  activated_at timestamptz,
  reviewed_by uuid references galaxy.accounts (id) on delete set null,
  reviewed_at timestamptz,
  check (account_id <> owner_id)
);
create index referrals_code on galaxy.referrals (code_id, created_at desc);
create index referrals_owner on galaxy.referrals (owner_id, created_at desc);
create index referrals_ip on galaxy.referrals (signup_ip, created_at desc);
create index referrals_state on galaxy.referrals (state, created_at desc);

alter table galaxy.referral_codes enable row level security;
alter table galaxy.referral_rewards enable row level security;
alter table galaxy.referrals enable row level security;
create policy galaxy_api_all on galaxy.referral_codes for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.referral_rewards for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.referrals for all to galaxy_api using (true) with check (true);
revoke all on galaxy.referral_codes, galaxy.referral_rewards, galaxy.referrals from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.referral_codes to galaxy_api;
grant select, insert, update, delete on galaxy.referral_rewards to galaxy_api;
grant select, insert, update on galaxy.referrals to galaxy_api;
