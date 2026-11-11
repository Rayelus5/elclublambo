-- Galaxy Survivor, the resource shop (shop and lab plan, F4): coins, star dust and components for real money with
-- Stripe. Real money, so these rows are kept: a purchase keeps its account (on delete restrict) and the beta's reset
-- (ops/reset-beta.sql) refuses to run once there is one.
--   shop_purchases      one per payment opened: what it gives (snapshot, fixed at checkout), its price, the consent,
--                       Stripe's session and payment, and its state (creating → pending → paid | expired | failed;
--                       paid → refunded | partially_refunded | disputed). The first-purchase extra is reserved by a
--                       unique index while the purchase is alive.
--   shop_stripe_events  every Stripe event already handled (its id), so a resent one is ignored. Append-only.
--   shop_alerts         what the admin must look at: refunds, disputes, prices or amounts that do not match.
--   shop_blocks         accounts whose shop is closed (after a refund or a dispute), until an admin opens it.

create table galaxy.shop_purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references galaxy.accounts (id) on delete restrict,
  product text not null check (product ~ '^[a-z0-9-]{1,32}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  amount_cents integer not null check (amount_cents between 50 and 100000),
  currency text not null default 'eur' check (currency = 'eur'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]{1,64}$'),
  first_bonus boolean not null default false,
  status text not null default 'creating'
    check (status in ('creating', 'pending', 'paid', 'expired', 'failed', 'refunded', 'partially_refunded', 'disputed')),
  stripe_session_id text unique,
  stripe_payment_intent text unique,
  granted jsonb check (granted is null or jsonb_typeof(granted) = 'object'),
  clawed jsonb not null default '{}'::jsonb check (jsonb_typeof(clawed) = 'object'),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  consent_at timestamptz not null,
  terms_version text not null check (terms_version ~ '^[a-z0-9-]{1,32}$'),
  madrid_day date not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'paid') <= (paid_at is not null and granted is not null))
);
create index shop_purchases_account on galaxy.shop_purchases (account_id, created_at desc);
create index shop_purchases_day on galaxy.shop_purchases (account_id, madrid_day);
create index shop_purchases_open on galaxy.shop_purchases (expires_at) where status in ('creating', 'pending');
create unique index shop_purchases_first on galaxy.shop_purchases (account_id, product) where first_bonus and status not in ('expired', 'failed');

create table galaxy.shop_stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]{1,128}$'),
  type text not null check (length(type) between 1 and 80),
  purchase_id uuid references galaxy.shop_purchases (id) on delete restrict,
  received_at timestamptz not null default now()
);

create table galaxy.shop_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('refund', 'dispute', 'dispute_closed', 'price_mismatch', 'amount_mismatch', 'unfulfilled')),
  account_id uuid references galaxy.accounts (id) on delete set null,
  purchase_id uuid references galaxy.shop_purchases (id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references galaxy.accounts (id) on delete set null
);
create index shop_alerts_open on galaxy.shop_alerts (created_at desc) where reviewed_at is null;

create table galaxy.shop_blocks (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  reason text not null check (length(reason) between 1 and 200),
  purchase_id uuid references galaxy.shop_purchases (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references galaxy.accounts (id) on delete set null
);

alter table galaxy.shop_purchases enable row level security;
alter table galaxy.shop_stripe_events enable row level security;
alter table galaxy.shop_alerts enable row level security;
alter table galaxy.shop_blocks enable row level security;
create policy galaxy_api_all on galaxy.shop_purchases for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.shop_stripe_events for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.shop_alerts for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.shop_blocks for all to galaxy_api using (true) with check (true);
revoke all on galaxy.shop_purchases, galaxy.shop_stripe_events, galaxy.shop_alerts, galaxy.shop_blocks from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.shop_purchases to galaxy_api;
grant select, insert on galaxy.shop_stripe_events to galaxy_api;
grant select, insert, update on galaxy.shop_alerts to galaxy_api;
grant select, insert, delete on galaxy.shop_blocks to galaxy_api;
